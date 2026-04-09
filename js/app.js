// ═══════════════════════════════════════
// NON-DEFAULT CONFIG BADGE
// ═══════════════════════════════════════
function syncWBadge() {
  const badge = document.getElementById('w-default-pill');
  if (!badge) return;
  const w = getSelectedWriteConcern();
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
  if (isEngineActive(readEngine) || isEngineActive(writeEngine)) return;
  resetWriteVisual();
  draw();
  const w  = getSelectedWriteConcern();
  const wResolved = w === 'majority' ? 'majority' : parseInt(w, 10);
  const journalRequired = isJournalRequired();
  log(`\u2500\u2500\u2500 Write: w:${wResolved}, j:${journalRequired} \u2500\u2500\u2500`, 'info');
  runMachine(createWriteMachine(wResolved, journalRequired), writeEngine, 'write-step-panel');
}

function handleRead() {
  if (isEngineActive(readEngine)) return;
  resetReadVisual();
  draw();
  const rc       = getSelectedReadConcern();
  const readPref = getSelectedReadPref();
  log(`\u2500\u2500\u2500 Read: rc:${rc}, readPref:${readPref} \u2500\u2500\u2500`, 'info');
  runMachine(arrayMachine(buildReadSteps(rc, readPref)), readEngine, 'read-step-panel');
}

function handleSnapshotStart() {
  if (isEngineActive(readEngine)) return;
  resetReadVisual({ clearSession: false });
  state.readClient.sessionActive = true;
  state.readClient.sessionSnapshotId = state.doc.majorityCommitId;
  draw();
  const readPref = getSelectedReadPref();
  const snapLabel = state.readClient.sessionSnapshotId > 0 ? `v${state.readClient.sessionSnapshotId}` : 'none';
  log(`\u2500\u2500\u2500 Snapshot session started @ ${snapLabel} \u2500\u2500\u2500`, 'info');
  runMachine(arrayMachine(buildReadSteps('snapshot', readPref, state.readClient.sessionSnapshotId)), readEngine, 'read-step-panel');
}

function handleSnapshotReadAgain() {
  if (!state.readClient.sessionActive || state.readClient.sessionSnapshotId === null) return;
  if (isEngineActive(readEngine)) return;
  resetReadVisual({ clearSession: false });
  draw();
  const readPref = getSelectedReadPref();
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
  state.readClient.errorReason = null;
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
  if (isEngineActive(electionEngine)) return;
  resetElectionVisual();
  resetWriteVisual();
  resetReadVisual();
  draw();
  const partitioned = isPrimaryPartitioned();
  log(`\u2500\u2500\u2500 Election triggered${partitioned ? ' (partition)' : ''} \u2500\u2500\u2500`, 'warn');
  runMachine(arrayMachine(buildElectionSteps(partitioned ? { forcePartition: true } : undefined)), electionEngine, 'write-step-panel');
}

// Called when any link is restored. Since the simulator uses instant step-down
// (no stale-primary writes), there's nothing to roll back — just cap
// reconnected node versions to the majority-committed level.
function checkPartitionHealed() {
  const pk = state.primaryKey;
  let healed = false;
  for (const k of Object.keys(state.nodes)) {
    if (k === pk || !state.nodes[k].alive) continue;
    const before = state.nodes[k].memoryVersion;
    if (syncRejoiningNode(k) && state.nodes[k].memoryVersion !== before) {
      healed = true;
    }
  }
  if (healed) {
    state.writeClient.phase = 'idle';
    Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    log(`Partition healed \u2014 isolated node(s) rejoined. ${state.nodes[pk].label} remains primary.`, 'ok');
    draw();
    syncButtons();
  }
}

function resetScenario() {
  resetWriteVisual();
  resetReadVisual();
  resetElectionVisual();
  resetDoc();
  resetLinks();
  resetClientDrag();
  state.writeClient.targetNode = null;
  state.readClient.targetNode = null;
  Object.values(state.nodes).forEach(n => { n.alive = true; n.phase = 'idle'; });
  computeLayout(canvasW, canvasH);
  draw();
  syncButtons();
  refreshIdlePanels();
  log('Scenario reset - all nodes healthy, all links connected, document cleared.', 'info');
}

// ═══════════════════════════════════════
// CANVAS TOOLTIPS (native title attribute based on hover target)
// ═══════════════════════════════════════
function tipForLink(hit) {
  const tips = TEXTS.canvasTips;
  const pairMap = { ps1: ['primary', 's1'], ps2: ['primary', 's2'], s1s2: ['s1', 's2'] };
  const pair = pairMap[hit.key];
  if (!pair) return '';
  const labelA = state.nodes[pair[0]].label;
  const labelB = state.nodes[pair[1]].label;
  const linked = state.links[hit.key];
  const isSecSec = pair[0] !== state.primaryKey && pair[1] !== state.primaryKey;
  return isSecSec ? tips.linkSecSec(labelA, labelB, linked) : tips.link(labelA, labelB, linked);
}

function tipForClient(hit) {
  const tips = TEXTS.canvasTips;
  const client = hit.key === 'write' ? state.writeClient : state.readClient;
  const nodeKeys = [null, ...Object.keys(state.nodes)];
  const idx = nodeKeys.indexOf(client.targetNode);
  const nextKey = nodeKeys[(idx + 1) % nodeKeys.length];
  const nextLabel = nextKey ? state.nodes[nextKey].label : 'auto';
  const currentLabel = client.targetNode ? state.nodes[client.targetNode].label : 'auto';
  const targetStr = `current = ${currentLabel}, next click = ${nextLabel}`;
  return hit.key === 'write' ? tips.clientWrite(targetStr) : tips.clientRead(targetStr);
}

function canvasTipFor(hit) {
  if (!hit) return '';
  const tips = TEXTS.canvasTips;
  if (hit.type === 'node') return tips.node(state.nodes[hit.key].label, state.nodes[hit.key].alive);
  if (hit.type === 'link') return tipForLink(hit);
  if (hit.type === 'client') return tipForClient(hit);
  if (hit.type === 'clientLink') return tips.clientLink(hit.key, state.links[hit.key]);
  if (hit.type === 'lockBanner') return tips.lockBanner;
  return '';
}

// ═══════════════════════════════════════
// CLIENT TARGETING (click client circle to cycle target node)
// ═══════════════════════════════════════
function cycleClientTarget(clientKey) {
  const nodeKeys = [null, ...Object.keys(state.nodes)]; // null = auto
  const client = clientKey === 'write' ? state.writeClient : state.readClient;
  const current = client.targetNode;
  const idx = nodeKeys.indexOf(current);
  client.targetNode = nodeKeys[(idx + 1) % nodeKeys.length];
  const label = client.targetNode ? state.nodes[client.targetNode].label : 'auto';
  log(`${clientKey === 'write' ? 'Writer' : 'Reader'} target: ${label}`, 'info');
  draw(); syncButtons();
}

// ═══════════════════════════════════════
// CANVAS INTERACTION (node/link toggle + client drag)
// ═══════════════════════════════════════
let dragging = null; // { key: 'write'|'read', offsetX, offsetY }

function handleNodeClick(nodeKey) {
  const n = state.nodes[nodeKey];
  n.alive = !n.alive;
  const writeActive = isEngineActive(writeEngine);
  if (!n.alive) {
    const hadUnjournaledData = n.memoryVersion > n.journalVersion;
    crashNode(nodeKey);
    log(`${n.label} taken down \u2014 memory lost${hadUnjournaledData ? ' (unjournaled data lost!)' : ''}, journal preserved (v${n.journalVersion || 'none'}).`, 'warn');
  } else {
    const recoveredVersion = n.journalVersion;
    recoverNode(nodeKey);
    const synced = syncRejoiningNode(nodeKey);
    n.phase = 'recovering';
    draw();
    if (synced && n.memoryVersion > recoveredVersion) {
      log(`${n.label} recovering \u2014 caught up to v${n.memoryVersion} from primary.`, 'ok');
    } else if (recoveredVersion > 0) {
      log(`${n.label} recovering from journal \u2014 restored to v${recoveredVersion}.`, 'ok');
    } else {
      log(`${n.label} restarted with empty state.`, 'info');
    }
    setTimeout(() => { if (n.alive) { n.phase = 'idle'; draw(); syncButtons(); } }, PAUSE_RECOVERY_MS);
  }
  if (!writeActive) resetWriteVisual();
  resetReadVisual();
  if (!electionEngine.done) resetElectionVisual();
}

function handleLinkClick(linkKey) {
  if (!linkKey || state.links[linkKey] === undefined) return;
  state.links[linkKey] = !state.links[linkKey];
  const pairMap = { ps1: ['primary', 's1'], ps2: ['primary', 's2'], s1s2: ['s1', 's2'] };
  const pair = pairMap[linkKey];
  const label = pair ? `${state.nodes[pair[0]].label} \u2194 ${state.nodes[pair[1]].label}` : linkKey;
  log(`${label}: ${state.links[linkKey] ? 'connected' : 'partitioned'} \u2014 document state preserved.`, state.links[linkKey] ? 'ok' : 'warn');
  if (state.links[linkKey]) checkPartitionHealed();
  if (!isEngineActive(writeEngine)) resetWriteVisual();
  resetReadVisual();
  if (!electionEngine.done) resetElectionVisual();
}

function handleClientLinkClick(clientKey) {
  if (clientKey === 'wp') {
    state.links.wp = !state.links.wp;
    log(`Writer \u2192 Primary: ${state.links.wp ? 'connected' : 'disconnected'}.`, state.links.wp ? 'ok' : 'warn');
    if (!state.links.wp && !writeEngine.done && writeEngine.idx >= 0 && !writeEngine.aborted) {
      abortEngine(writeEngine);
      state.writeClient.phase = 'error';
      log('\u26A1 Writer connection interrupted \u2014 write timeout.', 'err');
    }
  } else if (clientKey === 'rp') {
    state.links.rp = !state.links.rp;
    log(`Reader connection: ${state.links.rp ? 'connected' : 'disconnected'}.`, state.links.rp ? 'ok' : 'warn');
    if (!state.links.rp && !readEngine.done && readEngine.idx >= 0 && !readEngine.aborted) {
      abortEngine(readEngine);
      state.readClient.phase = 'error';
      log('\u26A1 Reader connection interrupted \u2014 read timeout.', 'err');
    }
  }
}

function handleCanvasClick(hit) {
  if (!hit) return;
  if (isTopologyLocked() && (hit.type === 'node' || hit.type === 'link' || hit.type === 'clientLink')) return;

  if (hit.type === 'node')       handleNodeClick(hit.key);
  else if (hit.type === 'link')  handleLinkClick(hit.key);
  else if (hit.type === 'clientLink') handleClientLinkClick(hit.key);

  draw(); syncButtons();
}

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const hit = hitTest(mx, my);
  if (hit && hit.type === 'client') {
    const c = hit.key === 'write' ? state.writeClient : state.readClient;
    dragging = { key: hit.key, offsetX: mx - c.x, offsetY: my - c.y, moved: false };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
});

function handleCanvasDrag(mx, my) {
  const c = dragging.key === 'write' ? state.writeClient : state.readClient;
  c.x = Math.max(CLIENT_RADIUS, Math.min(canvasW - CLIENT_RADIUS, mx - dragging.offsetX));
  c.y = Math.max(CLIENT_RADIUS, Math.min(canvasH - CLIENT_RADIUS, my - dragging.offsetY));
  clientDragged[dragging.key] = true;
  dragging.moved = true;
  canvas.style.cursor = 'grabbing';
  draw();
}

function cursorForHit(hit) {
  if (hit && hit.type === 'client') return 'grab';
  if (isTopologyLocked() && hit && (hit.type === 'node' || hit.type === 'link' || hit.type === 'clientLink')) return 'not-allowed';
  if (hit && hit.type === 'lockBanner') return 'help';
  return hit ? 'pointer' : 'default';
}

function handleCanvasHover(mx, my) {
  const hit = hitTest(mx, my);
  canvas.style.cursor = cursorForHit(hit);
  const prev = getHoverTarget();
  if (prev?.type !== hit?.type || prev?.key !== hit?.key) {
    setHoverTarget(hit);
    canvas.title = canvasTipFor(hit);
    draw();
  }
}

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (dragging) handleCanvasDrag(mx, my);
  else handleCanvasHover(mx, my);
});

canvas.addEventListener('mouseup', e => {
  if (dragging) {
    const wasDrag = dragging.moved;
    const key = dragging.key;
    dragging = null;
    canvas.style.cursor = 'grab';
    if (!wasDrag && !isTopologyLocked()) {
      cycleClientTarget(key);
    }
    return;
  }
  // Regular click (non-drag) — handle node/link/clientLink actions
  const rect = canvas.getBoundingClientRect();
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
  handleCanvasClick(hit);
});

canvas.addEventListener('mouseleave', () => {
  if (dragging) { dragging = null; }
  if (getHoverTarget()) { setHoverTarget(null); draw(); }
});

// ═══════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════
['sel-w','sel-j'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { resetWriteVisual(); draw(); syncTooltips(); refreshIdlePanels(); });
});
['sel-rc','sel-readpref'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    if (id === 'sel-rc' && getSelectedReadConcern() !== 'snapshot') {
      state.readClient.sessionActive = false;
      state.readClient.sessionSnapshotId = null;
    }
    state.links.rp = true;
    resetReadVisual();
    updateReadActionControls();
    draw();
    syncButtons();
    syncTooltips();
    refreshIdlePanels();
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
document.getElementById('btn-canvas-reset-ui')?.addEventListener('click', () => {
  resetClientDrag();
  state.writeClient.targetNode = null;
  state.readClient.targetNode = null;
  computeLayout(canvasW, canvasH);
  draw();
});
document.getElementById('btn-clear-log').addEventListener('click', () => { document.getElementById('event-log').innerHTML = ''; });
document.getElementById('btn-dismiss-welcome').addEventListener('click', dismissWelcomePopup);
document.getElementById('btn-dismiss-mobile').addEventListener('click', dismissMobilePopup);
document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

// ═══════════════════════════════════════
// POPUPS
// ═══════════════════════════════════════
function dismissWelcomePopup() {
  document.getElementById('welcome-overlay').classList.remove('visible');
  try { localStorage.setItem('tcp-welcome-dismissed', '1'); } catch (_) {}
}

function dismissMobilePopup() {
  document.getElementById('mobile-overlay').classList.remove('visible');
}

function initPopups() {
  let welcomed = false;
  try { welcomed = localStorage.getItem('tcp-welcome-dismissed') === '1'; } catch (_) {}
  if (!welcomed) {
    document.getElementById('welcome-overlay').classList.add('visible');
  }

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    document.getElementById('mobile-overlay').classList.add('visible');
  }
}

// ═══════════════════════════════════════
// SCENARIO PANEL
// ═══════════════════════════════════════
function applyScenario(scenario) {
  resetScenario();
  const s = scenario.setup;
  setSelectedWriteConcern(s.w);
  setSelectedJournal(s.j);
  setSelectedReadConcern(s.rc);
  setSelectedReadPref(s.readPref);
  if (s.links) {
    Object.entries(s.links).forEach(([k, v]) => { state.links[k] = v; });
  }
  syncWBadge();
  syncTooltips();
  updateReadActionControls();
  draw();
  syncButtons();
  refreshIdlePanels();
  log(`\u2500\u2500\u2500 Scenario: ${scenario.name} \u2500\u2500\u2500`, 'info');
  log(scenario.next, 'info');
}

function initScenarios() {
  const container = document.getElementById('scenarios-list');
  if (!container) return;
  container.innerHTML = '';
  let grid;
  TEXTS.scenarios.forEach(entry => {
    if (entry.group) {
      const hdr = document.createElement('div');
      hdr.className = 'scenario-group-hdr';
      hdr.innerHTML =
        `<div class="scenario-group-title">${entry.group}</div>` +
        `<div class="scenario-group-sub">${entry.subtitle}</div>`;
      container.appendChild(hdr);
      grid = document.createElement('div');
      grid.className = 'scenario-grid';
      container.appendChild(grid);
      return;
    }
    const item = document.createElement('div');
    item.className = 'scenario-item';
    item.innerHTML =
      `<div class="scenario-name">${entry.name}</div>` +
      `<div class="scenario-what">${entry.what}</div>` +
      `<div class="scenario-next">${entry.next}</div>` +
      `<button class="sec scenario-btn">Set up</button>`;
    item.querySelector('.scenario-btn').addEventListener('click', () => applyScenario(entry));
    (grid || container).appendChild(item);
  });
}

// ═══════════════════════════════════════
// DEBUG LABEL OVERLAY
// ═══════════════════════════════════════
let debugLabelsActive = false;

function toggleDebugLabels() {
  debugLabelsActive = !debugLabelsActive;
  document.body.classList.toggle('debug-labels', debugLabelsActive);
  const btn = document.getElementById('btn-debug');
  if (btn) btn.textContent = debugLabelsActive ? 'Debug: ON' : 'Debug';
  if (debugLabelsActive) createDomBadges();
  else removeDomBadges();
  draw();
}

const DEBUG_ELEMENT_IDS = [
  'sel-w', 'sel-j', 'sel-rc', 'sel-readpref',
  'btn-write-start', 'btn-write-next', 'btn-write-finish',
  'btn-read-start', 'btn-read-next', 'btn-read-finish',
  'btn-read-session-start', 'btn-read-session-again', 'btn-read-session-end',
  'btn-reset', 'btn-theme-toggle', 'btn-clear-log',
  'btn-canvas-election', 'btn-canvas-reset-ui',
  'write-step-panel', 'read-step-panel',
  'write-status', 'read-status',
  'scenarios-details', 'event-log', 'canvas',
  'w-default-pill', 'step-panels-card',
  'write-step-title', 'write-step-explain', 'write-step-badge',
  'read-step-title', 'read-session-badge', 'read-step-explain', 'read-step-badge',
  'write-phase-trail',
  'topo-bar', 'topo-hint',
  'session-actions',
];

function placeDomDebugBadge(overlay, el, label) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const badge = document.createElement('span');
  badge.className = 'dbg-badge';
  badge.textContent = label;
  badge.style.left = (r.left + window.scrollX) + 'px';
  badge.style.top  = (r.top  + window.scrollY) + 'px';
  overlay.appendChild(badge);
}

function createDomBadges() {
  removeDomBadges();
  let overlay = document.getElementById('dbg-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dbg-overlay';
    document.body.appendChild(overlay);
  }
  DEBUG_ELEMENT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) placeDomDebugBadge(overlay, el, id);
  });
  document.querySelectorAll('.scenario-item').forEach((el, i) => placeDomDebugBadge(overlay, el, 'scenario[' + i + ']'));
  document.querySelectorAll('.scenario-btn').forEach((el, i) => placeDomDebugBadge(overlay, el, 'scenario-btn[' + i + ']'));
}

function removeDomBadges() {
  const overlay = document.getElementById('dbg-overlay');
  if (overlay) overlay.innerHTML = '';
}

document.getElementById('btn-debug')?.addEventListener('click', toggleDebugLabels);

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
resizeCanvas();
window.addEventListener('load', resizeCanvas);
updateReadActionControls();
syncButtons();
syncWBadge();
initButtonTips();
syncTooltips();
initPopups();
initScenarios();
refreshIdlePanels();
log('Ready - click nodes/links to set topology, click client arrows to interrupt connections.', 'info');
