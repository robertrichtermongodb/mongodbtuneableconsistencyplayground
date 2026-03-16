// ═══════════════════════════════════════
// LOG
// ═══════════════════════════════════════
const logEl = document.getElementById('log');
function log(msg, cls = 'info') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = `[${new Date().toLocaleTimeString()}]  ${msg}`;
  logEl.prepend(el);
}

// ═══════════════════════════════════════
// MAIN ACTIONS
// ═══════════════════════════════════════
function handleWrite() {
  if (writeEngine.busy || (writeEngine.idx !== -1 && !writeEngine.done && !writeEngine.aborted)) return;
  resetWriteVisual();
  draw();
  const w  = resolveW(document.getElementById('sel-w').value);
  const j  = document.getElementById('sel-j').value === 'true';
  log(`─── Write: w:${w}, j:${j} ───`, 'info');
  runEngine(buildWriteSteps(w, j), writeEngine, 'write-step-panel');
}

function handleRead() {
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted)) return;
  resetReadVisual();
  draw();
  const rc       = document.getElementById('sel-rc').value;
  const readPref = document.getElementById('sel-readpref').value;
  log(`─── Read: rc:${rc}, readPref:${readPref} ───`, 'info');
  runEngine(buildReadSteps(rc, readPref), readEngine, 'read-step-panel');
}

function handleSnapshotStart() {
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted)) return;
  resetReadVisual({ clearSession: false });
  state.readClient.sessionActive = true;
  state.readClient.sessionSnapshotId = state.doc.majorityCommitId;
  draw();
  const readPref = document.getElementById('sel-readpref').value;
  const snapLabel = state.readClient.sessionSnapshotId > 0 ? `v${state.readClient.sessionSnapshotId}` : 'none';
  log(`─── Snapshot session started @ ${snapLabel} ───`, 'info');
  runEngine(buildReadSteps('snapshot', readPref, state.readClient.sessionSnapshotId), readEngine, 'read-step-panel');
}

function handleSnapshotReadAgain() {
  if (!state.readClient.sessionActive || state.readClient.sessionSnapshotId === null) return;
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted)) return;
  resetReadVisual({ clearSession: false });
  draw();
  const readPref = document.getElementById('sel-readpref').value;
  const snapLabel = state.readClient.sessionSnapshotId > 0 ? `v${state.readClient.sessionSnapshotId}` : 'none';
  log(`─── Snapshot reread @ ${snapLabel} ───`, 'info');
  runEngine(buildReadSteps('snapshot', readPref, state.readClient.sessionSnapshotId), readEngine, 'read-step-panel');
}

function handleSnapshotEnd() {
  state.readClient.sessionActive = false;
  state.readClient.sessionSnapshotId = null;
  resetReadVisual({ clearSession: false });
  draw();
  syncButtons();
  log('Snapshot session ended.', 'info');
}

function resetWriteVisual() {
  state.particles = [];
  Object.values(state.nodes).forEach(n => { n.phase = 'idle'; });
  state.writeClient.phase = 'idle';
  writeEngine.done = false; writeEngine.idx = -1; writeEngine.aborted = false;
  writeEngine._waitResolve = null; writeEngine.busy = false; writeEngine.steps = [];
  if (_autoFinishId) { clearInterval(_autoFinishId); _autoFinishId = null; }
  showStepPanel(-1, writeEngine, 'write-step-panel');
}

function resetReadVisual(opts = {}) {
  const clearSession = opts.clearSession !== false;
  state.particles = [];
  state.readClient.phase = 'idle';
  if (clearSession) {
    state.readClient.sessionActive = false;
    state.readClient.sessionSnapshotId = null;
  }
  readEngine.done = false; readEngine.idx = -1; readEngine.aborted = false;
  readEngine._waitResolve = null; readEngine.busy = false; readEngine.steps = [];
  if (_autoFinishReadId) { clearInterval(_autoFinishReadId); _autoFinishReadId = null; }
  showStepPanel(-1, readEngine, 'read-step-panel');
}

function resetElectionVisual() {
  electionEngine.done = false; electionEngine.idx = -1; electionEngine.aborted = false;
  electionEngine._waitResolve = null; electionEngine.busy = false; electionEngine.steps = [];
  if (_autoFinishElectionId) { clearInterval(_autoFinishElectionId); _autoFinishElectionId = null; }
  // Remove election-mode class and restore write panel to its idle state
  const writePanelEl = document.getElementById('write-step-panel');
  if (writePanelEl) {
    writePanelEl.classList.remove('election-mode');
    const lbl = writePanelEl.querySelector('.step-label');
    if (lbl) lbl.textContent = 'WRITE';
  }
  showStepPanel(-1, writeEngine, 'write-step-panel');
}

function handleElection() {
  if (electionEngine.busy || (electionEngine.idx !== -1 && !electionEngine.done && !electionEngine.aborted)) return;
  resetElectionVisual();
  resetWriteVisual();
  resetReadVisual();
  draw();
  log('─── Election triggered ───', 'warn');
  // Election steps display in the write panel (writes are blocked during election)
  runEngine(buildElectionSteps(), electionEngine, 'write-step-panel');
}

function resetScenario() {
  resetWriteVisual();
  resetReadVisual();
  resetElectionVisual();
  resetDoc();
  resetLinks();
  Object.values(state.nodes).forEach(n => { n.alive = true; n.phase = 'idle'; });
  draw();
  syncButtons();
  log('Scenario reset — all nodes healthy, all links connected, document cleared.', 'info');
}

// ═══════════════════════════════════════
// CONSISTENCY PERSPECTIVE VIEWS
// ═══════════════════════════════════════
function updateConsistencyViews() {
  const wBox = document.getElementById('writer-consistency');
  const rBox = document.getElementById('reader-consistency');
  const doc  = state.doc;

  // ── Writer perspective ──
  if (doc.latestId === 0) {
    wBox.innerHTML = '<div class="cb-dim">No writes issued</div>';
  } else {
    const vid = doc.latestId;
    const committed = vid <= doc.majorityCommitId;
    const version = doc.versions.find(v => v.id === vid);
    const ackCount = version ? version.ackedBy.size : 0;
    const wc = state.writeClient;
    const wVal = document.getElementById('sel-w').value;

    if (wc.phase === 'error') {
      wBox.innerHTML =
        `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-error">\u26A0 Write concern failed</div>` +
        `<div class="cb-detail">w:${wVal} not satisfied. Data on primary but unconfirmed. Rollback risk if primary fails.</div>`;
    } else if (committed) {
      wBox.innerHTML =
        `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-ok">\u25C9 Majority-committed</div>` +
        `<div class="cb-detail">Durable \u2014 survives any minority node failure. ${ackCount} node(s) confirmed.</div>`;
    } else if (wVal === '0') {
      wBox.innerHTML =
        `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-warn">\u25CE Fire-and-forget</div>` +
        `<div class="cb-detail">w:0 \u2014 no ACK requested. Durability unknown to client.</div>`;
    } else {
      wBox.innerHTML =
        `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-warn">\u25CE In-flight \u2014 ${ackCount}/2 majority</div>` +
        `<div class="cb-detail">Not yet majority-committed. Rollback risk if primary fails before majority.</div>`;
    }
  }

  // ── Reader perspective ──
  const rc = state.readClient;
  const rcVal = document.getElementById('sel-rc').value;
  const sessionLabel = rc.sessionActive
    ? (rc.sessionSnapshotId > 0 ? `v${rc.sessionSnapshotId}` : 'none')
    : null;
  const sessionSuffix = sessionLabel !== null ? ` Session locked at ${sessionLabel}.` : '';

  if (rc.lastReceivedVersion === null && rc.phase === 'idle') {
    rBox.innerHTML = '<div class="cb-dim">No reads completed</div>';
  } else if (rc.phase === 'waiting') {
    rBox.innerHTML =
      `<div class="cb-label">Reading\u2026</div>` +
      `<div class="cb-status" style="color:#7EC8E3">rc:${rcVal}</div>` +
      `<div class="cb-detail">Request in progress.${sessionSuffix}</div>`;
  } else if (rc.phase === 'error') {
    rBox.innerHTML =
      `<div class="cb-label">Read failed</div>` +
      `<div class="cb-status cb-error">\u26A0 No eligible node</div>` +
      `<div class="cb-detail">The target node is unavailable. Read cannot be served.${sessionSuffix}</div>`;
  } else if (rc.lastReceivedVersion !== null) {
    const v = rc.lastReceivedVersion;
    const vStr = v.id > 0 ? `v${v.id}` : 'none';

    if (v.id === 0) {
      const reason = (rcVal === 'local' || rcVal === 'available')
        ? 'Node has no data yet.'
        : `No majority-committed data exists (latest v${doc.latestId} still in-flight).`;
      rBox.innerHTML =
        `<div class="cb-label">Read result: none</div>` +
        `<div class="cb-status cb-dim">No data returned</div>` +
        `<div class="cb-detail">rc:${rcVal} \u2014 ${reason}${sessionSuffix}</div>`;
    } else if (v.dirty) {
      rBox.innerHTML =
        `<div class="cb-label">Read result: ${vStr}</div>` +
        `<div class="cb-status cb-warn">\u25CE Dirty read \u2014 uncommitted</div>` +
        `<div class="cb-detail">rc:${rcVal} returned data above majority-commit (v${doc.majorityCommitId || 'none'}). If primary fails, this write may roll back.${sessionSuffix}</div>`;
    } else {
      rBox.innerHTML =
        `<div class="cb-label">Read result: ${vStr}</div>` +
        `<div class="cb-status cb-ok">\u25C9 Safe \u2014 majority-confirmed</div>` +
        `<div class="cb-detail">rc:${rcVal} guarantees this data will not be rolled back.${sessionSuffix}</div>`;
    }
  }
}

function updateReadActionControls() {
  const rcVal = document.getElementById('sel-rc')?.value;
  const isSnapshot = rcVal === 'snapshot';
  const btnDefault = document.getElementById('btn-read-start');
  const snapWrap = document.getElementById('snapshot-session-actions');
  if (!btnDefault || !snapWrap) return;
  btnDefault.style.display = isSnapshot ? 'none' : '';
  snapWrap.style.display = isSnapshot ? 'flex' : 'none';
}

// ═══════════════════════════════════════
// CANVAS INTERACTION (node/link toggle)
// ═══════════════════════════════════════
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;

  if (hit.type === 'node') {
    state.nodes[hit.key].alive = !state.nodes[hit.key].alive;
    const n = state.nodes[hit.key];
    log(`${n.label} ${n.alive ? 'brought online' : 'taken down'} — document state preserved.`, n.alive ? 'ok' : 'warn');
    resetWriteVisual(); resetReadVisual(); resetElectionVisual();
  } else if (hit.type === 'link') {
    const lk = getLinkBetween(state.primaryKey, hit.key);
    if (lk) {
      state.links[lk] = !state.links[lk];
      const label = `${state.nodes[state.primaryKey].label} \u2194 ${state.nodes[hit.key].label}`;
      log(`${label}: ${state.links[lk] ? 'connected' : 'partitioned'} — document state preserved.`, state.links[lk] ? 'ok' : 'warn');
      resetWriteVisual(); resetReadVisual(); resetElectionVisual();
    }
  } else if (hit.type === 'clientLink') {
    if (hit.key === 'wp') {
      state.links.wp = !state.links.wp;
      log(`Writer \u2192 Primary: ${state.links.wp ? 'connected' : 'disconnected'}.`, state.links.wp ? 'ok' : 'warn');
      if (!state.links.wp && !writeEngine.done && writeEngine.idx >= 0 && !writeEngine.aborted) {
        abortEngine(writeEngine);
        state.writeClient.phase = 'error';
        log('\u26A1 Writer connection interrupted \u2014 write timeout.', 'err');
      }
    } else if (hit.key === 'rp') {
      state.links.rp = !state.links.rp;
      log(`Reader connection: ${state.links.rp ? 'connected' : 'disconnected'}.`, state.links.rp ? 'ok' : 'warn');
      if (!state.links.rp && !readEngine.done && readEngine.idx >= 0 && !readEngine.aborted) {
        abortEngine(readEngine);
        state.readClient.phase = 'error';
        log('\u26A1 Reader connection interrupted \u2014 read timeout.', 'err');
      }
    }
  }

  draw(); syncButtons();
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  canvas.style.cursor = hit ? 'pointer' : 'default';
  const changed = (hoverTarget?.type !== hit?.type || hoverTarget?.key !== hit?.key);
  if (changed) { hoverTarget = hit; draw(); }
});

canvas.addEventListener('mouseleave', () => {
  if (hoverTarget) { hoverTarget = null; draw(); }
});

// ═══════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════
['sel-w','sel-j'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { resetWriteVisual(); draw(); });
});
['sel-rc','sel-readpref'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    if (id === 'sel-rc' && document.getElementById('sel-rc')?.value !== 'snapshot') {
      state.readClient.sessionActive = false;
      state.readClient.sessionSnapshotId = null;
    }
    resetReadVisual();
    updateReadActionControls();
    draw();
    syncButtons();
  });
});
window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
resizeCanvas();
updateReadActionControls();
syncButtons();
log('Ready — click nodes/links to set topology, click client arrows to interrupt connections.', 'info');
