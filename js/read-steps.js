// ═══════════════════════════════════════
// BUILD READ STEPS
// ═══════════════════════════════════════

function readPrefLabel(p) { return TEXTS.readPrefLabel[p] || p; }

// ── Per-read-concern step builders ──

function buildLocalReadSteps(steps, target, targetKey, rc) {
  const nodeVer = target.memoryVersion;
  const nodeLabel = nodeVer > 0 ? `v${nodeVer}` : 'none';
  const dirty = nodeVer > 0 && nodeVer > state.doc.majorityCommitId;
  const tLocal = TEXTS.read.localRead(targetKey, state.primaryKey, nodeLabel, dirty, state.doc.majorityCommitId);
  steps.push({
    title: tLocal.title,
    explain: tLocal.explain,
    run: async () => {
      await delay(PAUSE_SHORT_MS);
      log(`${target.label}: serving rc:${rc} \u2192 ${nodeLabel}${dirty ? ' (dirty)' : ''}.`, dirty ? 'warn' : 'info');
      draw();
    },
  });
}

function buildMajorityFrozenSteps(steps, target, frozenExplainCount) {
  const tFroz = TEXTS.read.majorityFrozen(frozenExplainCount);
  const frozenId = Math.min(
    state.doc.majorityCommitId,
    target ? (target.memoryVersion || 0) : 0
  );
  const frozenLabel = frozenId > 0 ? `v${frozenId}` : 'none';
  steps.push({
    title: tFroz.title, explain: tFroz.explain,
    run: async () => {
      log(`rc:majority - majority-commit frozen at v${state.doc.majorityCommitId} (return caps at v${frozenId}).`, 'warn');
      draw();
    },
  });
  const tFrozRet = TEXTS.read.majorityFrozenReturn(frozenLabel);
  steps.push({
    title: tFrozRet.title, explain: tFrozRet.explain,
    run: async () => {
      await awaitParticle(target, state.readClient, THEME.flowWrite, frozenLabel, () => {
        state.readClient.phase = 'received';
        state.readClient.lastReceivedVersion = { id: frozenId, dirty: false };
      });
      log(`Read returned frozen majority snapshot: ${frozenLabel}. Stale but safe from rollback.`, 'warn');
    },
  });
}

function buildMajorityReadSteps(steps, target, targetKey, vLabel, majorityOk, frozenExplainCount) {
  if (!majorityOk) {
    buildMajorityFrozenSteps(steps, target, frozenExplainCount);
    return true;
  }
  const mcLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
  const lagNote = vLabel !== mcLabel ? mcLabel : undefined;
  const tMaj = TEXTS.read.majorityRead(vLabel, targetKey, state.primaryKey, lagNote);
  steps.push({
    title: tMaj.title, explain: tMaj.explain,
    run: async () => {
      await delay(PAUSE_MEDIUM_MS);
      log(`${target.label}: reading majority-commit snapshot (${vLabel}).`, 'info');
      draw();
    },
  });
  return false;
}

function pingAckSecondary(primary, secKey) {
  const sec = state.nodes[secKey];
  if (!sec.alive) return Promise.resolve();
  return awaitParticle(primary, sec, THEME.flowRead, 'ping', () => {})
    .then(() => delay(PAUSE_SHORT_MS))
    .then(() => {
      if (!sec.alive) return;
      return awaitParticle(sec, primary, THEME.flowAck, 'ack', () => {});
    });
}

function buildLinearizableReadSteps(steps, target, targetKey) {
  steps.push({
    ...TEXTS.read.linearizableCheck,
    run: async () => {
      const liveSecs = Object.keys(state.nodes).filter(k => k !== state.primaryKey && isReachableFromPrimary(k));
      if (liveSecs.length === 0) { await delay(PAUSE_SHORT_MS); return; }
      await Promise.all(liveSecs.map(k => pingAckSecondary(target, k)));
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
      await delay(PAUSE_SHORT_MS);
      const linLabel = state.doc.majorityCommitId > 0 ? `v${state.doc.majorityCommitId}` : 'none';
      log(`Primary confirmed. rc:linearizable serving ${linLabel}.`, 'info'); draw();
    },
  });
}

function buildSnapshotReadSteps(steps, target, targetKey, snapshotOverrideId) {
  const snapId = snapshotOverrideId !== null ? snapshotOverrideId : state.doc.majorityCommitId;
  const snapLabel = snapId > 0 ? `v${snapId}` : 'none';
  const tSnap = TEXTS.read.snapshotRead(snapLabel, snapshotOverrideId !== null, targetKey, state.primaryKey);
  steps.push({
    title: tSnap.title, explain: tSnap.explain,
    run: async () => {
      await delay(PAUSE_JOURNAL_MS);
      log(`${target.label}: point-in-time snapshot ready \u2192 ${snapLabel}.`, 'info'); draw();
    },
  });
}

function buildLinearizableReturnStep(steps, target, targetKey) {
  const linSuccess = TEXTS.read.linearizableReturn;
  const linBlocked = TEXTS.read.linearizableBlocked;
  steps.push({
    get title()   { return state.readClient.phase === 'error' ? linBlocked.title   : linSuccess.title; },
    get explain() { return state.readClient.phase === 'error' ? linBlocked.explain : linSuccess.explain; },
    run: async () => {
      if (state.readClient.phase === 'error') return;
      const rServed = getServedVersion(targetKey, 'linearizable');
      const rLabel = rServed.id > 0 ? `v${rServed.id}` : 'none';
      const color = rServed.id > 0 ? THEME.flowAck : THEME.flowDim;
      await awaitParticle(target, state.readClient, color, rLabel, () => {
        state.readClient.phase = 'received';
        state.readClient.lastReceivedVersion = { id: rServed.id, dirty: false };
        log(`Read complete (rc:linearizable): ${rLabel}${rServed.id > 0 ? ' \u2713' : ' (none)'}`, rServed.id > 0 ? 'ok' : 'info');
      });
    },
  });
}

function buildStandardReturnStep(steps, rc, target, served, vLabel, isDirty, snapshotOverrideId) {
  const color = isDirty ? THEME.flowWrite : served.id > 0 ? THEME.flowAck : THEME.flowDim;
  const tRet = TEXTS.read.dataReturn(vLabel, isDirty, served, rc, state.doc.latestId, state.doc.majorityCommitId, snapshotOverrideId);
  steps.push({
    title: tRet.title, explain: tRet.explain,
    run: async () => {
      await awaitParticle(target, state.readClient, color, vLabel, () => {
        state.readClient.phase = 'received';
        state.readClient.lastReceivedVersion = { id: served.id, dirty: isDirty };
        log(`Read complete (rc:${rc}): ${vLabel}${isDirty ? ' \u26A0 (dirty)' : served.id > 0 ? ' \u2713' : ' (none)'}`, isDirty ? 'warn' : 'ok');
      });
    },
  });
}

function buildDataReturnStep(steps, rc, target, targetKey, served, vLabel, isDirty, snapshotOverrideId) {
  if (rc === 'linearizable') {
    buildLinearizableReturnStep(steps, target, targetKey);
  } else {
    buildStandardReturnStep(steps, rc, target, served, vLabel, isDirty, snapshotOverrideId);
  }
}

// ── Read context computation ──

function computeReadContext(rc, readPref, snapshotOverrideId) {
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

  const mcId = state.doc.majorityCommitId;
  const rcNote = {
    local:        TEXTS.read.rcNote.local,
    available:    TEXTS.read.rcNote.available,
    majority:     TEXTS.read.rcNote.majority(mcId),
    snapshot:     TEXTS.read.rcNote.snapshot(mcId),
    linearizable: TEXTS.read.rcNote.linearizable,
  };

  return { targetKey, target, majorityOk, frozenExplainCount, served,
           vLabel: served.id > 0 ? `v${served.id}` : 'none',
           isDirty: served.dirty, rcNote };
}

// ── Shared step builders ──

function buildDisconnectedStep(steps) {
  steps.push({
    ...TEXTS.read.disconnected,
    run: async () => {
      state.readClient.phase = 'error';
      log('Read failed - reader disconnected.', 'err');
      draw();
    },
  });
}

function buildIssueReadStep(steps, rc, readPref, target, vLabel, rcNote) {
  const tIssue = TEXTS.read.issueRead(rc, readPrefLabel(readPref), vLabel, rcNote[rc], rc === 'linearizable' && readPref !== 'primary');
  steps.push({
    title: tIssue.title, explain: tIssue.explain,
    run: async () => {
      state.readClient.phase = 'waiting';
      if (!target || !target.alive) {
        state.readClient.phase = 'error';
        log(`No ${readPref} node available.`, 'err');
        draw(); return;
      }
      await awaitParticle(state.readClient, target, THEME.flowRead, 'read?', () => {
        log(`Read arrived at ${target.label} (rc:${rc}, node holds v${target.memoryVersion || 'none'}).`, 'info');
      });
    },
  });
}

function buildNoTargetStep(steps, readPref) {
  const tNo = TEXTS.read.noEligibleNode(readPref);
  steps.push({
    title: tNo.title, explain: tNo.explain,
    run: async () => { state.readClient.phase = 'error'; log('Read failed - no eligible node.', 'err'); draw(); },
  });
}

// ── Per-concern dispatch ──

function buildConcernSteps(steps, rc, rctx, snapshotOverrideId) {
  const { targetKey, target, majorityOk, frozenExplainCount, served, vLabel, isDirty } = rctx;
  if (rc === 'local' || rc === 'available') {
    buildLocalReadSteps(steps, target, targetKey, rc);
  } else if (rc === 'majority') {
    if (buildMajorityReadSteps(steps, target, targetKey, vLabel, majorityOk, frozenExplainCount)) return true;
  } else if (rc === 'linearizable') {
    buildLinearizableReadSteps(steps, target, targetKey);
  } else if (rc === 'snapshot') {
    buildSnapshotReadSteps(steps, target, targetKey, snapshotOverrideId);
  }
  buildDataReturnStep(steps, rc, target, targetKey, served, vLabel, isDirty, snapshotOverrideId);
  return false;
}

// ── Main orchestrator ──

function buildReadSteps(rc, readPref, snapshotOverrideId = null) {
  const steps = [];

  if (!state.links.rp) { buildDisconnectedStep(steps); return steps; }

  const rctx = computeReadContext(rc, readPref, snapshotOverrideId);
  buildIssueReadStep(steps, rc, readPref, rctx.target, rctx.vLabel, rctx.rcNote);

  if (!rctx.target || !rctx.target.alive) { buildNoTargetStep(steps, readPref); return steps; }

  buildConcernSteps(steps, rc, rctx, snapshotOverrideId);
  return steps;
}
