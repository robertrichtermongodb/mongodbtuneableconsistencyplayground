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
  if (writeEngine.busy || (writeEngine.idx !== -1 && !writeEngine.done)) return;
  resetWriteVisual();
  const failure = document.getElementById('sel-failure').value;
  applyFailure(failure);
  draw();
  const w  = resolveW(document.getElementById('sel-w').value);
  const j  = document.getElementById('sel-j').value === 'true';
  const wt = parseInt(document.getElementById('inp-wtimeout').value) || 0;
  log(`─── Write: w:${w}, j:${j}, wtimeout:${wt}, failure:${failure} ───`, 'info');
  runEngine(buildWriteSteps(w, j, wt), writeEngine, 'write-step-panel');
}

function handleRead() {
  if (readEngine.busy || (readEngine.idx !== -1 && !readEngine.done)) return;
  resetReadVisual();
  draw();
  const rc       = document.getElementById('sel-rc').value;
  const readPref = document.getElementById('sel-readpref').value;
  const failure  = document.getElementById('sel-failure').value;
  log(`─── Read: rc:${rc}, readPref:${readPref}, failure:${failure} ───`, 'info');
  runEngine(buildReadSteps(rc, readPref), readEngine, 'read-step-panel');
}

function resetWriteVisual() {
  state.particles = [];
  Object.values(state.nodes).forEach(n => { n.phase = 'idle'; });
  state.writeClient.phase = 'idle';
  document.getElementById('write-step-panel').classList.add('hidden');
  writeEngine.done = false; writeEngine.idx = -1;
  writeEngine._waitResolve = null; writeEngine.busy = false; writeEngine.steps = [];
  if (_autoFinishId) { clearInterval(_autoFinishId); _autoFinishId = null; }
}

function resetReadVisual() {
  state.particles = [];
  state.readClient.phase = 'idle';
  document.getElementById('read-step-panel').classList.add('hidden');
  readEngine.done = false; readEngine.idx = -1;
  readEngine._waitResolve = null; readEngine.busy = false; readEngine.steps = [];
}

function resetScenario() {
  resetWriteVisual();
  resetReadVisual();
  resetDoc();
  const failure = document.getElementById('sel-failure').value;
  applyFailure(failure);
  draw();
  syncButtons();
  log('Scenario reset — document state cleared (v0).', 'info');
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

  if (rc.lastReceivedVersion === null && rc.phase === 'idle') {
    rBox.innerHTML = '<div class="cb-dim">No reads completed</div>';
  } else if (rc.phase === 'waiting') {
    rBox.innerHTML =
      `<div class="cb-label">Reading\u2026</div>` +
      `<div class="cb-status" style="color:#7EC8E3">rc:${rcVal}</div>` +
      `<div class="cb-detail">Request in progress.</div>`;
  } else if (rc.phase === 'error') {
    rBox.innerHTML =
      `<div class="cb-label">Read failed</div>` +
      `<div class="cb-status cb-error">\u26A0 No eligible node</div>` +
      `<div class="cb-detail">The target node is unavailable. Read cannot be served.</div>`;
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
        `<div class="cb-detail">rc:${rcVal} \u2014 ${reason}</div>`;
    } else if (v.dirty) {
      rBox.innerHTML =
        `<div class="cb-label">Read result: ${vStr}</div>` +
        `<div class="cb-status cb-warn">\u25CE Dirty read \u2014 uncommitted</div>` +
        `<div class="cb-detail">rc:${rcVal} returned data above majority-commit (v${doc.majorityCommitId || 'none'}). If primary fails, this write may roll back.</div>`;
    } else {
      rBox.innerHTML =
        `<div class="cb-label">Read result: ${vStr}</div>` +
        `<div class="cb-status cb-ok">\u25C9 Safe \u2014 majority-confirmed</div>` +
        `<div class="cb-detail">rc:${rcVal} guarantees this data will not be rolled back.</div>`;
    }
  }
}

// ═══════════════════════════════════════
// FAILURE DROPDOWN SYNC
// ═══════════════════════════════════════
function syncFailureDropdown() {
  const p = state.nodes.primary.alive, s1 = state.nodes.s1.alive, s2 = state.nodes.s2.alive;
  let val = 'custom';
  if (p && s1 && s2)     val = 'none';
  else if (p && !s1 && s2)  val = 's1down';
  else if (p && s1 && !s2)  val = 's2down';
  else if (p && !s1 && !s2) val = 'bothdown';
  else if (!p && s1 && s2)  val = 'pdown';

  const sel = document.getElementById('sel-failure');
  let customOpt = sel.querySelector('option[value="custom"]');
  if (val === 'custom' && !customOpt) {
    customOpt = document.createElement('option');
    customOpt.value = 'custom'; customOpt.textContent = 'Custom';
    sel.appendChild(customOpt);
  } else if (val !== 'custom' && customOpt) {
    customOpt.remove();
  }
  sel.value = val;
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
  } else if (hit.type === 'link') {
    state.nodes[hit.key].alive = !state.nodes[hit.key].alive;
  }
  syncFailureDropdown();
  resetWriteVisual(); resetReadVisual(); resetDoc();
  draw(); syncButtons();
  const n = state.nodes[hit.key];
  log(`${n.label} ${n.alive ? 'brought online' : 'taken down'}.`, n.alive ? 'ok' : 'warn');
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
document.getElementById('sel-failure').addEventListener('change', e => {
  applyFailure(e.target.value); resetWriteVisual(); resetReadVisual(); resetDoc(); draw();
});
['sel-w','sel-j','inp-wtimeout'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { resetWriteVisual(); draw(); });
});
['sel-rc','sel-readpref'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { resetReadVisual(); draw(); });
});
window.addEventListener('resize', resizeCanvas);

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
setReadMode('auto');
resizeCanvas();
syncButtons();
log('Ready — step through a Write, then Probe Read at any pause point.', 'info');
