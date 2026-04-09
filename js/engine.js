// ═══════════════════════════════════════
// ENGINES
// ═══════════════════════════════════════
const writeEngine    = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false, _autoFinishId: null, _machine: null };
const readEngine     = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false, _autoFinishId: null, _machine: null };
const electionEngine = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false, _autoFinishId: null, _machine: null };

function isEngineActive(eng) {
  return (eng.idx !== -1 && !eng.done && !eng.aborted) || eng.busy;
}

function isEngineEmpty(eng) {
  return eng.idx < 0 || eng.steps.length === 0;
}

function isAnyEngineActive() {
  return [writeEngine, readEngine, electionEngine].some(isEngineActive);
}

// Snapshot sessions persist between read step-runs; topology must stay stable until the session ends
// (writes are still allowed — the pinned snapshot ID fixes repeatable read semantics).
function isTopologyLocked() {
  return isAnyEngineActive() || !!state.readClient.sessionActive;
}

function abortEngine(eng) {
  eng.aborted = true;
  if (eng._waitResolve) { const resolve = eng._waitResolve; eng._waitResolve = null; resolve(); }
}

// Centralised engine field reset — clears all engine state and cancels any auto-finish timer.
// Resolves any pending waitForClick promise via the abort path before clearing state,
// so runMachine's async loop terminates cleanly instead of hanging forever.
function resetEngine(eng) {
  eng.aborted = true;
  if (eng._waitResolve) { const resolve = eng._waitResolve; eng._waitResolve = null; resolve(); }
  // Do NOT reset eng.aborted here — the running async loop must still see it as true
  // when it resumes from the resolved promise. runMachine() resets it to false on
  // the next fresh start.
  eng.done = false; eng.idx = -1;
  eng.busy = false; eng.steps = []; eng._machine = null;
  if (eng._autoFinishId) { clearInterval(eng._autoFinishId); eng._autoFinishId = null; }
}


function syncReadSessionBadge() {
  const el = document.getElementById('read-session-badge');
  if (!el) return;
  const on = !!state.readClient.sessionActive;
  el.textContent = on ? TEXTS.readSessionActiveBadge : '';
  el.hidden = !on;
}

function syncWritePanelButtons(writeActive, readActive, electionActive) {
  const we = writeEngine, ee = electionEngine;
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
  btnWN.disabled = readActive || activeEng.busy || activeEng._waitResolve === null;
  btnWN.setAttribute('data-tip', readActive && writeActive ? readBlockTip : TEXTS.buttons['btn-write-next']);
  const btnWF = document.getElementById('btn-write-finish');
  btnWF.disabled = readActive || activeEng.idx === -1 || activeEng._waitResolve === null;
  btnWF.setAttribute('data-tip', readActive && writeActive ? readBlockTip : TEXTS.buttons['btn-write-finish']);
}

function syncReadPanelButtons(readActive) {
  const re = readEngine;
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

  document.getElementById('btn-read-next').disabled   = re.busy || re._waitResolve === null;
  document.getElementById('btn-read-finish').disabled  = re.idx === -1 || re._waitResolve === null;
}

function syncDropdownLocks(writeActive, readActive) {
  const selW = document.getElementById('sel-w');
  const selJ = document.getElementById('sel-j');
  if (selW) selW.disabled = writeActive;
  if (selJ) selJ.disabled = writeActive;

  const selRC = document.getElementById('sel-rc');
  const selRP = document.getElementById('sel-readpref');
  const sessionTopoLock = !!state.readClient.sessionActive;
  if (selRC) selRC.disabled = readActive || sessionTopoLock;
  if (selRP) selRP.disabled = readActive || sessionTopoLock;
}

function isElectionEligible(writeActive) {
  const pk = state.primaryKey;
  const primaryDown    = !state.nodes[pk].alive;
  const partitioned    = isPrimaryPartitioned();
  const aliveCount     = Object.values(state.nodes).filter(n => n.alive).length;
  const canElect       = aliveCount >= majorityThreshold();
  const hasCandidates  = Object.keys(state.nodes).some(k => k !== pk && state.nodes[k].alive);
  const showForDead      = primaryDown && hasCandidates && canElect;
  const showForPartition = partitioned;
  const sessionTopoLock  = !!state.readClient.sessionActive;
  return (showForDead || showForPartition) && !writeActive && !sessionTopoLock;
}

function positionElectionButton(el) {
  const allNodes = Object.values(state.nodes);
  const cx = allNodes.reduce((s, n) => s + n.x, 0) / allNodes.length;
  const cy = allNodes.reduce((s, n) => s + n.y, 0) / allNodes.length;
  el.style.left = cx + 'px';
  el.style.top  = (cy + 10) + 'px';
  el.style.transform = 'translateX(-50%)';
}

function syncElectionButton(writeActive, electionActive) {
  const canvasBtnEl = document.getElementById('btn-canvas-election');
  if (!canvasBtnEl) return;
  const show = isElectionEligible(writeActive);
  canvasBtnEl.style.display = show ? 'block' : 'none';
  if (!show) return;

  positionElectionButton(canvasBtnEl);
  if (electionActive) {
    canvasBtnEl.disabled = true;
    canvasBtnEl.classList.add('canvas-election-info');
    canvasBtnEl.innerHTML = '\u26A1 Election in progress<br>use Write panel controls to step through';
  } else {
    canvasBtnEl.disabled = false;
    canvasBtnEl.classList.remove('canvas-election-info');
    canvasBtnEl.innerHTML = '\u26A1 Trigger Election<span class="raft-hint">\u24D8 Raft consensus - hover for details</span>';
  }
}

function syncButtons() {
  const writeActive    = isEngineActive(writeEngine);
  const readActive     = isEngineActive(readEngine);
  const electionActive = isEngineActive(electionEngine);

  syncWritePanelButtons(writeActive, readActive, electionActive);
  syncReadPanelButtons(readActive);
  syncDropdownLocks(writeActive, readActive);
  syncElectionButton(writeActive, electionActive);
  syncReadSessionBadge();
}

// ── Write panel Next/Finish smart wrappers ──
function handleWritePanelNext() {
  const ee = electionEngine;
  if (isEngineActive(ee)) advanceElectionStep();
  else advanceWriteStep();
}
function handleWritePanelFinish() {
  const ee = electionEngine;
  if (isEngineActive(ee)) autoFinishElection();
  else autoFinishWrite();
}

function advanceWriteStep() {
  if (writeEngine._waitResolve) { const resolve = writeEngine._waitResolve; writeEngine._waitResolve = null; resolve(); }
}
function advanceReadStep() {
  if (readEngine._waitResolve) { const resolve = readEngine._waitResolve; readEngine._waitResolve = null; resolve(); }
}
function advanceElectionStep() {
  if (electionEngine._waitResolve) { const resolve = electionEngine._waitResolve; electionEngine._waitResolve = null; resolve(); }
}

// Shared auto-finish implementation — skips animations and drives engine to completion instantly.
function _autoFinish(eng, advanceFn) {
  const notRunning = eng.done || eng.idx === -1;
  const alreadyAutoFinishing = !!eng._autoFinishId;
  if (notRunning || alreadyAutoFinishing) return;
  setSkipAnimations(true);
  eng._autoFinishId = setInterval(() => {
    const finished = eng.done || eng.idx === -1;
    if (finished) {
      clearInterval(eng._autoFinishId); eng._autoFinishId = null;
      setSkipAnimations(false);
      draw();
      return;
    }
    if (eng._waitResolve && !eng.busy) advanceFn();
  }, AUTO_FINISH_TICK);
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
    const wVal = getSelectedWriteConcern() || 'majority';
    const jVal = getSelectedJournal() || 'false';
    return TEXTS.configSummary.write(wVal, jVal, state.doc.latestId);
  }
  if (panelId === 'read-step-panel') {
    const rc = getSelectedReadConcern() || 'local';
    const rp = getSelectedReadPref() || 'primary';
    return TEXTS.configSummary.read(rc, rp, state.doc.latestId);
  }
  return { title: '', explain: '' };
}

function showIdlePanel(panelId, ids) {
  const summary = getIdleSummary(panelId);
  document.getElementById(ids.badge).textContent = '';
  document.getElementById(ids.title).textContent = summary.title;
  const explainEl = document.getElementById(ids.explain);
  const prevDetails = explainEl.querySelector('.step-details');
  const wasOpen = prevDetails ? prevDetails.open : true;
  explainEl.innerHTML =
    `<details class="step-details"${wasOpen ? ' open' : ''}>` +
    `<summary class="step-details-toggle">Details</summary>` +
    `<div class="step-explain-body">${summary.explain}</div>` +
    `</details>`;
  document.getElementById(ids.dots).innerHTML = '';
}

function refreshIdlePanels() {
  for (const [panelId, ids] of Object.entries(PANEL_EL_IDS)) {
    const eng = panelId === 'write-step-panel' ? writeEngine : readEngine;
    if (isEngineEmpty(eng)) {
      showIdlePanel(panelId, ids);
    }
  }
  syncReadSessionBadge();
}

// Explicit DOM ID map — avoids fragile string-manipulation to derive IDs from panel names.
const PANEL_EL_IDS = {
  'write-step-panel': { badge: 'write-step-badge', title: 'write-step-title', explain: 'write-step-explain', dots: 'write-progress-dots' },
  'read-step-panel':  { badge: 'read-step-badge',  title: 'read-step-title',  explain: 'read-step-explain',  dots: 'read-progress-dots'  },
};

function renderStepExplain(explainEl, html, defaultOpen) {
  const prevDetails = explainEl.querySelector('.step-details');
  const wasOpen = prevDetails ? prevDetails.open : defaultOpen;
  explainEl.innerHTML =
    `<details class="step-details"${wasOpen ? ' open' : ''}>` +
    `<summary class="step-details-toggle">Details</summary>` +
    `<div class="step-explain-body">${html}</div>` +
    `</details>`;
}

function renderStepDots(dotsEl, steps, currentIdx) {
  dotsEl.innerHTML = '';
  steps.forEach((_, j) => {
    const dot = document.createElement('div');
    dot.className = 'step-dot' + (j < currentIdx ? ' done' : j === currentIdx ? ' current' : '');
    dotsEl.appendChild(dot);
  });
}

function showStepPanel(i, eng, panelId) {
  const ids = PANEL_EL_IDS[panelId];
  if (!ids) return;
  const isWritePanel = panelId === 'write-step-panel';
  const noStepsToShow = i < 0 || eng.steps.length === 0;
  if (noStepsToShow) {
    showIdlePanel(panelId, ids);
    if (isWritePanel) renderPhaseTrail(eng);
    return;
  }
  const step = eng.steps[i];
  const hasPhaseTrail = isWritePanel && eng._machine && typeof eng._machine.getProgress === 'function';
  if (hasPhaseTrail) {
    document.getElementById(ids.badge).textContent = '';
    renderPhaseTrail(eng);
  } else {
    document.getElementById(ids.badge).textContent = `Step ${i+1} of ${eng.steps.length}`;
    if (isWritePanel) renderPhaseTrail(eng);
  }
  document.getElementById(ids.title).textContent = step.title;
  renderStepExplain(document.getElementById(ids.explain), step.explain, false);
  if (hasPhaseTrail) document.getElementById(ids.dots).innerHTML = '';
  else renderStepDots(document.getElementById(ids.dots), eng.steps, i);
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

function phaseReplState(p, done, errored) {
  if (errored && !p.acked) return 'error';
  if (done) return 'done';
  if (p.phase === 'repl') return p.replicated >= p.totalSecs ? 'done' : 'active';
  return 'pending';
}

function phaseAckState(p, done, errored) {
  if (errored) return 'error';
  if (p.acked || done) return 'done';
  return 'pending';
}

function buildFireForgetPhases(p, done, errored) {
  const ffDone = p.phase === 'done';
  return [
    { label: 'Send',    state: sendState(p, done) },
    { label: 'Primary', state: primaryState(p, done, errored) },
    { label: 'Fire & forget', state: ffDone ? (errored ? 'error' : 'done') : (p.phase === 'fireForget' ? 'active' : 'pending') },
  ];
}

function buildW1Phases(p, done, errored) {
  const replLabel = `Repl ${p.replicated}/${p.totalSecs}`;
  return [
    { label: 'Send',    state: sendState(p, done) },
    { label: 'Primary', state: primaryState(p, done, errored) },
    { label: 'ACK',     state: p.acked ? 'done' : (errored ? 'error' : (p.phase === 'repl' ? 'active' : 'pending')) },
    { label: replLabel, state: phaseReplState(p, done, errored) },
  ];
}

function buildMajorityPhases(p, done, errored) {
  const replLabel = `Repl ${p.replicated}/${p.totalSecs}`;
  return [
    { label: 'Send',    state: sendState(p, done) },
    { label: 'Primary', state: primaryState(p, done, errored) },
    { label: replLabel, state: phaseReplState(p, done, errored) },
    { label: 'ACK',     state: phaseAckState(p, done, errored) },
  ];
}

function buildPhases(eng) {
  if (isEngineEmpty(eng)) return null;
  const machine = eng._machine;
  if (!machine || typeof machine.getProgress !== 'function') return null;
  const progress = machine.getProgress();
  const done = eng.done;
  const errored = progress.errored;

  if (progress.w === 0) return buildFireForgetPhases(progress, done, errored);
  if (progress.secsNeeded <= 0) return buildW1Phases(progress, done, errored);
  return buildMajorityPhases(progress, done, errored);
}

function sendState(p, done) {
  if (done || p.phase !== 'send') return 'done';
  return 'active';
}

function primaryState(p, done, errored) {
  const passedPrimary = ['repl', 'fireForget'].includes(p.phase);
  const completedWithProgress = p.phase === 'done' && (p.acked || p.replicated > 0);
  const failedDuringPrimary = errored && p.phase === 'done' && p.replicated === 0 && !p.acked;
  const inPrimaryPhase = p.phase === 'primaryMem' || p.phase === 'primaryJournal';

  if (failedDuringPrimary) return 'error';
  if (done || passedPrimary || completedWithProgress) return 'done';
  if (inPrimaryPhase) return 'active';
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
      const step = steps[i++];
      this.history.push(step);
      return step;
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
