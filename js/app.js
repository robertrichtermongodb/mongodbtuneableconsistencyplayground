// ═══════════════════════════════════════
// MAIN ACTIONS
// ═══════════════════════════════════════
function handleWrite() {
  if (writeEngine.busy || (writeEngine.idx !== -1 && !writeEngine.done && !writeEngine.aborted)) return;
  resetWriteVisual();
  draw();
  const w  = document.getElementById('sel-w').value;
  const wResolved = w === 'majority' ? 'majority' : parseInt(w, 10);
  const j  = document.getElementById('sel-j').value === 'true';
  log(`─── Write: w:${wResolved}, j:${j} ───`, 'info');
  runEngine(buildWriteSteps(wResolved, j), writeEngine, 'write-step-panel');
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
  resetEngine(writeEngine);
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
  resetEngine(readEngine);
  showStepPanel(-1, readEngine, 'read-step-panel');
}

function resetElectionVisual() {
  resetEngine(electionEngine);
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
// CANVAS INTERACTION (node/link toggle)
// ═══════════════════════════════════════
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  if (!hit) return;

  if (hit.type === 'node') {
    const n = state.nodes[hit.key];
    const wasAlive = n.alive;
    n.alive = !n.alive;
    if (!n.alive) {
      // Crash: wipe volatile memory, preserve journal
      const hadUnjournaledData = n.memoryVersion > n.journalVersion;
      crashNode(hit.key);
      log(`${n.label} taken down — memory lost${hadUnjournaledData ? ' (unjournaled data lost!)' : ''}, journal preserved (v${n.journalVersion || 'none'}).`, 'warn');
    } else {
      // Restart: recover from journal
      const recoveredVersion = n.journalVersion;
      recoverNode(hit.key);
      n.phase = 'recovering';
      draw();
      if (recoveredVersion > 0) {
        log(`${n.label} recovering from journal — restored to v${recoveredVersion}.`, 'ok');
      } else {
        log(`${n.label} restarted with empty state.`, 'info');
      }
      setTimeout(() => { if (n.alive) { n.phase = 'idle'; draw(); syncButtons(); } }, 600);
    }
    resetWriteVisual(); resetReadVisual(); if (!electionEngine.done) resetElectionVisual();
  } else if (hit.type === 'link') {
    const lk = getLinkBetween(state.primaryKey, hit.key);
    if (lk) {
      state.links[lk] = !state.links[lk];
      const label = `${state.nodes[state.primaryKey].label} \u2194 ${state.nodes[hit.key].label}`;
      log(`${label}: ${state.links[lk] ? 'connected' : 'partitioned'} — document state preserved.`, state.links[lk] ? 'ok' : 'warn');
      resetWriteVisual(); resetReadVisual(); if (!electionEngine.done) resetElectionVisual();
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
  const prev = getHoverTarget();
  const changed = (prev?.type !== hit?.type || prev?.key !== hit?.key);
  if (changed) { setHoverTarget(hit); draw(); }
});

canvas.addEventListener('mouseleave', () => {
  if (getHoverTarget()) { setHoverTarget(null); draw(); }
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
    state.links.rp = true;
    resetReadVisual();
    updateReadActionControls();
    draw();
    syncButtons();
  });
});
window.addEventListener('resize', resizeCanvas);

// Button event listeners
document.getElementById('btn-reset').addEventListener('click', resetScenario);
document.getElementById('btn-write-start').addEventListener('click', handleWrite);
document.getElementById('btn-write-next').addEventListener('click', handleWritePanelNext);
document.getElementById('btn-write-finish').addEventListener('click', handleWritePanelFinish);
document.getElementById('btn-read-start').addEventListener('click', handleRead);
document.getElementById('btn-read-session-start').addEventListener('click', handleSnapshotStart);
document.getElementById('btn-read-session-again').addEventListener('click', handleSnapshotReadAgain);
document.getElementById('btn-read-session-end').addEventListener('click', handleSnapshotEnd);
document.getElementById('btn-read-next').addEventListener('click', advanceReadStep);
document.getElementById('btn-read-finish').addEventListener('click', autoFinishRead);
document.getElementById('btn-canvas-election').addEventListener('click', handleElection);
document.getElementById('btn-dismiss-welcome').addEventListener('click', dismissWelcomePopup);
document.getElementById('btn-dismiss-wip').addEventListener('click', dismissWipPopup);

// ═══════════════════════════════════════
// POPUPS
// ═══════════════════════════════════════
function dismissWelcomePopup() {
  localStorage.setItem('tcp-welcome-seen', '1');
  document.getElementById('welcome-overlay').classList.remove('visible');
  document.getElementById('wip-overlay').classList.add('visible');
}

function dismissWipPopup() {
  document.getElementById('wip-overlay').classList.remove('visible');
}

function initPopups() {
  if (!localStorage.getItem('tcp-welcome-seen')) {
    document.getElementById('welcome-overlay').classList.add('visible');
  }
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
resizeCanvas();
updateReadActionControls();
syncButtons();
initPopups();
log('Ready — click nodes/links to set topology, click client arrows to interrupt connections.', 'info');
