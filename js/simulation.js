// ═══════════════════════════════════════
// WRITE STATE MACHINE (lazy step generator)
// ═══════════════════════════════════════
// The machine evaluates the topology at each step to decide the next action.
// Topology is locked during execution (UI blocks node/link clicks while any
// engine is active), so the machine can assume stable topology throughout.

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

  const topo = {
    reachable: Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length,
    total:     Object.keys(state.nodes).length,
    primaryPartitioned: isPrimaryPartitioned(),
    allHealthy: Object.values(state.nodes).every(n => n.alive) &&
                Object.entries(state.links).every(([k, v]) => k === 'wp' || k === 'rp' || v),
  };
  const topoNote = topo.allHealthy ? '' : TEXTS.topoNote(topo);

  let phase          = 'send';
  const replicated   = new Set();
  const memApplied   = new Set();
  let pendingJournal = null;
  let acked          = false;

  const history = [];

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

  function ackCount() {
    const entry = state.doc.versions.find(v => v.id === nextId);
    return entry ? entry.ackedBy.size : 0;
  }

  function isWcSatisfied() { return ackCount() >= needCount; }

  function eligibleSecs() {
    const wt = effectiveWriteTarget();
    return Object.keys(state.nodes).filter(k =>
      k !== wt && state.nodes[k].alive && isReachableForWrite(k) &&
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
      run: async () => {
        await awaitParticle(state.nodes[effectiveWriteTarget()], state.nodes[k], T.flowRepl, 'v' + nextId, () => {
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
      },
    };
  }

  function makeJournalStep(k) {
    const label = state.nodes[k].label;
    const t = TEXTS.write.secondaryJournal(label, nextId, acked, ackNeedsJournal, w);
    return {
      title: t.title,
      serverSide: true,
      explain: t.explain,
      run: async () => {
        journalFlush(k);
        if (ackNeedsJournal) {
          const entry = state.doc.versions.find(v => v.id === nextId);
          if (entry) { entry.ackedBy.add(k); }
          advanceMajorityCommit();
        }
        state.nodes[k].phase = 'acked';
        log(`${label}: journal flushed - v${nextId} crash-safe.`, 'ok');
        draw();
      },
    };
  }

  const secKeys = Object.keys(state.nodes).filter(k => k !== effectiveWriteTarget());
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

      if (phase === 'send' && !state.links.wp) {
        const t = TEXTS.write.writerDisconnected;
        return failWrite(t.title, t.explain);
      }

      if (phase === 'send' && effectiveWriteTarget() !== state.primaryKey) {
        const targetLabel = state.nodes[effectiveWriteTarget()].label;
        return failWrite(
          `Not primary - ${targetLabel} cannot accept writes`,
          `<strong>MongoDB error: NotWritablePrimary.</strong> The write client is targeting <em>${targetLabel}</em>, ` +
          `which is a secondary. Only the primary can accept write operations. ` +
          `The driver would normally discover the primary automatically, but in this simulation the target was set manually.`
        );
      }

      if (phase === 'send' && !state.nodes[effectiveWriteTarget()].alive) {
        return failWrite(
          `Target node is down - cannot deliver write`,
          `The write client is targeting <em>${state.nodes[effectiveWriteTarget()].label}</em>, which is currently down. ` +
          `No write can be delivered.`
        );
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
            return awaitParticle(state.writeClient, state.nodes[effectiveWriteTarget()], T.flowWrite, op === 'insert' ? 'INS' : 'UPD', () => {
              state.nodes[effectiveWriteTarget()].phase = 'active';
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
          run: async () => {
            const wt = effectiveWriteTarget();
            state.nodes[wt].memoryVersion = nextId;
            if (!ackNeedsJournal) {
              const entry = state.doc.versions.find(v => v.id === nextId);
              if (entry) { entry.ackedBy.add(wt); }
              advanceMajorityCommit();
            }
            state.nodes[wt].phase = 'active';
            log(`Primary: v${nextId} applied in memory.`, 'info');
            draw();
          },
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
          run: async () => {
            const wt = effectiveWriteTarget();
            journalFlush(wt);
            if (ackNeedsJournal) {
              const entry = state.doc.versions.find(v => v.id === nextId);
              if (entry) { entry.ackedBy.add(wt); }
              advanceMajorityCommit();
            }
            state.nodes[wt].phase = w === 0 ? 'acked' : 'active';
            log(`Primary: journal flushed - v${nextId} crash-safe.`, 'ok');
            draw();
          },
        };
        history.push(s); return s;
      }

      if (phase === 'fireForget') {
        phase = 'done';
        const secs = eligibleSecs();
        const t = TEXTS.write.fireForget(opLabel, topoNote);
        const s = {
          title: t.title,
          explain: t.explain,
          run: async () => {
            secs.forEach((k, i) => setTimeout(() =>
              awaitParticle(state.nodes[effectiveWriteTarget()], state.nodes[k], T.flowRepl, 'v' + nextId, () => {
                state.nodes[k].memoryVersion = nextId;
                const entry = state.doc.versions.find(v => v.id === nextId);
                if (entry) { entry.ackedBy.add(k); advanceMajorityCommit(); }
                state.nodes[k].phase = 'acked';
                setTimeout(() => { journalFlush(k); draw(); }, 400);
              }),
            i * 100));
            startAnimLoop();
            log(`w:0 - no ACK. ${opLabel} async replication proceeds.`, 'warn');
            state.writeClient.phase = 'idle';
            draw();
          },
        };
        history.push(s); return s;
      }

      // Replication / ACK / Async loop
      if (phase === 'repl') {

        // 0. j:false mode: flush journal for the just-applied secondary
        if (!ackNeedsJournal && memApplied.size > 0) {
          const k = [...memApplied][0];
          memApplied.delete(k);
          replicated.add(k);
          const s = makeJournalStep(k);
          history.push(s); return s;
        }

        // 1. Finish pending journal flush (j:true / w:majority)
        if (pendingJournal) {
          const k = pendingJournal;
          pendingJournal = null;
          memApplied.delete(k);
          replicated.add(k);
          const s = makeJournalStep(k);
          history.push(s); return s;
        }

        // 2. Check if write concern is now satisfied \u2192 ACK
        if (!acked && isWcSatisfied()) {
          acked = true;
          const t = TEXTS.write.ack(opLabel, w, j, nextId, ackNeedsJournal, needCount, isDefault, defaultNote, topoNote);
          const s = {
            title: t.title,
            explain: t.explain,
            run: async () => {
              state.nodes[effectiveWriteTarget()].phase = 'acked';
              await awaitParticle(state.nodes[effectiveWriteTarget()], state.writeClient, T.flowAck, 'ACK', () => {
                state.writeClient.phase = 'received';
              });
              log(`ACK - w:${w}${j ? ', j:true' : ''} satisfied. ${opLabel} done.`, 'ok');
            },
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
              const wt = effectiveWriteTarget();
              if (state.nodes[wt].alive) {
                state.nodes[wt].phase = 'error';
              }
              state.writeClient.phase = 'error';
              if (state.nodes[wt].alive) {
                await awaitParticle(state.nodes[wt], state.writeClient, T.flowErr, 'ERR', () => {});
              }
              log(`Write concern error - w:${w} unachievable. ${opLabel} sits on primary.`, 'err');
            },
          };
          history.push(s); return s;
        }

        // 5. All replication done \u2192 clean up
        phase = 'done';
        const tRepl = TEXTS.write.replComplete(nextId, topoNote);
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
        log('Read failed - reader disconnected.', 'err');
        draw();
      },
    });
    return steps;
  }

  const targetKey  = resolveReadTarget(rc, readPref);
  const target     = targetKey ? state.nodes[targetKey] : null;
  const pk = state.primaryKey;
  const majorityOk = state.nodes[pk].alive && !isPrimaryPartitioned();
  const frozenExplainCount = state.nodes[pk].alive
    ? getPartition(pk).size
    : Object.keys(state.nodes).filter(k => state.nodes[k].alive).length;

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
        log(`Read arrived at ${target.label} (rc:${rc}, node holds v${target.memoryVersion || 'none'}).`, 'info');
      });
    },
  });

  if (!target || !target.alive) {
    const tNo = TEXTS.read.noEligibleNode(readPref);
    steps.push({
      title: tNo.title,
      explain: tNo.explain,
      run: async () => { state.readClient.phase = 'error'; log('Read failed - no eligible node.', 'err'); draw(); },
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
        log(`${target.label}: serving rc:${rc} \u2192 ${nodeLabel}${dirty ? ' (dirty)' : ''}.`, dirty ? 'warn' : 'info');
        draw();
      },
    });

  } else if (rc === 'majority') {
    if (!majorityOk) {
      const tFroz = TEXTS.read.majorityFrozen(frozenExplainCount);
      const frozenId = Math.min(
        state.doc.majorityCommitId,
        target ? (target.memoryVersion || 0) : 0
      );
      const frozenLabel = frozenId > 0 ? `v${frozenId}` : 'none';
      steps.push({
        title: tFroz.title,
        explain: tFroz.explain,
        run: async () => {
          log(`rc:majority - majority-commit frozen at v${state.doc.majorityCommitId} (return caps at v${frozenId}).`, 'warn');
          draw();
        },
      });
      const tFrozRet = TEXTS.read.majorityFrozenReturn(frozenLabel);
      steps.push({
        title: tFrozRet.title,
        explain: tFrozRet.explain,
        run: async () => {
          await awaitParticle(target, state.readClient, T.flowWrite, frozenLabel, () => {
            state.readClient.phase = 'received';
            state.readClient.lastReceivedVersion = { id: frozenId, dirty: false };
          });
          log(`Read returned frozen majority snapshot: ${frozenLabel}. Stale but safe from rollback.`, 'warn');
        },
      });
      return steps;
    }
    const mcLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
    const lagNote = vLabel !== mcLabel ? mcLabel : undefined;
    const tMaj = TEXTS.read.majorityRead(vLabel, targetKey, state.primaryKey, lagNote);
    steps.push({
      title: tMaj.title,
      explain: tMaj.explain,
      run: async () => {
        await delay(350);
        log(`${target.label}: reading majority-commit snapshot (${vLabel}).`, 'info');
        draw();
      },
    });

  } else if (rc === 'linearizable') {
    steps.push({
      ...TEXTS.read.linearizableCheck,
      run: async () => {
        const liveSecs = Object.keys(state.nodes).filter(k => k !== state.primaryKey && isReachableFromPrimary(k));
        if (liveSecs.length === 0) { await delay(300); return; }
        await Promise.all(liveSecs.map(k => {
          if (!state.nodes[k].alive) return Promise.resolve();
          return awaitParticle(target, state.nodes[k], T.flowRead, 'ping', () => {})
            .then(() => delay(250))
            .then(() => {
              if (!state.nodes[k].alive) return;
              return awaitParticle(state.nodes[k], target, T.flowAck, 'ack', () => {});
            });
        }));
      },
    });
    steps.push({
      ...TEXTS.read.linearizableEval,
      run: async () => {
        const runtimeReachable = Object.keys(state.nodes).filter(k => isReachableFromPrimary(k)).length;
        if (runtimeReachable < 2) {
          state.readClient.phase = 'error';
          state.readClient.errorReason = 'linearizable';
          log('rc:linearizable blocked - primary cannot confirm leadership.', 'err'); draw();
          return;
        }
        await delay(300);
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
        log(`${target.label}: point-in-time snapshot ready \u2192 ${snapLabel}.`, 'info'); draw();
      },
    });
  }

  // ── Data return step ──
  if (rc === 'linearizable') {
    const linSuccess = TEXTS.read.linearizableReturn;
    const linBlocked = TEXTS.read.linearizableBlocked;
    steps.push({
      get title()   { return state.readClient.phase === 'error' ? linBlocked.title   : linSuccess.title; },
      get explain() { return state.readClient.phase === 'error' ? linBlocked.explain : linSuccess.explain; },
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

function readPrefLabel(p) { return TEXTS.readPrefLabel[p] || p; }

// ═══════════════════════════════════════
// BUILD ELECTION STEPS
// ═══════════════════════════════════════
function buildElectionSteps(opts) {
  const forcePartition = opts && opts.forcePartition;
  const pk = state.primaryKey;
  const majorityNeeded = Math.floor(Object.keys(state.nodes).length / 2) + 1;

  let candidates;
  if (forcePartition) {
    const secKeys = Object.keys(state.nodes).filter(k => k !== pk && state.nodes[k].alive);
    if (secKeys.length > 0) {
      const secPartition = getPartition(secKeys[0]);
      secPartition.delete(pk);
      if (secPartition.size >= majorityNeeded) {
        candidates = [...secPartition]
          .sort((a, b) => (state.nodes[b].memoryVersion || 0) - (state.nodes[a].memoryVersion || 0));
      } else {
        candidates = [];
      }
    } else {
      candidates = [];
    }
  } else {
    candidates = Object.keys(state.nodes)
      .filter(k => k !== pk && state.nodes[k].alive)
      .sort((a, b) => (state.nodes[b].memoryVersion || 0) - (state.nodes[a].memoryVersion || 0));
  }

  const totalAlive = forcePartition
    ? candidates.length
    : Object.values(state.nodes).filter(n => n.alive).length;

  if (candidates.length === 0 || totalAlive < majorityNeeded) {
    const reason = candidates.length === 0
      ? (forcePartition ? `No reachable secondary partition forms a majority.` : `No alive secondaries available.`)
      : `Only ${totalAlive} of ${Object.keys(state.nodes).length} voting members ${forcePartition ? 'in the partition' : 'alive'} - need ${majorityNeeded} (majority) to hold an election.`;
    const tImp = TEXTS.election.impossible(reason);
    return [{
      title: tImp.title,
      explain: tImp.explain,
      run: async () => { log(`Election aborted - ${reason}`, 'err'); draw(); },
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
      log(`Election in progress - ${winnerNode.label} is campaigning (oplog v${winnerNode.memoryVersion || 'none'}).`, 'warn');
    },
  });

  const uncommitted = state.doc.versions.filter(v => v.id > state.doc.majorityCommitId);
  const rollbackNote = TEXTS.election.rollbackNote(uncommitted);
  const tElected = TEXTS.election.elected(winnerNode.label, rollbackNote, state.doc.majorityCommitId);
  steps.push({
    title: tElected.title,
    explain: tElected.explain,
    run: async () => {
      const oldPk = pk;
      state.primaryKey = winner;
      const oldLabel = winnerNode.label;
      winnerNode.label = 'Primary';

      if (forcePartition) {
        state.nodes[oldPk].label = oldLabel.replace('Primary', 'Secondary').trim() || oldLabel;
      } else {
        state.nodes[oldPk].label = oldLabel;
      }

      state.doc.versions = state.doc.versions.filter(v => v.id <= state.doc.majorityCommitId);
      state.doc.latestId = state.doc.majorityCommitId;

      // Only cap nodes in the winning partition — the isolated old primary
      // keeps its stale data until it reconnects (deferred rollback, like real MongoDB).
      const winPartition = getPartition(winner);
      Object.entries(state.nodes).forEach(([k, n]) => {
        if (winPartition.has(k)) {
          n.memoryVersion  = Math.min(n.memoryVersion  || 0, state.doc.majorityCommitId);
          n.journalVersion = Math.min(n.journalVersion || 0, state.doc.majorityCommitId);
        }
      });

      if (state.readClient.sessionActive &&
          state.readClient.sessionSnapshotId > state.doc.majorityCommitId) {
        state.readClient.sessionActive = false;
        state.readClient.sessionSnapshotId = null;
        log('Snapshot session invalidated - locked version was rolled back.', 'warn');
      }

      Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

      if (uncommitted.length > 0) {
        const staleHolder = forcePartition ? state.nodes[oldPk] : null;
        if (staleHolder && staleHolder.memoryVersion > state.doc.majorityCommitId) {
          log(`Rollback: ${uncommitted.map(v => `v${v.id}`).join(', ')} not majority-committed. Old primary retains stale data until it reconnects.`, 'warn');
        } else {
          log(`Rollback: ${uncommitted.map(v => `v${v.id}`).join(', ')} not majority-committed \u2014 rolled back.`, 'warn');
        }
      }
      if (forcePartition) {
        log(`${oldLabel} is now Primary. Old primary stepped down and is isolated.`, 'warn');
      } else {
        log(`${oldLabel} is now Primary. Writes can resume.`, 'ok');
      }
      draw();
    },
  });

  return steps;
}
