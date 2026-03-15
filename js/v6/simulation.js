// ═══════════════════════════════════════
// FAILURE + CONCERN LOGIC
// ═══════════════════════════════════════
function applyFailure(f) {
  Object.values(state.nodes).forEach(n => { n.alive = true; n.phase = 'idle'; });
  if (f === 's1down')    state.nodes.s1.alive = false;
  if (f === 's2down')    state.nodes.s2.alive = false;
  if (f === 'bothdown')  { state.nodes.s1.alive = false; state.nodes.s2.alive = false; }
  if (f === 'pdown')     state.nodes.primary.alive = false;
  if (f === 'partition') { state.nodes.s1.alive = false; state.nodes.s2.alive = false; }
}

function resolveW(raw) { return raw === 'majority' ? 'majority' : parseInt(raw, 10); }

function requiredAckers(w) {
  const alive = ['primary','s1','s2'].filter(k => state.nodes[k].alive);
  if (w === 0) return [];
  if (w === 1) return alive.slice(0, 1);
  if (w === 'majority') return alive.slice(0, 2);
  return alive.slice(0, Math.min(w, alive.length));
}
function canAchieve(w) {
  if (w === 0) return true;
  return Object.values(state.nodes).filter(n => n.alive).length >= (w === 'majority' ? 2 : w);
}

function resolveReadTarget(rc, readPref) {
  if (rc === 'linearizable') return 'primary';
  if (readPref === 'primary')
    return state.nodes.primary.alive ? 'primary' : null;
  if (readPref === 'primaryPreferred') {
    if (state.nodes.primary.alive) return 'primary';
    return ['s2','s1'].find(k => state.nodes[k].alive) || null;
  }
  if (readPref === 'secondary')
    return ['s2','s1'].find(k => state.nodes[k].alive) || null;
  if (readPref === 'secondaryPreferred') {
    const s = ['s2','s1'].find(k => state.nodes[k].alive);
    return s || (state.nodes.primary.alive ? 'primary' : null);
  }
  return 'primary';
}

// ═══════════════════════════════════════
// BUILD WRITE STEPS
// ═══════════════════════════════════════
function buildWriteSteps(w, j, wtimeout) {
  const achievable = canAchieve(w);
  const ackers     = requiredAckers(w);
  const aliveSecs  = ['s1','s2'].filter(k => state.nodes[k].alive);
  const secAckers  = ackers.filter(k => k !== 'primary');
  const aliveCount = Object.values(state.nodes).filter(n => n.alive).length;
  const needCount  = w === 'majority' ? 2 : w === 0 ? 0 : w;

  // Determine upcoming version at build time (mutations happen inside run())
  const nextId = state.doc.latestId + 1;
  const op     = state.doc.latestId === 0 ? 'insert' : 'update';
  const opLabel = `${op} _id:1 → v${nextId}`;

  const steps = [];

  steps.push({
    title: `Write Client sends ${opLabel}`,
    explain: `<strong>All MongoDB writes go to the primary.</strong> The write client dispatches <strong>${opLabel}</strong> with ` +
      `<strong>w:${w}${j ? ', j:true' : ''}</strong>. Write concern controls when the primary sends the acknowledgment back — ` +
      `it does not prevent the write from being applied immediately.`,
    run: () => {
      const entry = { id: nextId, op, ackedBy: new Set() };
      state.doc.versions.push(entry);
      state.doc.latestId = nextId;
      state.writeClient.lastWrittenVersion = nextId;
      return awaitParticle(state.writeClient, state.nodes.primary, '#F5A623', op === 'insert' ? 'INS' : 'UPD', () => {
        state.nodes.primary.phase = 'active';
        state.writeClient.phase = 'waiting';
        log(`Write received by primary (${opLabel}).`, 'info');
      });
    },
  });

  if (!state.nodes.primary.alive) {
    steps.push({
      title: 'No primary — write fails',
      explain: `The primary is down. MongoDB needs a primary to accept writes. With ${aliveCount} node(s) alive, no election is possible (majority = 2). <strong>Write fails immediately.</strong>`,
      run: async () => { state.writeClient.phase = 'error'; log('Write failed — no primary.', 'err'); draw(); },
    });
    return steps;
  }

  steps.push({
    title: `Primary applies ${opLabel}${j ? ' + journal flush' : ' in-memory'}`,
    explain: j
      ? `Primary appends to its oplog and <strong>flushes the on-disk journal</strong> before acknowledging. The write (<strong>${opLabel}</strong>) survives a crash of this node even before replication. Node shows <strong>amber ◎</strong> until a majority confirms it.`
      : `Primary applies <strong>${opLabel}</strong> to its <strong>WiredTiger in-memory cache</strong> and appends to the oplog. No journal flush yet — fast, but not crash-safe until journaled. Node shows <strong>amber ◎</strong> until majority-committed.`,
    run: async () => {
      const entry = state.doc.versions.find(v => v.id === nextId);
      if (entry) { entry.ackedBy.add('primary'); }
      state.nodes.primary.docVersionId = nextId;
      advanceMajorityCommit();
      if (j) { await delay(500); log('Primary: journal flushed.', 'info'); }
      state.nodes.primary.phase = w === 0 ? 'acked' : 'active';
      draw();
    },
  });

  if (w === 0) {
    steps.push({
      title: 'Fire-and-forget (w:0) — no ACK',
      explain: `<strong>w:0</strong>: the client gets no acknowledgment. The write (<strong>${opLabel}</strong>) may succeed or fail — the client will never know. Async replication to secondaries proceeds normally. Primary node shows <strong>amber ◎</strong> until secondaries confirm.`,
      run: async () => {
        aliveSecs.forEach((k, i) => setTimeout(() =>
          awaitParticle(state.nodes.primary, state.nodes[k], '#4A90D9', 'oplog', () => {
            state.nodes[k].docVersionId = nextId;
            const entry = state.doc.versions.find(v => v.id === nextId);
            if (entry) { entry.ackedBy.add(k); advanceMajorityCommit(); }
            state.nodes[k].phase = 'active';
          }),
        i * 100));
        startAnimLoop();
        log(`w:0 — no ACK. ${opLabel} async replication proceeds.`, 'warn');
        state.writeClient.phase = 'idle';
        draw();
      },
    });
    return steps;
  }

  if (aliveSecs.length > 0) {
    steps.push({
      title: `Oplog replicates ${opLabel} to Secondaries`,
      explain: `Secondaries <strong>tail the primary's oplog</strong> continuously — this always happens regardless of write concern. ` +
        (secAckers.length > 0
          ? `With <strong>w:${w}</strong>, the primary <em>waits</em> for ${secAckers.length} secondar${secAckers.length > 1 ? 'ies' : 'y'} to acknowledge before responding. Secondary nodes turn <strong>amber ◎</strong> once they apply the write.`
          : `With <strong>w:1</strong>, the primary does <em>not</em> wait for secondaries. Replication is purely async. Once a secondary applies the write, majority-commit may advance.`),
      run: () => Promise.all(aliveSecs.map(k =>
        awaitParticle(state.nodes.primary, state.nodes[k], '#4A90D9', 'oplog', () => {
          state.nodes[k].docVersionId = nextId;
          const entry = state.doc.versions.find(v => v.id === nextId);
          if (entry) { entry.ackedBy.add(k); advanceMajorityCommit(); }
          state.nodes[k].phase = 'active';
          log(`${state.nodes[k].label}: oplog received (v${nextId}).`, 'info');
        })
      )),
    });
  }

  if (secAckers.length > 0 && achievable) {
    steps.push({
      title: `Secondar${secAckers.length > 1 ? 'ies' : 'y'} acknowledge — majority-commit advances`,
      explain: `Waiting for ${secAckers.length} secondar${secAckers.length > 1 ? 'ies' : 'y'} to confirm <strong>${opLabel}</strong>. ` +
        (j ? `<strong>j:true</strong> — each secondary must flush to journal first. Durable on majority. Nodes turn <strong>green ◉</strong> when majority-committed.`
           : `<strong>j:false</strong> — secondary acknowledges after in-memory apply. Faster, but not disk-safe until the next journal cycle. Nodes turn <strong>green ◉</strong> when majority-committed.`),
      run: async () => {
        await delay(j ? 500 : 250);
        secAckers.forEach(k => {
          state.nodes[k].phase = 'acked';
          const entry = state.doc.versions.find(v => v.id === nextId);
          if (entry) { entry.ackedBy.add(k); }
          log(`${state.nodes[k].label}: acked (v${nextId}).`, 'ok');
        });
        advanceMajorityCommit();
        draw();
      },
    });
  }

  if (!achievable) {
    steps.push({
      title: 'Write concern cannot be satisfied',
      explain: `<strong>w:${w}</strong> needs ${needCount} node(s), but only ${aliveCount} alive. ` +
        (wtimeout > 0 ? `After <strong>${wtimeout}ms</strong>, MongoDB returns a write concern error. ` : `With <strong>wtimeout:0</strong> this blocks indefinitely. `) +
        `<strong>The write (${opLabel}) is NOT rolled back</strong> — it is already on the primary (amber ◎). It will eventually replicate, or roll back only if the primary fails before reaching majority.`,
      run: async () => {
        if (wtimeout > 0) await delay(Math.min(wtimeout, 1200));
        state.nodes.primary.phase = 'error'; state.writeClient.phase = 'error';
        await awaitParticle(state.nodes.primary, state.writeClient, '#FF6B6B', 'ERR', () => {});
        log(`Write concern error — w:${w} unachievable. ${opLabel} sits on primary (amber).`, 'err');
      },
    });
  } else {
    steps.push({
      title: `ACK returned — ${opLabel} committed`,
      explain: `All required acknowledgments collected for <strong>w:${w}${j ? ', j:true' : ''}</strong>. ` +
        (w === 'majority' && j
          ? `<strong>Fully durable.</strong> v${nextId} is majority-committed — nodes show <strong>green ◉</strong>. Survives crash of any minority of nodes.`
          : w === 'majority'
          ? `v${nextId} is majority-committed (green ◉). Survives failover but <strong>j:false means a majority crash before journal flush could lose this write.</strong>`
          : `Acked by ${ackers.length} node(s). v${nextId} sits on primary only — <strong>rollback risk</strong> if primary steps down before further replication. Nodes show amber ◎.`),
      run: async () => {
        state.nodes.primary.phase = 'acked';
        await awaitParticle(state.nodes.primary, state.writeClient, '#00ED64', 'ACK', () => {
          state.writeClient.phase = 'received';
        });
        log(`ACK — w:${w}${j ? ', j:true' : ''} satisfied. ${opLabel} done.`, 'ok');
      },
    });
  }
  return steps;
}

// ═══════════════════════════════════════
// BUILD READ STEPS
// ═══════════════════════════════════════
function buildReadSteps(rc, readPref) {
  const steps      = [];
  const targetKey  = resolveReadTarget(rc, readPref);
  const target     = targetKey ? state.nodes[targetKey] : null;
  const aliveCount = Object.values(state.nodes).filter(n => n.alive).length;
  const majorityOk = aliveCount >= 2;

  // Pre-compute what this read will serve (at build time = snapshot of current state)
  const served  = targetKey && target && target.alive ? getServedVersion(targetKey, rc) : { id: 0, dirty: false };
  const vLabel  = served.id > 0 ? `v${served.id}` : 'none';
  const isDirty = served.dirty;

  const rcNote = {
    local:        `<strong>rc:local</strong> — reads node's current in-memory state. No coordination, lowest latency. May include data not yet majority-committed (dirty read risk).`,
    available:    `<strong>rc:available</strong> — behaves like rc:local on replica sets. (On sharded clusters it can return orphaned documents from migrations.)`,
    majority:     `<strong>rc:majority</strong> — reads only data at the majority-commit point (currently <strong>v${state.doc.majorityCommitId > 0 ? state.doc.majorityCommitId : 'none'}</strong>). Data returned will never be rolled back.`,
    snapshot:     `<strong>rc:snapshot</strong> — returns a consistent point-in-time snapshot of majority-committed data (currently <strong>v${state.doc.majorityCommitId > 0 ? state.doc.majorityCommitId : 'none'}</strong>). Primarily for multi-document transactions.`,
    linearizable: `<strong>rc:linearizable</strong> — strongest guarantee. Primary must confirm it can still complete w:majority writes before serving the read. Ensures real-time order. Always use maxTimeMS.`,
  };

  // ── 1. Issue read ──
  steps.push({
    title: `Read Client requests doc #1 (${vLabel} expected)`,
    explain: `Read issued with <strong>rc:${rc}</strong> to <strong>${readPrefLabel(readPref)}</strong>. ` + rcNote[rc] +
      (rc === 'linearizable' && readPref !== 'primary' ? ` <strong>rc:linearizable forces the target to the primary</strong>, regardless of readPreference.` : ``),
    run: async () => {
      state.readClient.phase = 'waiting';
      if (!target || !target.alive) {
        state.readClient.phase = 'error';
        log(`No ${readPref} node available.`, 'err');
        draw(); return;
      }
      await awaitParticle(state.readClient, target, '#7EC8E3', 'read?', () => {
        target.phase = 'reading';
        log(`Read arrived at ${target.label} (rc:${rc}, node holds v${target.docVersionId || 'none'}).`, 'info');
      });
    },
  });

  // ── no target ──
  if (!target || !target.alive) {
    steps.push({
      title: 'No eligible node — read fails',
      explain: `readPreference:<strong>${readPref}</strong> found no eligible alive node. ` +
        (readPref === 'primary' ? `Primary is down.` : `No secondaries alive.`) +
        ` MongoDB throws a connection error to the client.`,
      run: async () => { state.readClient.phase = 'error'; log('Read failed — no eligible node.', 'err'); draw(); },
    });
    return steps;
  }

  // ── rc-specific ──
  if (rc === 'local' || rc === 'available') {
    const nodeVer = target.docVersionId;
    const nodeLabel = nodeVer > 0 ? `v${nodeVer}` : 'none';
    const dirty = nodeVer > 0 && nodeVer > state.doc.majorityCommitId;
    steps.push({
      title: `Node reads local state → ${nodeLabel}${dirty ? ' ⚠ (dirty)' : nodeVer > 0 ? ' ✓' : ''}`,
      explain: targetKey !== 'primary'
        ? `The secondary returns whatever it has in memory — <strong>no waiting, no coordination</strong>. This node holds <strong>${nodeLabel}</strong>${dirty ? `, which is <strong>above majority-commit v${state.doc.majorityCommitId}</strong> — this is a dirty read. If the primary fails now, this write could roll back` : state.doc.majorityCommitId > 0 ? `, majority-committed at v${state.doc.majorityCommitId}` : ''}.`
        : `The primary returns its latest in-memory state: <strong>${nodeLabel}</strong>${dirty ? `. Above majority-commit v${state.doc.majorityCommitId} — dirty read risk if primary crashes before reaching majority` : ''}.`,
      run: async () => {
        await delay(250);
        target.phase = 'serving';
        log(`${target.label}: serving rc:${rc} → ${nodeLabel}${dirty ? ' (dirty)' : ''}.`, dirty ? 'warn' : 'info');
        draw();
      },
    });

  } else if (rc === 'majority') {
    if (!majorityOk) {
      steps.push({
        title: 'Majority-commit point is frozen',
        explain: `With only <strong>${aliveCount} node alive</strong>, the majority-commit point cannot advance — a write needs 2 acks to commit, which is impossible. ` +
          `<strong>Non-causal reads</strong> still return the last frozen majority-commit snapshot (stale but safe). <strong>Causal session reads</strong> (afterClusterTime) will block indefinitely until the node can reach the target time.`,
        run: async () => { target.phase = 'error'; log(`rc:majority — majority-commit frozen at v${state.doc.majorityCommitId}.`, 'warn'); draw(); },
      });
      const frozenLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
      steps.push({
        title: `Returns frozen majority snapshot → ${frozenLabel}`,
        explain: `The node returns its last majority-commit snapshot: <strong>${frozenLabel}</strong>. This data is <strong>rollback-safe</strong> but may be arbitrarily stale — it reflects the last moment when a majority of nodes acknowledged. Under prolonged isolation this could be minutes or hours old.`,
        run: async () => {
          target.phase = 'serving';
          await awaitParticle(target, state.readClient, '#F5A623', frozenLabel, () => {
            state.readClient.phase = 'received';
            state.readClient.lastReceivedVersion = { id: state.doc.majorityCommitId, dirty: false };
          });
          log(`Read returned frozen majority snapshot: ${frozenLabel}. Stale but safe from rollback.`, 'warn');
        },
      });
      return steps;
    }
    const mcLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
    steps.push({
      title: `Node reads majority-commit snapshot → ${mcLabel}`,
      explain: `The node reads from its <strong>in-memory majority-commit point</strong> — the highest oplog entry confirmed by a majority of nodes: <strong>${mcLabel}</strong>. ` +
        (targetKey !== 'primary'
          ? `On this <strong>secondary</strong>, the majority-commit snapshot may lag the primary's by the replication delay. This is <strong>bounded staleness with zero rollback risk</strong>.`
          : `On the <strong>primary</strong>, this is the most current majority-safe view. No rollback risk.`),
      run: async () => {
        await delay(350);
        target.phase = 'serving';
        log(`${target.label}: reading majority-commit snapshot (${mcLabel}).`, 'info');
        draw();
      },
    });

  } else if (rc === 'linearizable') {
    const liveSecs = ['s1','s2'].filter(k => state.nodes[k].alive);
    steps.push({
      title: 'Primary checks leadership with secondaries',
      explain: `<strong>rc:linearizable</strong> requires the primary to confirm it can still complete <strong>w:majority</strong> writes before serving the read. It does this by verifying replication with secondaries. ` +
        `This prevents a <strong>split-brain scenario</strong> where a stale primary (unaware it was demoted) would otherwise serve outdated data with full confidence.`,
      run: async () => {
        if (liveSecs.length === 0) { await delay(300); return; }
        await Promise.all(liveSecs.map(k =>
          awaitParticle(target, state.nodes[k], '#7EC8E3', 'check', () => { state.nodes[k].phase = 'reading'; })
            .then(() => delay(250))
            .then(() => awaitParticle(state.nodes[k], target, '#00ED64', 'ok', () => { state.nodes[k].phase = 'serving'; }))
        ));
      },
    });
    if (!majorityOk) {
      steps.push({
        title: 'Cannot confirm leadership — read blocks',
        explain: `With only ${aliveCount} node alive the primary cannot get enough responses to confirm w:majority capability. <strong>The read blocks.</strong> ` +
          `This is intentional safety: serving a read in this state could mean serving stale data from a demoted primary. ` +
          `<strong>Always set maxTimeMS with rc:linearizable</strong> to return an error instead of hanging.`,
        run: async () => {
          target.phase = 'error'; state.readClient.phase = 'error';
          log('rc:linearizable blocked — primary cannot confirm leadership.', 'err'); draw();
        },
      });
      return steps;
    }
    const linLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
    steps.push({
      title: `Leadership confirmed — serving ${linLabel} with real-time order`,
      explain: `Primary confirmed as the legitimate current primary. The read will return <strong>${linLabel}</strong> — reflecting every majority-acknowledged write completed before this read. ` +
        `Combined with w:majority writes on the same primary, this provides <strong>linearizable consistency</strong> — reads and writes behave as if executed by a single thread in real time.`,
      run: async () => {
        await delay(300);
        target.phase = 'serving';
        log(`Primary confirmed. rc:linearizable serving ${linLabel}.`, 'info'); draw();
      },
    });

  } else if (rc === 'snapshot') {
    const snapLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
    steps.push({
      title: `Node prepares point-in-time snapshot → ${snapLabel}`,
      explain: `<strong>rc:snapshot</strong> captures a <strong>consistent point-in-time snapshot</strong> of majority-committed data: <strong>${snapLabel}</strong>. Unlike rc:majority which reads from a rolling commit point, snapshot provides an atomic view at a fixed timestamp. ` +
        `All reads within a transaction using rc:snapshot see the exact same data state — no phantom reads, no non-repeatable reads.`,
      run: async () => {
        await delay(400);
        target.phase = 'serving';
        log(`${target.label}: point-in-time snapshot ready → ${snapLabel}.`, 'info'); draw();
      },
    });
  }

  // ── return data ──
  const isBlocked = (rc === 'linearizable' && !majorityOk);
  if (!isBlocked) {
    const color = isDirty ? '#F5A623' : served.id > 0 ? '#00ED64' : '#3D5570';
    const suffix = isDirty ? ' \u26A0' : served.id > 0 ? ' \u2713' : '';
    steps.push({
      title: `Data returned → ${vLabel}${suffix}`,
      explain: state.doc.latestId === 0
        ? `No writes have been issued yet — doc #1 does not exist. The read returns <strong>nothing</strong>. Try issuing a write first.`
        : isDirty
        ? `The node sends <strong>${vLabel}</strong> (node's local v${served.id} > majority-commit v${state.doc.majorityCommitId}). With <strong>rc:${rc}</strong>, this data <strong>may include uncommitted writes</strong>. If the primary fails before these writes reach majority, they roll back — and your client already saw them.`
        : rc === 'linearizable'
        ? `Result returned: <strong>${vLabel} ✓</strong>. With <strong>rc:linearizable</strong> this data reflects every majority-acknowledged write up to this moment — the strongest possible read guarantee in MongoDB.`
        : served.id === 0
        ? `Majority-commit point is at v0 — no write has been majority-committed yet. rc:${rc} returns <strong>nothing</strong>. The latest write (v${state.doc.latestId}) is on the primary but not yet majority-acknowledged.`
        : `Result returned: <strong>${vLabel} ✓</strong>. With <strong>rc:${rc}</strong> this data is <strong>guaranteed safe from rollback</strong> — confirmed by a majority at v${state.doc.majorityCommitId}.`,
      run: async () => {
        await awaitParticle(target, state.readClient, color, vLabel, () => {
          state.readClient.phase = 'received';
          state.readClient.lastReceivedVersion = { id: served.id, dirty: isDirty };
          log(`Read complete (rc:${rc}): ${vLabel}${isDirty ? ' ⚠ (dirty)' : served.id > 0 ? ' ✓' : ' (none)'}`, isDirty ? 'warn' : 'ok');
        });
      },
    });
  }
  return steps;
}

function readPrefLabel(p) {
  return { primary:'Primary', primaryPreferred:'Primary (preferred)', secondary:'Secondary', secondaryPreferred:'Secondary (preferred)' }[p] || p;
}
