// ═══════════════════════════════════════
// CONCERN LOGIC (link-aware partitioning)
// ═══════════════════════════════════════
function resolveW(raw) { return raw === 'majority' ? 'majority' : parseInt(raw, 10); }

function canAchieve(w) {
  if (w === 0) return true;
  const count = ['primary','s1','s2'].filter(k => isReachableForWrite(k)).length;
  return count >= (w === 'majority' ? 2 : w);
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
function buildWriteSteps(w, j) {
  const steps = [];

  if (!state.links.wp) {
    steps.push({
      title: 'Writer disconnected — cannot reach primary',
      explain: `The writer's network connection to the primary is <strong>interrupted</strong>. No writes can be sent. Click the writer\u2192primary link on the canvas to reconnect.`,
      run: async () => {
        state.writeClient.phase = 'error';
        log('Write failed — writer disconnected from primary.', 'err');
        draw();
      },
    });
    return steps;
  }

  const achievable    = canAchieve(w);
  const reachableSecs = ['s1','s2'].filter(k => isReachableForWrite(k));
  const reachCount    = ['primary','s1','s2'].filter(k => isReachableForWrite(k)).length;
  const needCount     = w === 'majority' ? 2 : w === 0 ? 0 : w;
  const secsNeeded    = w === 'majority' ? 1 : (typeof w === 'number' && w > 1) ? w - 1 : 0;

  const nextId  = state.doc.latestId + 1;
  const op      = state.doc.latestId === 0 ? 'insert' : 'update';
  const opLabel = `${op} _id:1 \u2192 v${nextId}`;

  // 1. Client sends
  steps.push({
    title: `Write Client sends ${opLabel}`,
    explain: `<strong>All MongoDB writes go to the primary.</strong> The write client dispatches <strong>${opLabel}</strong> with ` +
      `<strong>w:${w}${j ? ', j:true' : ''}</strong>. Write concern controls when the primary sends the acknowledgment back \u2014 ` +
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
      title: 'No primary \u2014 write fails',
      explain: `The primary is down. MongoDB needs a primary to accept writes. With ${reachCount} reachable node(s), no election is possible (majority = 2). <strong>Write fails immediately.</strong>`,
      run: async () => { state.writeClient.phase = 'error'; log('Write failed \u2014 no primary.', 'err'); draw(); },
    });
    return steps;
  }

  // 2. Primary applies
  steps.push({
    title: `Primary applies ${opLabel}${j ? ' + journal flush' : ' in-memory'}`,
    serverSide: true,
    explain: j
      ? `Primary appends to its oplog and <strong>flushes the on-disk journal</strong>. The write (<strong>${opLabel}</strong>) survives a crash of this node even before replication.`
      : `Primary applies <strong>${opLabel}</strong> to its <strong>WiredTiger in-memory cache</strong> and appends to the oplog. Not crash-safe until journaled.`,
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

  // w:0 fire-and-forget
  if (w === 0) {
    steps.push({
      title: 'Fire-and-forget (w:0) \u2014 no ACK',
      explain: `<strong>w:0</strong>: the client gets no acknowledgment. The write may succeed or fail \u2014 the client will never know. Async replication to secondaries proceeds normally.`,
      run: async () => {
        reachableSecs.forEach((k, i) => setTimeout(() =>
          awaitParticle(state.nodes.primary, state.nodes[k], '#4A90D9', 'v' + nextId, () => {
            state.nodes[k].docVersionId = nextId;
            const entry = state.doc.versions.find(v => v.id === nextId);
            if (entry) { entry.ackedBy.add(k); advanceMajorityCommit(); }
            state.nodes[k].phase = 'acked';
          }),
        i * 100));
        startAnimLoop();
        log(`w:0 \u2014 no ACK. ${opLabel} async replication proceeds.`, 'warn');
        state.writeClient.phase = 'idle';
        draw();
      },
    });
    return steps;
  }

  // Per-secondary replication step (replicate = ack in one step)
  function makeReplStep(k, isRequired) {
    const label = state.nodes[k].label;
    return {
      title: `Replicate to ${label}`,
      serverSide: true,
      explain: isRequired
        ? `Primary sends <strong>${opLabel}</strong> to <strong>${label}</strong> via oplog. ` +
          `<strong>w:${w}</strong> requires this secondary to confirm before the ACK goes back to the client.` +
          (j ? ` With <strong>j:true</strong>, the secondary flushes to journal.` : '')
        : `Primary sends <strong>${opLabel}</strong> to <strong>${label}</strong> via oplog. ` +
          `This happens <strong>after the client already received the ACK</strong> \u2014 a background cluster operation.` +
          (j ? ` The secondary flushes to journal upon applying.` : ''),
      run: async () => {
        if (j) await delay(200);
        await awaitParticle(state.nodes.primary, state.nodes[k], '#4A90D9', 'v' + nextId, () => {
          state.nodes[k].docVersionId = nextId;
          const entry = state.doc.versions.find(v => v.id === nextId);
          if (entry) { entry.ackedBy.add(k); }
          advanceMajorityCommit();
          state.nodes[k].phase = 'acked';
          log(`${label}: replicated v${nextId}.`, 'ok');
        });
        draw();
      },
    };
  }

  if (!achievable) {
    reachableSecs.forEach(k => steps.push(makeReplStep(k, true)));
    steps.push({
      title: 'Write concern cannot be satisfied',
      explain: `<strong>w:${w}</strong> needs ${needCount} node(s), but only ${reachCount} reachable. ` +
        `MongoDB blocks until enough nodes become available or <strong>wtimeout</strong> fires. ` +
        `<strong>The write (${opLabel}) is NOT rolled back</strong> \u2014 it is already on the primary. Click the client link to simulate a timeout, or fix the topology.`,
      run: async () => {
        await delay(600);
        state.nodes.primary.phase = 'error'; state.writeClient.phase = 'error';
        await awaitParticle(state.nodes.primary, state.writeClient, '#FF6B6B', 'ERR', () => {});
        log(`Write concern error \u2014 w:${w} unachievable. ${opLabel} sits on primary.`, 'err');
      },
    });
    return steps;
  }

  // Achievable: required replications → ACK → async replications
  const required  = reachableSecs.slice(0, secsNeeded);
  const asyncSecs = reachableSecs.slice(secsNeeded);

  required.forEach(k => steps.push(makeReplStep(k, true)));

  steps.push({
    title: `ACK returned \u2014 ${opLabel} committed`,
    explain: `All required acknowledgments collected for <strong>w:${w}${j ? ', j:true' : ''}</strong>. ` +
      (w === 'majority' && j
        ? `<strong>Fully durable.</strong> v${nextId} is majority-committed. Survives crash of any minority of nodes.`
        : w === 'majority'
        ? `v${nextId} is majority-committed. Survives failover but <strong>j:false means a majority crash before journal flush could lose this write.</strong>`
        : w === 1
        ? `Primary-only acknowledgment. v${nextId} sits on primary \u2014 <strong>rollback risk</strong> if primary steps down before replication.`
        : `Acked by ${needCount} node(s).`),
    run: async () => {
      state.nodes.primary.phase = 'acked';
      await awaitParticle(state.nodes.primary, state.writeClient, '#00ED64', 'ACK', () => {
        state.writeClient.phase = 'received';
      });
      log(`ACK \u2014 w:${w}${j ? ', j:true' : ''} satisfied. ${opLabel} done.`, 'ok');
    },
  });

  asyncSecs.forEach(k => steps.push(makeReplStep(k, false)));

  // Wrap the last step to reset all nodes to idle
  const lastStep = steps[steps.length - 1];
  const origRun  = lastStep.run;
  lastStep.run = async () => {
    await origRun();
    Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    draw();
  };

  return steps;
}

// ═══════════════════════════════════════
// BUILD READ STEPS
// ═══════════════════════════════════════
function buildReadSteps(rc, readPref, snapshotOverrideId = null) {
  const steps = [];

  if (!state.links.rp) {
    steps.push({
      title: 'Reader disconnected — cannot reach cluster',
      explain: `The reader's network connection is <strong>interrupted</strong>. No reads can be served. Click the reader link on the canvas to reconnect.`,
      run: async () => {
        state.readClient.phase = 'error';
        log('Read failed — reader disconnected.', 'err');
        draw();
      },
    });
    return steps;
  }

  const targetKey  = resolveReadTarget(rc, readPref);
  const target     = targetKey ? state.nodes[targetKey] : null;
  const reachableCount = ['primary','s1','s2'].filter(k => isReachableForWrite(k)).length;
  const majorityOk = reachableCount >= 2;

  // Pre-compute what this read will serve (at build time = snapshot of current state)
  const served = (rc === 'snapshot' && snapshotOverrideId !== null)
    ? { id: snapshotOverrideId, dirty: false }
    : (targetKey && target && target.alive ? getServedVersion(targetKey, rc) : { id: 0, dirty: false });
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
        explain: `With only <strong>${reachableCount} reachable node(s)</strong>, the majority-commit point cannot advance — a write needs 2 acks to commit, which is impossible. ` +
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
    const liveSecs = ['s1','s2'].filter(k => isReachableForWrite(k));
    steps.push({
      title: 'Primary checks leadership with secondaries',
      explain: `<strong>rc:linearizable</strong> requires the primary to confirm it can still complete <strong>w:majority</strong> writes before serving the read. It does this by verifying replication with secondaries. ` +
        `This prevents a <strong>split-brain scenario</strong> where a stale primary (unaware it was demoted) would otherwise serve outdated data with full confidence.`,
      run: async () => {
        if (liveSecs.length === 0) { await delay(300); return; }
        await Promise.all(liveSecs.map(k =>
          awaitParticle(target, state.nodes[k], '#7EC8E3', 'ping', () => { state.nodes[k].phase = 'reading'; })
            .then(() => delay(250))
            .then(() => awaitParticle(state.nodes[k], target, '#00ED64', 'ack', () => { state.nodes[k].phase = 'serving'; }))
        ));
      },
    });
    if (!majorityOk) {
      steps.push({
        title: 'Cannot confirm leadership — read blocks',
        explain: `With only ${reachableCount} reachable node(s) the primary cannot get enough responses to confirm w:majority capability. <strong>The read blocks.</strong> ` +
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
    const snapId = snapshotOverrideId !== null ? snapshotOverrideId : state.doc.majorityCommitId;
    const snapLabel = snapId > 0 ? `v${snapId}` : 'none';
    const snapExplain = snapshotOverrideId !== null
      ? `<strong>rc:snapshot</strong> session is locked at <strong>${snapLabel}</strong>. Even if newer writes are committed while this read runs, the session returns the same point-in-time view.`
      : `<strong>rc:snapshot</strong> captures a <strong>consistent point-in-time snapshot</strong> of majority-committed data: <strong>${snapLabel}</strong>. Unlike rc:majority which reads from a rolling commit point, snapshot provides an atomic view at a fixed timestamp.`;
    steps.push({
      title: `Node prepares point-in-time snapshot → ${snapLabel}`,
      explain: snapExplain + ` All reads within a transaction using rc:snapshot see the exact same data state — no phantom reads, no non-repeatable reads.`,
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
        : rc === 'snapshot' && snapshotOverrideId !== null
        ? `Result returned: <strong>${vLabel} ✓</strong>. Snapshot session is locked at <strong>v${snapshotOverrideId > 0 ? snapshotOverrideId : 'none'}</strong>, so concurrent newer writes are intentionally hidden until the session ends.`
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
