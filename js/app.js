// ═══════════════════════════════════════
// CUSTOM TOOLTIP COMPONENT
// ═══════════════════════════════════════

const tipEl = document.createElement('div');
tipEl.className = 'tip';
tipEl.innerHTML = '<div class="tip-title"></div><div class="tip-body"></div><div class="tip-arrow"></div>';
document.body.appendChild(tipEl);

let tipTimer = null;
let tipTarget = null;
const TIP_DELAY = 420;

function showTip(el) {
  const raw = el.getAttribute('data-tip') || '';
  if (!raw) return;

  const parts = raw.split('\n\n');
  const titleEl = tipEl.querySelector('.tip-title');
  const bodyEl  = tipEl.querySelector('.tip-body');

  if (parts.length > 1) {
    titleEl.textContent = parts[0];
    titleEl.style.display = '';
    bodyEl.innerHTML = parts.slice(1).join('<br><br>');
  } else {
    titleEl.style.display = 'none';
    bodyEl.innerHTML = raw.replace(/\n/g, '<br>');
  }

  tipEl.classList.remove('below');
  tipEl.classList.add('visible');

  const tipRect = tipEl.getBoundingClientRect();
  const elRect  = el.getBoundingClientRect();
  let top  = elRect.top - tipRect.height - 10;
  let left = elRect.left + elRect.width / 2 - tipRect.width / 2;

  if (top < 4) {
    top = elRect.bottom + 10;
    tipEl.classList.add('below');
  }
  left = Math.max(6, Math.min(left, window.innerWidth - tipRect.width - 6));

  tipEl.style.top  = top + 'px';
  tipEl.style.left = left + 'px';

  const arrowEl = tipEl.querySelector('.tip-arrow');
  const arrowX  = elRect.left + elRect.width / 2 - left;
  arrowEl.style.left = Math.max(12, Math.min(arrowX, tipRect.width - 12)) + 'px';
  arrowEl.style.marginLeft = '0';
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTimer = null;
  tipTarget = null;
  tipEl.classList.remove('visible');
}

document.addEventListener('mouseenter', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  if (tipTarget === el) return;
  hideTip();
  tipTarget = el;
  tipTimer = setTimeout(() => showTip(el), TIP_DELAY);
}, true);

document.addEventListener('mouseleave', e => {
  const el = e.target.closest('[data-tip]');
  if (el && el === tipTarget) hideTip();
}, true);

document.addEventListener('click', () => hideTip(), true);
document.addEventListener('scroll', () => hideTip(), true);

// ═══════════════════════════════════════
// TOOLTIP DEFINITIONS
// ═══════════════════════════════════════

const DROPDOWN_TIPS = TEXTS.dropdowns;
const BUTTON_TIPS  = TEXTS.buttons;

function syncTooltips() {
  for (const [id, map] of Object.entries(DROPDOWN_TIPS)) {
    const el = document.getElementById(id);
    if (el) {
      el.removeAttribute('title');
      el.setAttribute('data-tip', map[el.value] || '');
    }
  }
}

function initButtonTips() {
  for (const [id, text] of Object.entries(BUTTON_TIPS)) {
    const el = document.getElementById(id);
    if (el) {
      el.removeAttribute('title');
      el.setAttribute('data-tip', text);
    }
  }
}

// ═══════════════════════════════════════
// NON-DEFAULT CONFIG BADGE
// ═══════════════════════════════════════
function syncWBadge() {
  const badge = document.getElementById('w-default-badge');
  if (!badge) return;
  const w = document.getElementById('sel-w').value;
  if (w === 'majority') {
    badge.className = 'config-badge config-badge-ok';
    badge.textContent = '✓ DEFAULT';
    badge.setAttribute('data-tip', TEXTS.badge.default);
  } else {
    badge.className = 'config-badge config-badge-warn';
    badge.textContent = '⚠ NON-DEFAULT';
    badge.setAttribute('data-tip', TEXTS.badge.nonDefault(w));
  }
}
document.getElementById('sel-w').addEventListener('change', syncWBadge);

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
  log(`\u2500\u2500\u2500 Write: w:${wResolved}, j:${j} \u2500\u2500\u2500`, 'info');
  runMachine(createWriteMachine(wResolved, j), writeEngine, 'write-step-panel');
}

function handleRead() {
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted)) return;
  resetReadVisual();
  draw();
  const rc       = document.getElementById('sel-rc').value;
  const readPref = document.getElementById('sel-readpref').value;
  log(`\u2500\u2500\u2500 Read: rc:${rc}, readPref:${readPref} \u2500\u2500\u2500`, 'info');
  runMachine(arrayMachine(buildReadSteps(rc, readPref)), readEngine, 'read-step-panel');
}

function handleSnapshotStart() {
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted)) return;
  resetReadVisual({ clearSession: false });
  state.readClient.sessionActive = true;
  state.readClient.sessionSnapshotId = state.doc.majorityCommitId;
  draw();
  const readPref = document.getElementById('sel-readpref').value;
  const snapLabel = state.readClient.sessionSnapshotId > 0 ? `v${state.readClient.sessionSnapshotId}` : 'none';
  log(`\u2500\u2500\u2500 Snapshot session started @ ${snapLabel} \u2500\u2500\u2500`, 'info');
  runMachine(arrayMachine(buildReadSteps('snapshot', readPref, state.readClient.sessionSnapshotId)), readEngine, 'read-step-panel');
}

function handleSnapshotReadAgain() {
  if (!state.readClient.sessionActive || state.readClient.sessionSnapshotId === null) return;
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted)) return;
  resetReadVisual({ clearSession: false });
  draw();
  const readPref = document.getElementById('sel-readpref').value;
  const snapLabel = state.readClient.sessionSnapshotId > 0 ? `v${state.readClient.sessionSnapshotId}` : 'none';
  log(`\u2500\u2500\u2500 Snapshot reread @ ${snapLabel} \u2500\u2500\u2500`, 'info');
  runMachine(arrayMachine(buildReadSteps('snapshot', readPref, state.readClient.sessionSnapshotId)), readEngine, 'read-step-panel');
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
  log('\u2500\u2500\u2500 Election triggered \u2500\u2500\u2500', 'warn');
  runMachine(arrayMachine(buildElectionSteps()), electionEngine, 'write-step-panel');
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
    n.alive = !n.alive;
    const writeActive = writeEngine.idx !== -1 && !writeEngine.done && !writeEngine.aborted;
    if (!n.alive) {
      const hadUnjournaledData = n.memoryVersion > n.journalVersion;
      crashNode(hit.key);
      log(`${n.label} taken down \u2014 memory lost${hadUnjournaledData ? ' (unjournaled data lost!)' : ''}, journal preserved (v${n.journalVersion || 'none'}).`, 'warn');
    } else {
      const recoveredVersion = n.journalVersion;
      recoverNode(hit.key);
      n.phase = 'recovering';
      draw();
      if (recoveredVersion > 0) {
        log(`${n.label} recovering from journal \u2014 restored to v${recoveredVersion}.`, 'ok');
      } else {
        log(`${n.label} restarted with empty state.`, 'info');
      }
      setTimeout(() => { if (n.alive) { n.phase = 'idle'; draw(); syncButtons(); } }, 600);
    }
    if (!writeActive) resetWriteVisual();
    resetReadVisual();
    if (!electionEngine.done) resetElectionVisual();
  } else if (hit.type === 'link') {
    const lk = getLinkBetween(state.primaryKey, hit.key);
    if (lk) {
      state.links[lk] = !state.links[lk];
      const label = `${state.nodes[state.primaryKey].label} \u2194 ${state.nodes[hit.key].label}`;
      log(`${label}: ${state.links[lk] ? 'connected' : 'partitioned'} \u2014 document state preserved.`, state.links[lk] ? 'ok' : 'warn');
      const writeActive = writeEngine.idx !== -1 && !writeEngine.done && !writeEngine.aborted;
      if (!writeActive) resetWriteVisual();
      resetReadVisual();
      if (!electionEngine.done) resetElectionVisual();
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
  document.getElementById(id)?.addEventListener('change', () => { resetWriteVisual(); draw(); syncTooltips(); });
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
    syncTooltips();
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
document.getElementById('btn-clear-log').addEventListener('click', () => { document.getElementById('log').innerHTML = ''; });
document.getElementById('btn-dismiss-mobile').addEventListener('click', dismissMobilePopup);
document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

// ═══════════════════════════════════════
// POPUPS
// ═══════════════════════════════════════
function dismissMobilePopup() {
  document.getElementById('mobile-overlay').classList.remove('visible');
}

function initPopups() {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    document.getElementById('mobile-overlay').classList.add('visible');
  }
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
resizeCanvas();
updateReadActionControls();
syncButtons();
syncWBadge();
initButtonTips();
syncTooltips();
initPopups();
log('Ready — click nodes/links to set topology, click client arrows to interrupt connections.', 'info');
