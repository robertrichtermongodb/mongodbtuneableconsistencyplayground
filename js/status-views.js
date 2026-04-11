// ═══════════════════════════════════════
// CONSISTENCY OVERLAY VIEWS
// ═══════════════════════════════════════

function updateWriteStatusView(wBox) {
  const doc = state.doc;
  const primaryDown = !state.nodes[state.primaryKey].alive;
  const anyAlive    = Object.values(state.nodes).some(n => n.alive);

  if (primaryDown && anyAlive) { wBox.innerHTML = TEXTS.consistency.noPrimary; return; }
  if (doc.latestId === 0) { wBox.innerHTML = TEXTS.consistency.noWrites; return; }

  const vid = doc.latestId;
  const committed = vid <= doc.majorityCommitId;
  const version = doc.versions.find(v => v.id === vid);
  const acks = version ? version.ackedBy.size : 0;
  const wc = state.writeClient;
  const wVal = getSelectedWriteConcern();
  const isDefault  = wVal === 'majority';
  const safetyNote = TEXTS.safetyNote;
  const ackButLost = wc.phase === 'received' && acks === 0 && !committed;

  if (wc.phase === 'error')   wBox.innerHTML = TEXTS.consistency.writeFailed(vid, wVal, isDefault, safetyNote);
  else if (ackButLost)        wBox.innerHTML = TEXTS.consistency.ackButLost(vid, wVal);
  else if (committed)         wBox.innerHTML = TEXTS.consistency.committed(vid, acks);
  else if (wVal === '0')      wBox.innerHTML = TEXTS.consistency.fireForget(vid, safetyNote);
  else                        wBox.innerHTML = TEXTS.consistency.inFlight(vid, acks, isDefault, safetyNote);
}

function readStatusHTML(rcVal, ver, sessionSuffix) {
  const vStr = ver.id > 0 ? `v${ver.id}` : 'none';
  if (ver.id === 0) {
    const reason = (rcVal === 'local' || rcVal === 'available')
      ? 'Node has no data yet.'
      : `No majority-confirmed data exists (latest v${state.doc.latestId} still in-flight).`;
    return TEXTS.consistency.readNone(rcVal, reason, sessionSuffix);
  }
  if (ver.dirty) return TEXTS.consistency.dirtyRead(vStr, rcVal, state.doc.majorityCommitId, sessionSuffix);
  return TEXTS.consistency.safeRead(vStr, rcVal, sessionSuffix);
}

function updateReadStatusView(rBox) {
  const rc = state.readClient;
  const rcVal = getSelectedReadConcern();
  const sessionLabel = rc.sessionActive
    ? (rc.sessionSnapshotId > 0 ? `v${rc.sessionSnapshotId}` : 'none')
    : null;
  const sessionSuffix = sessionLabel !== null ? ` Session locked at ${sessionLabel}.` : '';

  if (rc.lastReceivedVersion === null && rc.phase === 'idle') {
    rBox.innerHTML = TEXTS.consistency.noReads; return;
  }
  if (rc.phase === 'waiting') { rBox.innerHTML = TEXTS.consistency.reading(rcVal, sessionSuffix); return; }
  if (rc.phase === 'error') {
    rBox.innerHTML = rc.errorReason === 'linearizable'
      ? TEXTS.consistency.readLinearizableBlocked(sessionSuffix)
      : rc.errorReason === 'linearizableNotPrimary'
      ? TEXTS.consistency.readLinearizableNotPrimary(sessionSuffix)
      : TEXTS.consistency.readFailed(sessionSuffix);
    return;
  }
  if (rc.lastReceivedVersion === null) return;
  rBox.innerHTML = readStatusHTML(rcVal, rc.lastReceivedVersion, sessionSuffix);
}

function updateConsistencyViews() {
  updateWriteStatusView(document.getElementById('write-status'));
  updateReadStatusView(document.getElementById('read-status'));
}

function updateReadActionControls() {
  const rcVal = getSelectedReadConcern();
  const isSnapshot = rcVal === 'snapshot';
  const btnDefault = document.getElementById('btn-read-start');
  const snapWrap = document.getElementById('session-actions');
  if (!btnDefault || !snapWrap) return;
  btnDefault.style.display = isSnapshot ? 'none' : '';
  snapWrap.style.display = isSnapshot ? 'flex' : 'none';
}
