// ═══════════════════════════════════════
// ENGINES
// ═══════════════════════════════════════
const writeEngine    = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false, _autoFinishId: null, _machine: null };
const readEngine     = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false, _autoFinishId: null, _machine: null };
const electionEngine = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false, _autoFinishId: null, _machine: null };

function abortEngine(eng) {
  eng.aborted = true;
  if (eng._waitResolve) { const r = eng._waitResolve; eng._waitResolve = null; r(); }
}

// Centralised engine field reset — clears all engine state and cancels any auto-finish timer.
// Resolves any pending waitForClick promise via the abort path before clearing state,
// so runMachine's async loop terminates cleanly instead of hanging forever.
function resetEngine(eng) {
  eng.aborted = true;
  if (eng._waitResolve) { const r = eng._waitResolve; eng._waitResolve = null; r(); }
  // Do NOT reset eng.aborted here — the running async loop must still see it as true
  // when it resumes from the resolved promise. runMachine() resets it to false on
  // the next fresh start.
  eng.done = false; eng.idx = -1;
  eng.busy = false; eng.steps = []; eng._machine = null;
  if (eng._autoFinishId) { clearInterval(eng._autoFinishId); eng._autoFinishId = null; }
}


function syncButtons() {
  const we = writeEngine, re = readEngine, ee = electionEngine;
  const writeActive    = we.busy || (we.idx !== -1 && !we.done && !we.aborted);
  const readActive     = re.busy || (re.idx !== -1 && !re.done && !re.aborted);
  const electionActive = ee.busy || (ee.idx !== -1 && !ee.done && !ee.aborted);

  // ── Write panel — repurposed for election steps when election is active ──
  const writePanelEl = document.getElementById('write-step-panel');
  if (writePanelEl) {
    const lbl = writePanelEl.querySelector('.step-label');
    if (electionActive) {
      writePanelEl.classList.add('election-mode');
      if (lbl) lbl.textContent = 'ELECTION';
    } else {
      writePanelEl.classList.remove('election-mode');
      if (lbl) lbl.textContent = 'WRITE';
    }
  }

  const isFirstWrite = state.doc.latestId === 0;
  const readBlockTip = 'Paused while a read is in progress.\n\nThis is a playground simplification - in real MongoDB, reads and writes run concurrently. Here we pause the write so the read observes a stable state, making it easier to follow what happens step by step.';
  const btnWS = document.getElementById('btn-write-start');
  btnWS.textContent = isFirstWrite ? 'New doc with ID 1' : 'Update doc with ID 1';
  btnWS.disabled    = writeActive || electionActive || readActive;
  btnWS.setAttribute('data-tip', readActive && !writeActive ? readBlockTip : TEXTS.buttons['btn-write-start']);

  const activeEng  = electionActive ? ee : we;
  const btnWN = document.getElementById('btn-write-next');
  const wnDis = readActive || activeEng.busy || activeEng._waitResolve === null;
  btnWN.disabled = wnDis;
  btnWN.setAttribute('data-tip', readActive && writeActive ? readBlockTip : TEXTS.buttons['btn-write-next']);
  const btnWF = document.getElementById('btn-write-finish');
  const wfDis = readActive || activeEng.idx === -1 || activeEng._waitResolve === null;
  btnWF.disabled = wfDis;
  btnWF.setAttribute('data-tip', readActive && writeActive ? readBlockTip : TEXTS.buttons['btn-write-finish']);

  // ── Read panel ──
  const btnRS = document.getElementById('btn-read-start');
  btnRS.textContent = 'Query doc with ID 1';
  btnRS.disabled    = readActive;
  updateReadActionControls();

  const btnSnapStart = document.getElementById('btn-read-session-start');
  const btnSnapAgain = document.getElementById('btn-read-session-again');
  const btnSnapEnd   = document.getElementById('btn-read-session-end');
  if (btnSnapStart && btnSnapAgain && btnSnapEnd) {
    const sessionActive = !!state.readClient.sessionActive;
    btnSnapStart.disabled = readActive || sessionActive;
    btnSnapAgain.disabled = readActive || !sessionActive;
    btnSnapEnd.disabled   = readActive || !sessionActive;
  }

  const rnDis = re.busy || re._waitResolve === null;
  document.getElementById('btn-read-next').disabled   = rnDis;
  document.getElementById('btn-read-finish').disabled  = re.idx === -1 || re._waitResolve === null;

  // ── Lock dropdowns ──
  const selW = document.getElementById('sel-w');
  const selJ = document.getElementById('sel-j');
  if (selW) selW.disabled = writeActive;
  if (selJ) selJ.disabled = writeActive;

  const selRC = document.getElementById('sel-rc');
  const selRP = document.getElementById('sel-readpref');
  if (selRC) selRC.disabled = readActive;
  if (selRP) selRP.disabled = readActive;

  // ── Canvas election button — contextual overlay near dead primary ──
  const canvasBtnEl = document.getElementById('btn-canvas-election');
  if (canvasBtnEl) {
    const pk = state.primaryKey;
    const pNode = state.nodes[pk];
    const primaryDown   = !state.nodes[pk].alive;
    const aliveCount    = Object.values(state.nodes).filter(n => n.alive).length;
    const majorityNeeded = Math.floor(Object.keys(state.nodes).length / 2) + 1;
    const canElect      = aliveCount >= majorityNeeded;
    const hasCandidates = Object.keys(state.nodes).some(k => k !== pk && state.nodes[k].alive);
    const show = primaryDown && hasCandidates && canElect && !electionActive && !writeActive;
    canvasBtnEl.style.display = show ? 'block' : 'none';
    if (show) {
      canvasBtnEl.style.left = (14 + pNode.x) + 'px';
      canvasBtnEl.style.top  = (14 + pNode.y + 52 + 18) + 'px'; // NR=52, 18px gap
    }
  }

  // ── Force election button — shown when primary is partitioned but alive ──
  const forceBtnEl = document.getElementById('btn-canvas-force-election');
  if (forceBtnEl) {
    const partitioned = isPrimaryPartitioned();
    const showForce = partitioned && !electionActive && !writeActive;
    forceBtnEl.style.display = showForce ? 'block' : 'none';
    if (showForce) {
      const s1 = state.nodes.s1, s2 = state.nodes.s2;
      forceBtnEl.style.left = ((s1.x + s2.x) / 2) + 'px';
      forceBtnEl.style.top  = ((s1.y + s2.y) / 2 + 20) + 'px';
      forceBtnEl.style.transform = 'translateX(-50%)';
    }
  }
}

// ── Write panel Next/Finish smart wrappers ──
function handleWritePanelNext() {
  const ee = electionEngine;
  if (ee.idx !== -1 && !ee.done && !ee.aborted) advanceElectionStep();
  else advanceWriteStep();
}
function handleWritePanelFinish() {
  const ee = electionEngine;
  if (ee.idx !== -1 && !ee.done && !ee.aborted) autoFinishElection();
  else autoFinishWrite();
}

function advanceWriteStep() {
  if (writeEngine._waitResolve) { const r = writeEngine._waitResolve; writeEngine._waitResolve = null; r(); }
}
function advanceReadStep() {
  if (readEngine._waitResolve) { const r = readEngine._waitResolve; readEngine._waitResolve = null; r(); }
}
function advanceElectionStep() {
  if (electionEngine._waitResolve) { const r = electionEngine._waitResolve; electionEngine._waitResolve = null; r(); }
}

// Shared auto-finish implementation — skips animations and drives engine to completion instantly.
function _autoFinish(eng, advanceFn) {
  if (eng.done || eng.idx === -1 || eng._autoFinishId) return;
  setSkipAnimations(true);
  eng._autoFinishId = setInterval(() => {
    if (eng.done || eng.idx === -1) {
      clearInterval(eng._autoFinishId); eng._autoFinishId = null;
      setSkipAnimations(false);
      draw();
      return;
    }
    if (eng._waitResolve && !eng.busy) advanceFn();
  }, 10);
}

function autoFinishWrite()    { _autoFinish(writeEngine,    advanceWriteStep); }
function autoFinishRead()     { _autoFinish(readEngine,     advanceReadStep); }
function autoFinishElection() { _autoFinish(electionEngine, advanceElectionStep); }

async function waitForClick(eng) {
  if (eng.mode === 'auto') return;
  return new Promise(r => { eng._waitResolve = r; syncButtons(); });
}

function getIdleSummary(panelId) {
  if (panelId === 'write-step-panel') {
    const w = document.getElementById('sel-w')?.value || 'majority';
    const j = document.getElementById('sel-j')?.value || 'false';
    return TEXTS.configSummary.write(w, j, state.doc.latestId);
  }
  if (panelId === 'read-step-panel') {
    const rc = document.getElementById('sel-rc')?.value || 'local';
    const rp = document.getElementById('sel-readpref')?.value || 'primary';
    return TEXTS.configSummary.read(rc, rp, state.doc.latestId);
  }
  return { title: '', explain: '' };
}

function showIdlePanel(panelId, ids) {
  const s = getIdleSummary(panelId);
  document.getElementById(ids.badge).textContent = '';
  document.getElementById(ids.title).textContent = s.title;
  const explainEl = document.getElementById(ids.explain);
  const prevDetails = explainEl.querySelector('.step-details');
  const wasOpen = prevDetails ? prevDetails.open : true;
  explainEl.innerHTML =
    `<details class="step-details"${wasOpen ? ' open' : ''}>` +
    `<summary class="step-details-toggle">Details</summary>` +
    `<div class="step-explain-body">${s.explain}</div>` +
    `</details>`;
  document.getElementById(ids.dots).innerHTML = '';
}

function refreshIdlePanels() {
  for (const [panelId, ids] of Object.entries(PANEL_EL_IDS)) {
    const eng = panelId === 'write-step-panel' ? writeEngine : readEngine;
    if (eng.idx === -1 || (eng.done && eng.steps.length === 0)) {
      showIdlePanel(panelId, ids);
    }
  }
}

// Explicit DOM ID map — avoids fragile string-manipulation to derive IDs from panel names.
const PANEL_EL_IDS = {
  'write-step-panel': { badge: 'write-step-badge', title: 'write-step-title', explain: 'write-step-explain', dots: 'write-progress-dots' },
  'read-step-panel':  { badge: 'read-step-badge',  title: 'read-step-title',  explain: 'read-step-explain',  dots: 'read-progress-dots'  },
};

function showStepPanel(i, eng, panelId) {
  const ids = PANEL_EL_IDS[panelId];
  if (!ids) return;
  const isWritePanel = panelId === 'write-step-panel';
  if (i < 0 || eng.steps.length === 0) {
    showIdlePanel(panelId, ids);
    if (isWritePanel) renderPhaseTrail(eng);
    return;
  }
  const s = eng.steps[i];
  const hasPhaseTrail = isWritePanel && eng._machine && typeof eng._machine.getProgress === 'function';
  if (hasPhaseTrail) {
    document.getElementById(ids.badge).textContent = '';
    renderPhaseTrail(eng);
  } else {
    const totalLabel = `${eng.steps.length}`;
    document.getElementById(ids.badge).textContent = `Step ${i+1} of ${totalLabel}`;
    if (isWritePanel) renderPhaseTrail(eng);
  }
  document.getElementById(ids.title).textContent  = s.title;
  const explainEl = document.getElementById(ids.explain);
  const prevDetails = explainEl.querySelector('.step-details');
  const wasOpen = prevDetails ? prevDetails.open : false;
  explainEl.innerHTML =
    `<details class="step-details"${wasOpen ? ' open' : ''}>` +
    `<summary class="step-details-toggle">Details</summary>` +
    `<div class="step-explain-body">${s.explain}</div>` +
    `</details>`;
  const dotsEl = document.getElementById(ids.dots);
  if (hasPhaseTrail) {
    dotsEl.innerHTML = '';
  } else {
    dotsEl.innerHTML = '';
    eng.steps.forEach((_, j) => {
      const d = document.createElement('div');
      d.className = 'step-dot' + (j < i ? ' done' : j === i ? ' current' : '');
      dotsEl.appendChild(d);
    });
  }
}

// ── Phase trail rendering (write panel only) ──
// Phases: { label, state: 'done'|'active'|'pending'|'error' }
const PHASE_ICONS = { done: '✓', active: '●', pending: '○', error: '✗' };

function renderPhaseTrail(eng) {
  const el = document.getElementById('write-phase-trail');
  if (!el) return;

  const phases = buildPhases(eng);
  if (!phases) { el.innerHTML = ''; return; }

  el.innerHTML = '';
  phases.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'phase-sep';
      sep.textContent = '·';
      el.appendChild(sep);
    }
    const pill = document.createElement('span');
    pill.className = `phase-pill ${p.state}`;
    pill.innerHTML = `<span class="phase-icon">${PHASE_ICONS[p.state]}</span> ${p.label}`;
    el.appendChild(pill);
  });
}

function buildPhases(eng) {
  if (eng.idx < 0 || eng.steps.length === 0) return null;

  const m = eng._machine;
  if (!m || typeof m.getProgress !== 'function') return null;

  const p = m.getProgress();
  const done = eng.done;
  const errored = p.errored;

  // w:0 fire-and-forget: Send → Primary → Fire & forget
  if (p.w === 0) {
    const fireForgetDone = p.phase === 'done';
    return [
      { label: 'Send',    state: sendState(p, done) },
      { label: 'Primary', state: primaryState(p, done, errored) },
      { label: 'Fire & forget', state: fireForgetDone ? (errored ? 'error' : 'done') : (p.phase === 'fireForget' ? 'active' : 'pending') },
    ];
  }

  // w:1 (no required secondaries): Send → Primary → ACK → Repl X/Y
  // w:2/3/majority (required secondaries): Send → Primary → Repl X/Y → ACK
  const hasRequiredRepl = p.secsNeeded > 0;
  const replDone = p.replicated;
  const replTotal = p.totalSecs;
  const replLabel = `Repl ${replDone}/${replTotal}`;
  const replInProgress = p.phase === 'repl' && (p.replicated > 0 || p.memApplied > 0);

  function replState() {
    if (errored && !p.acked) return 'error';
    if (done) return 'done';
    if (p.phase === 'repl') return replDone >= replTotal ? 'done' : 'active';
    return 'pending';
  }

  function ackState() {
    if (errored) return 'error';
    if (p.acked || done) return 'done';
    if (p.phase === 'repl' && hasRequiredRepl) {
      // ACK is pending until repl satisfies write concern
      return 'pending';
    }
    if (p.phase === 'repl' && !hasRequiredRepl) {
      // w:1: primary done → ACK fires before repl
      return 'pending';
    }
    return 'pending';
  }

  if (!hasRequiredRepl) {
    // w:1: Send → Primary → ACK → Repl X/Y
    return [
      { label: 'Send',    state: sendState(p, done) },
      { label: 'Primary', state: primaryState(p, done, errored) },
      { label: 'ACK',     state: p.acked ? 'done' : (errored ? 'error' : (p.phase === 'repl' ? 'active' : 'pending')) },
      { label: replLabel, state: replState() },
    ];
  }

  // w:2/3/majority: Send → Primary → Repl X/Y → ACK
  return [
    { label: 'Send',    state: sendState(p, done) },
    { label: 'Primary', state: primaryState(p, done, errored) },
    { label: replLabel, state: replState() },
    { label: 'ACK',     state: ackState() },
  ];
}

function sendState(p, done) {
  if (done || p.phase !== 'send') return 'done';
  return 'active';
}

function primaryState(p, done, errored) {
  if (errored && (p.phase === 'done') && !(['repl', 'fireForget'].includes(p.phase))) {
    // Error during primary phase
    if (p.phase === 'done' && p.replicated === 0 && !p.acked) return 'error';
  }
  if (done || ['repl', 'fireForget'].includes(p.phase) || (p.phase === 'done' && (p.acked || p.replicated > 0))) return 'done';
  if (p.phase === 'primaryMem' || p.phase === 'primaryJournal') return 'active';
  if (p.phase === 'done' && errored) return 'error';
  return 'pending';
}

// Wraps a pre-built step array as a machine (lazy generator interface).
function arrayMachine(steps) {
  let i = 0;
  return {
    history: [],
    get isDone() { return i >= steps.length; },
    nextStep() {
      if (i >= steps.length) return null;
      const s = steps[i++];
      this.history.push(s);
      return s;
    },
  };
}

// Unified engine loop — drives any machine (lazy generator or wrapped array).
// The machine produces steps one at a time via nextStep(). Each step is shown
// in the panel, waits for user click, then executes. The engine's `steps` array
// is the machine's growing history, so showStepPanel/syncButtons work unchanged.
async function runMachine(machine, eng, panelId) {
  eng._machine = machine;
  eng.steps = machine.history;
  eng.idx = -1; eng.done = false; eng.busy = false; eng.aborted = false;

  let step;
  while ((step = machine.nextStep()) && !eng.aborted) {
    eng.steps = machine.history;
    eng.idx = machine.history.length - 1;
    showStepPanel(eng.idx, eng, panelId);
    syncButtons();

    if (eng.idx > 0) await waitForClick(eng);
    if (eng.aborted) break;

    eng.busy = true; syncButtons();
    logStep(step.title, step.explain || '');
    await step.run();
    eng.busy = false;
    if (eng.aborted) break;
  }

  if (!eng.aborted) {
    eng.done = true;
    if (machine.history.length > 0)
      showStepPanel(machine.history.length - 1, eng, panelId);
  }
  syncButtons();
}
