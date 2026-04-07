// ═══════════════════════════════════════
// CONCERN LOGIC (link-aware partitioning)
// ═══════════════════════════════════════
function resolveW(raw) { return raw === 'majority' ? 'majority' : parseInt(raw, 10); }

function canAchieve(w) {
  if (w === 0) return true;
  const count = Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length;
  return count >= (w === 'majority' ? 2 : w);
}

// ═══════════════════════════════════════
// WRITE STATE MACHINE (lazy step generator)
// ═══════════════════════════════════════
// Instead of pre-building a fixed step array, the machine evaluates the live
// topology to decide the next step.  When a node crashes mid-replication the
// machine re-targets remaining alive secondaries automatically.

function createWriteMachine(wOrig, j) {
  let w = wOrig;
  if (w === 0 && j) {
    log('w:0 + j:true \u2192 MongoDB demotes to w:1 (primary must ack after journal flush).', 'warn');
    w = 1;
  }

  const ackNeedsJournal = j || w === 'majority';
  const needCount       = w === 'majority' ? 2 : w === 0 ? 0 : w;
  const secsNeeded      = w === 'majority' ? 1 : (typeof w === 'number' && w > 1) ? w - 1 : 0;

  const nextId  = state.doc.latestId + 1;
  const op      = state.doc.latestId === 0 ? 'insert' : 'update';
  const opLabel = `${op} _id:1 \u2192 v${nextId}`;
  const isDefault = w === 'majority';
  const defaultNote = TEXTS.defaultNote;

  // Machine state — mutated as steps execute
  //   All paths: send → primaryMem → primaryJournal → repl → done
  //   (w:0 branches to fireForget after primaryJournal)
  let phase          = 'send';
  const replicated   = new Set();   // secondaries with both mem+journal done
  const memApplied   = new Set();   // secondaries with mem done, awaiting journal
  let pendingJournal = null;        // secondary whose journal step is next
  let acked          = false;

  const history = [];

  // ── Centralized invariant checks ──────────────────────────────────
  // Single source of truth for "can the write continue?" — covers both
  // primary-dead and primary-bounced-but-lost-data scenarios.

  function primaryAlive() { return state.nodes[state.primaryKey].alive; }

  function primaryHasData() {
    return state.nodes[state.primaryKey].memoryVersion >= nextId;
  }

  function primaryCanServe() { return primaryAlive() && primaryHasData(); }

  function failWrite(title, explain) {
    phase = 'done';
    const s = {
      title,
      explain,
      run: async () => {
        const idx = state.doc.versions.findIndex(v => v.id === nextId);
        if (idx >= 0) state.doc.versions.splice(idx, 1);
        if (state.doc.latestId >= nextId) state.doc.latestId = nextId - 1;

        state.writeClient.phase = 'error';
        log(title, 'err');
        draw();
      },
    };
    history.push(s);
    return s;
  }

  function endAsyncWork(title, explain) {
    phase = 'done';
    const s = {
      title,
      explain,
      run: async () => {
        Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
        log(title, 'warn');
        draw();
      },
    };
    history.push(s);
    return s;
  }

  function primaryUnavailableStep() {
    const pNode = state.nodes[state.primaryKey];
    const isAlive     = pNode.alive;
    const journalSafe = pNode.journalVersion >= nextId;
    const hasData     = pNode.memoryVersion >= nextId;

    if (!isAlive) {
      if (phase === 'primaryMem') {
        const t = TEXTS.write.primaryDown;
        return failWrite(t.title, t.explain);
      }
      if (phase === 'primaryJournal' || (phase === 'repl' && !journalSafe)) {
        const t = TEXTS.write.primaryCrashedUnjournaled(opLabel, isDefault, defaultNote);
        return failWrite(t.title, t.explain);
      }
      const t = TEXTS.write.primaryCrashedJournaled(opLabel);
      return failWrite(t.title, t.explain);
    }

    if (!hasData) {
      if (!acked) {
        const t = TEXTS.write.primaryBouncedUnjournaled(opLabel, isDefault, defaultNote);
        return failWrite(t.title, t.explain);
      }
      const t = TEXTS.write.primaryBouncedAfterAck(opLabel, isDefault, defaultNote);
      return endAsyncWork(t.title, t.explain);
    }

    return null;
  }

  function _guardAbort() {
    if (!acked) {
      const idx = state.doc.versions.findIndex(v => v.id === nextId);
      if (idx >= 0) state.doc.versions.splice(idx, 1);
      if (state.doc.latestId >= nextId) state.doc.latestId = nextId - 1;
      state.writeClient.phase = 'error';
    } else {
      Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    }
    log(`Primary unavailable \u2014 step aborted.`, 'err');
    draw();
  }

  // Full guard: primary must be alive AND still hold the write data.
  function guardRun(fn) {
    return async () => {
      if (!primaryCanServe()) { _guardAbort(); return; }
      await fn();
    };
  }

  // Light guard for primaryMem step: data hasn't been applied yet, only check alive.
  function guardRunAlive(fn) {
    return async () => {
      if (!primaryAlive()) { _guardAbort(); return; }
      await fn();
    };
  }

  function ackCount() {
    const entry = state.doc.versions.find(v => v.id === nextId);
    return entry ? entry.ackedBy.size : 0;
  }

  function isWcSatisfied() { return ackCount() >= needCount; }

  function eligibleSecs() {
    const pk = state.primaryKey;
    return Object.keys(state.nodes).filter(k =>
      k !== pk && state.nodes[k].alive && isReachableForWrite(k) &&
      !replicated.has(k) && !memApplied.has(k) && k !== pendingJournal
    );
  }

  function pickNextSec() { return eligibleSecs()[0] || null; }

  function makeMemStep(k) {
    const label = state.nodes[k].label;
    const t = TEXTS.write.secondaryMem(label, opLabel, acked, ackNeedsJournal, j);
    return {
      title: t.title,
      serverSide: true,
      explain: t.explain,
      run: guardRun(async () => {
        if (!state.nodes[k].alive || !isReachableForWrite(k)) {
          log(`${label} no longer reachable — skipping memory apply.`, 'warn');
          memApplied.delete(k);
          if (pendingJournal === k) pendingJournal = null;
          draw(); return;
        }
        await awaitParticle(state.nodes[state.primaryKey], state.nodes[k], T.flowRepl, 'v' + nextId, () => {
          state.nodes[k].memoryVersion = nextId;
          if (!ackNeedsJournal) {
            const entry = state.doc.versions.find(v => v.id === nextId);
            if (entry) { entry.ackedBy.add(k); }
            advanceMajorityCommit();
          }
          state.nodes[k].phase = 'active';
          log(`${label}: v${nextId} in memory.`, 'info');
        });
        draw();
      }),
    };
  }

  function makeJournalStep(k) {
    const label = state.nodes[k].label;
    const t = TEXTS.write.secondaryJournal(label, nextId, acked, ackNeedsJournal, w);
    return {
      title: t.title,
      serverSide: true,
      explain: t.explain,
      run: guardRun(async () => {
        if (!state.nodes[k].alive) {
          log(`${label} crashed — skipping journal flush.`, 'warn');
          replicated.delete(k);
          draw(); return;
        }
        journalFlush(k);
        if (ackNeedsJournal) {
          const entry = state.doc.versions.find(v => v.id === nextId);
          if (entry) { entry.ackedBy.add(k); }
          advanceMajorityCommit();
        }
        state.nodes[k].phase = 'acked';
        log(`${label}: journal flushed — v${nextId} crash-safe.`, 'ok');
        draw();
      }),
    };
  }

  const secKeys = Object.keys(state.nodes).filter(k => k !== state.primaryKey);
  const totalSecs = secKeys.length;

  return {
    history,
    get isDone() { return phase === 'done'; },

    getProgress() {
      return { phase, acked, replicated: replicated.size, memApplied: memApplied.size,
               secsNeeded, totalSecs, w, errored: phase === 'done' && !acked && history.length > 0 };
    },

    nextStep() {
      if (phase === 'done') return null;

      // ── Universal invariant: primary must be alive and hold the write data ──
      // At primaryMem, data hasn't been applied yet — only check liveness.
      // From primaryJournal/repl onward, also verify the data survived.
      if (phase === 'primaryMem' && !primaryAlive()) {
        return primaryUnavailableStep();
      }
      if (phase !== 'send' && phase !== 'primaryMem' && !primaryCanServe()) {
        const step = primaryUnavailableStep();
        if (step) return step;
      }

      if (phase === 'send' && !state.links.wp) {
        const t = TEXTS.write.writerDisconnected;
        return failWrite(t.title, t.explain);
      }

      if (phase === 'send') {
        phase = 'primaryMem';
        const t = TEXTS.write.clientSend(opLabel, w, j);
        const s = {
          title: t.title,
          explain: t.explain,
          run: () => {
            const entry = { id: nextId, op, ackedBy: new Set() };
            state.doc.versions.push(entry);
            state.doc.latestId = nextId;
            state.writeClient.lastWrittenVersion = nextId;
            return awaitParticle(state.writeClient, state.nodes[state.primaryKey], T.flowWrite, op === 'insert' ? 'INS' : 'UPD', () => {
              state.nodes[state.primaryKey].phase = 'active';
              state.writeClient.phase = 'waiting';
              log(`Write received by primary (${opLabel}).`, 'info');
            });
          },
        };
        history.push(s); return s;
      }

      if (phase === 'primaryMem') {
        phase = 'primaryJournal';
        const t = TEXTS.write.primaryMem(opLabel, ackNeedsJournal, j);
        const s = {
          title: t.title,
          serverSide: true,
          explain: t.explain,
          run: guardRunAlive(async () => {
            state.nodes[state.primaryKey].memoryVersion = nextId;
            if (!ackNeedsJournal) {
              const entry = state.doc.versions.find(v => v.id === nextId);
              if (entry) { entry.ackedBy.add(state.primaryKey); }
              advanceMajorityCommit();
            }
            state.nodes[state.primaryKey].phase = 'active';
            log(`Primary: v${nextId} applied in memory.`, 'info');
            draw();
          }),
        };
        history.push(s); return s;
      }

      if (phase === 'primaryJournal') {
        phase = w === 0 ? 'fireForget' : 'repl';
        const t = TEXTS.write.primaryJournal(opLabel, ackNeedsJournal, j);
        const s = {
          title: t.title,
          serverSide: true,
          explain: t.explain,
          run: guardRun(async () => {
            journalFlush(state.primaryKey);
            if (ackNeedsJournal) {
              const entry = state.doc.versions.find(v => v.id === nextId);
              if (entry) { entry.ackedBy.add(state.primaryKey); }
              advanceMajorityCommit();
            }
            state.nodes[state.primaryKey].phase = w === 0 ? 'acked' : 'active';
            log(`Primary: journal flushed — v${nextId} crash-safe.`, 'ok');
            draw();
          }),
        };
        history.push(s); return s;
      }

      if (phase === 'fireForget') {
        phase = 'done';
        const secs = eligibleSecs();
        const t = TEXTS.write.fireForget(opLabel);
        const s = {
          title: t.title,
          explain: t.explain,
          run: async () => {
            secs.forEach((k, i) => setTimeout(() =>
              awaitParticle(state.nodes[state.primaryKey], state.nodes[k], T.flowRepl, 'v' + nextId, () => {
                state.nodes[k].memoryVersion = nextId;
                const entry = state.doc.versions.find(v => v.id === nextId);
                if (entry) { entry.ackedBy.add(k); advanceMajorityCommit(); }
                state.nodes[k].phase = 'acked';
                setTimeout(() => { journalFlush(k); draw(); }, 400);
              }),
            i * 100));
            startAnimLoop();
            log(`w:0 — no ACK. ${opLabel} async replication proceeds.`, 'warn');
            state.writeClient.phase = 'idle';
            draw();
          },
        };
        history.push(s); return s;
      }

      // Replication / ACK / Async loop — the dynamic heart of the machine.
      // On each call it checks live topology and decides the next action.
      // (Primary liveness already checked by universal guard above.)
      if (phase === 'repl') {

        // 0. j:false mode: flush journal for the just-applied secondary
        //    before picking the next one (one at a time, interleaved)
        if (!ackNeedsJournal && memApplied.size > 0) {
          const k = [...memApplied][0];
          memApplied.delete(k);
          replicated.add(k);
          if (state.nodes[k].alive && isReachableForWrite(k)) {
            const s = makeJournalStep(k);
            history.push(s); return s;
          }
        }

        // 1. Finish pending journal flush (j:true / w:majority)
        if (pendingJournal) {
          const k = pendingJournal;
          if (!state.nodes[k].alive || !isReachableForWrite(k)) {
            log(`${state.nodes[k].label} unreachable \u2014 skipping journal flush, will retarget.`, 'warn');
            memApplied.delete(k);
            pendingJournal = null;
          } else {
            pendingJournal = null;
            memApplied.delete(k);
            replicated.add(k);
            const s = makeJournalStep(k);
            history.push(s); return s;
          }
        }

        // 2. Check if write concern is now satisfied \u2192 ACK
        if (!acked && isWcSatisfied()) {
          acked = true;
          const t = TEXTS.write.ack(opLabel, w, j, nextId, ackNeedsJournal, needCount, isDefault, defaultNote);
          const s = {
            title: t.title,
            explain: t.explain,
            run: guardRun(async () => {
              state.nodes[state.primaryKey].phase = 'acked';
              await awaitParticle(state.nodes[state.primaryKey], state.writeClient, T.flowAck, 'ACK', () => {
                state.writeClient.phase = 'received';
              });
              log(`ACK — w:${w}${j ? ', j:true' : ''} satisfied. ${opLabel} done.`, 'ok');
            }),
          };
          history.push(s); return s;
        }

        // 3. Pick a secondary to replicate to
        const nextSec = pickNextSec();
        if (nextSec) {
          memApplied.add(nextSec);
          if (ackNeedsJournal) pendingJournal = nextSec;
          const s = makeMemStep(nextSec);
          history.push(s); return s;
        }

        // 4. No more secondaries AND write concern NOT satisfied \u2192 block/error
        if (!acked && !isWcSatisfied()) {
          const reachCount = Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length;
          phase = 'done';
          const t = TEXTS.write.wcUnsatisfied(opLabel, w, needCount, reachCount);
          const s = {
            title: t.title,
            explain: t.explain,
            run: async () => {
              await delay(600);
              if (state.nodes[state.primaryKey].alive) {
                state.nodes[state.primaryKey].phase = 'error';
              }
              state.writeClient.phase = 'error';
              if (state.nodes[state.primaryKey].alive) {
                await awaitParticle(state.nodes[state.primaryKey], state.writeClient, T.flowErr, 'ERR', () => {});
              }
              log(`Write concern error \u2014 w:${w} unachievable. ${opLabel} sits on primary.`, 'err');
            },
          };
          history.push(s); return s;
        }

        // 5. All replication done \u2192 clean up
        phase = 'done';
        const tRepl = TEXTS.write.replComplete(nextId);
        const s = {
          title: tRepl.title,
          serverSide: true,
          explain: tRepl.explain,
          run: async () => {
            Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
            draw();
          },
        };
        history.push(s); return s;
      }

      return null;
    },
  };
}

// ═══════════════════════════════════════
// BUILD READ STEPS
// ═══════════════════════════════════════
function buildReadSteps(rc, readPref, snapshotOverrideId = null) {
  const steps = [];

  if (!state.links.rp) {
    steps.push({
      ...TEXTS.read.disconnected,
      run: async () => {
        state.readClient.phase = 'error';
        log('Read failed \u2014 reader disconnected.', 'err');
        draw();
      },
    });
    return steps;
  }

  const targetKey  = resolveReadTarget(rc, readPref);
  const target     = targetKey ? state.nodes[targetKey] : null;
  const reachableCount = Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length;
  const majorityOk = reachableCount >= 2;

  const served = (rc === 'snapshot' && snapshotOverrideId !== null)
    ? { id: snapshotOverrideId, dirty: false }
    : (targetKey && target && target.alive ? getServedVersion(targetKey, rc) : { id: 0, dirty: false });
  const vLabel  = served.id > 0 ? `v${served.id}` : 'none';
  const isDirty = served.dirty;

  const mcId = state.doc.majorityCommitId;
  const rcNote = {
    local:        TEXTS.read.rcNote.local,
    available:    TEXTS.read.rcNote.available,
    majority:     TEXTS.read.rcNote.majority(mcId),
    snapshot:     TEXTS.read.rcNote.snapshot(mcId),
    linearizable: TEXTS.read.rcNote.linearizable,
  };

  const tIssue = TEXTS.read.issueRead(rc, readPrefLabel(readPref), vLabel, rcNote[rc], rc === 'linearizable' && readPref !== 'primary');
  steps.push({
    title: tIssue.title,
    explain: tIssue.explain,
    run: async () => {
      state.readClient.phase = 'waiting';
      if (!target || !target.alive) {
        state.readClient.phase = 'error';
        log(`No ${readPref} node available.`, 'err');
        draw(); return;
      }
      await awaitParticle(state.readClient, target, T.flowRead, 'read?', () => {
        target.phase = 'reading';
        log(`Read arrived at ${target.label} (rc:${rc}, node holds v${target.memoryVersion || 'none'}).`, 'info');
      });
    },
  });

  if (!target || !target.alive) {
    const tNo = TEXTS.read.noEligibleNode(readPref);
    steps.push({
      title: tNo.title,
      explain: tNo.explain,
      run: async () => { state.readClient.phase = 'error'; log('Read failed \u2014 no eligible node.', 'err'); draw(); },
    });
    return steps;
  }

  if (rc === 'local' || rc === 'available') {
    const nodeVer = target.memoryVersion;
    const nodeLabel = nodeVer > 0 ? `v${nodeVer}` : 'none';
    const dirty = nodeVer > 0 && nodeVer > state.doc.majorityCommitId;
    const tLocal = TEXTS.read.localRead(targetKey, state.primaryKey, nodeLabel, dirty, state.doc.majorityCommitId);
    steps.push({
      title: tLocal.title,
      explain: tLocal.explain,
      run: async () => {
        await delay(250);
        target.phase = 'serving';
        log(`${target.label}: serving rc:${rc} \u2192 ${nodeLabel}${dirty ? ' (dirty)' : ''}.`, dirty ? 'warn' : 'info');
        draw();
      },
    });

  } else if (rc === 'majority') {
    if (!majorityOk) {
      const tFroz = TEXTS.read.majorityFrozen(reachableCount);
      steps.push({
        title: tFroz.title,
        explain: tFroz.explain,
        run: async () => { target.phase = 'error'; log(`rc:majority \u2014 majority-commit frozen at v${state.doc.majorityCommitId}.`, 'warn'); draw(); },
      });
      const frozenLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
      const tFrozRet = TEXTS.read.majorityFrozenReturn(frozenLabel);
      steps.push({
        title: tFrozRet.title,
        explain: tFrozRet.explain,
        run: async () => {
          target.phase = 'serving';
          await awaitParticle(target, state.readClient, T.flowWrite, frozenLabel, () => {
            state.readClient.phase = 'received';
            state.readClient.lastReceivedVersion = { id: state.doc.majorityCommitId, dirty: false };
          });
          log(`Read returned frozen majority snapshot: ${frozenLabel}. Stale but safe from rollback.`, 'warn');
        },
      });
      return steps;
    }
    const mcLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
    const tMaj = TEXTS.read.majorityRead(mcLabel, targetKey, state.primaryKey);
    steps.push({
      title: tMaj.title,
      explain: tMaj.explain,
      run: async () => {
        await delay(350);
        target.phase = 'serving';
        log(`${target.label}: reading majority-commit snapshot (${mcLabel}).`, 'info');
        draw();
      },
    });

  } else if (rc === 'linearizable') {
    // Both steps evaluate topology at RUNTIME, not build time.
    // This ensures that if a secondary goes down between step-build and execution,
    // the leadership check correctly detects it.
    steps.push({
      ...TEXTS.read.linearizableCheck,
      run: async () => {
        const liveSecs = Object.keys(state.nodes).filter(k => k !== state.primaryKey && isReachableForWrite(k));
        if (liveSecs.length === 0) { await delay(300); return; }
        await Promise.all(liveSecs.map(k => {
          if (!state.nodes[k].alive) return Promise.resolve();
          return awaitParticle(target, state.nodes[k], T.flowRead, 'ping', () => { state.nodes[k].phase = 'reading'; })
            .then(() => delay(250))
            .then(() => {
              if (!state.nodes[k].alive) return;
              return awaitParticle(state.nodes[k], target, T.flowAck, 'ack', () => { state.nodes[k].phase = 'serving'; });
            });
        }));
      },
    });
    steps.push({
      ...TEXTS.read.linearizableEval,
      run: async () => {
        const runtimeReachable = Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length;
        if (runtimeReachable < 2) {
          target.phase = 'error'; state.readClient.phase = 'error';
          log('rc:linearizable blocked \u2014 primary cannot confirm leadership.', 'err'); draw();
          return;
        }
        await delay(300);
        target.phase = 'serving';
        const linLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
        log(`Primary confirmed. rc:linearizable serving ${linLabel}.`, 'info'); draw();
      },
    });

  } else if (rc === 'snapshot') {
    const snapId = snapshotOverrideId !== null ? snapshotOverrideId : state.doc.majorityCommitId;
    const snapLabel = snapId > 0 ? `v${snapId}` : 'none';
    const tSnap = TEXTS.read.snapshotRead(snapLabel, snapshotOverrideId !== null, targetKey, state.primaryKey);
    steps.push({
      title: tSnap.title,
      explain: tSnap.explain,
      run: async () => {
        await delay(400);
        target.phase = 'serving';
        log(`${target.label}: point-in-time snapshot ready \u2192 ${snapLabel}.`, 'info'); draw();
      },
    });
  }

  // ── Data return step ──
  if (rc === 'linearizable') {
    // Linearizable: compute served value at RUNTIME so it reflects the latest
    // majority-commit point at the moment the read actually executes.
    steps.push({
      ...TEXTS.read.linearizableReturn,
      run: async () => {
        if (state.readClient.phase === 'error') return;
        const rServed = getServedVersion(targetKey, rc);
        const rLabel = rServed.id > 0 ? `v${rServed.id}` : 'none';
        const color = rServed.id > 0 ? T.flowAck : T.flowDim;
        await awaitParticle(target, state.readClient, color, rLabel, () => {
          state.readClient.phase = 'received';
          state.readClient.lastReceivedVersion = { id: rServed.id, dirty: false };
          log(`Read complete (rc:linearizable): ${rLabel}${rServed.id > 0 ? ' \u2713' : ' (none)'}`, rServed.id > 0 ? 'ok' : 'info');
        });
      },
    });
  } else {
    const color = isDirty ? T.flowWrite : served.id > 0 ? T.flowAck : T.flowDim;
    const tRet = TEXTS.read.dataReturn(vLabel, isDirty, served, rc, state.doc.latestId, state.doc.majorityCommitId, snapshotOverrideId);
    steps.push({
      title: tRet.title,
      explain: tRet.explain,
      run: async () => {
        await awaitParticle(target, state.readClient, color, vLabel, () => {
          state.readClient.phase = 'received';
          state.readClient.lastReceivedVersion = { id: served.id, dirty: isDirty };
          log(`Read complete (rc:${rc}): ${vLabel}${isDirty ? ' \u26A0 (dirty)' : served.id > 0 ? ' \u2713' : ' (none)'}`, isDirty ? 'warn' : 'ok');
        });
      },
    });
  }
  return steps;
}

function readPrefLabel(p) {
  return { primary:'Primary', primaryPreferred:'Primary (preferred)', secondary:'Secondary', secondaryPreferred:'Secondary (preferred)' }[p] || p;
}

// ═══════════════════════════════════════
// BUILD ELECTION STEPS
// ═══════════════════════════════════════
function buildElectionSteps() {
  const pk = state.primaryKey;
  const candidates = Object.keys(state.nodes)
    .filter(k => k !== pk && state.nodes[k].alive)
    .sort((a, b) => (state.nodes[b].memoryVersion || 0) - (state.nodes[a].memoryVersion || 0));

  const totalAlive = Object.values(state.nodes).filter(n => n.alive).length;
  const majorityNeeded = Math.floor(Object.keys(state.nodes).length / 2) + 1;

  if (candidates.length === 0 || totalAlive < majorityNeeded) {
    const reason = candidates.length === 0
      ? `No alive secondaries available.`
      : `Only ${totalAlive} of ${Object.keys(state.nodes).length} voting members alive \u2014 need ${majorityNeeded} (majority) to hold an election.`;
    const tImp = TEXTS.election.impossible(reason);
    return [{
      title: tImp.title,
      explain: tImp.explain,
      run: async () => { log(`Election aborted \u2014 ${reason}`, 'err'); draw(); },
    }];
  }

  const winner     = candidates[0];
  const winnerNode = state.nodes[winner];
  const steps      = [];

  const tCamp = TEXTS.election.campaign(winnerNode.label, winnerNode.memoryVersion || 'none');
  steps.push({
    title: tCamp.title,
    explain: tCamp.explain,
    run: async () => {
      winnerNode.phase = 'candidate';
      draw();
      log(`Election in progress \u2014 ${winnerNode.label} is campaigning (oplog v${winnerNode.memoryVersion || 'none'}).`, 'warn');
    },
  });

  const uncommitted = state.doc.versions.filter(v => v.id > state.doc.majorityCommitId);
  const rollbackNote = TEXTS.election.rollbackNote(uncommitted);
  const tElected = TEXTS.election.elected(winnerNode.label, rollbackNote, state.doc.majorityCommitId);
  steps.push({
    title: tElected.title,
    explain: tElected.explain,
    run: async () => {
      state.primaryKey = winner;
      const oldLabel = winnerNode.label;
      winnerNode.label = 'Primary';
      state.nodes[pk].label = 'Old Primary';

      state.doc.versions = state.doc.versions.filter(v => v.id <= state.doc.majorityCommitId);
      state.doc.latestId = state.doc.majorityCommitId;
      Object.values(state.nodes).forEach(n => {
        n.memoryVersion  = Math.min(n.memoryVersion  || 0, state.doc.majorityCommitId);
        n.journalVersion = Math.min(n.journalVersion || 0, state.doc.majorityCommitId);
      });

      if (state.readClient.sessionActive &&
          state.readClient.sessionSnapshotId > state.doc.majorityCommitId) {
        state.readClient.sessionActive = false;
        state.readClient.sessionSnapshotId = null;
        log('Snapshot session invalidated \u2014 locked version was rolled back.', 'warn');
      }

      Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

      if (uncommitted.length > 0) {
        log(`Rollback: ${uncommitted.map(v => `v${v.id}`).join(', ')} removed from uncommitted nodes.`, 'warn');
      }
      log(`${oldLabel} is now Primary. Writes can resume.`, 'ok');
      draw();
    },
  });

  return steps;
}
