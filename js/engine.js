// ═══════════════════════════════════════
// ENGINES
// ═══════════════════════════════════════
const writeEngine    = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false };
const readEngine     = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false };
const electionEngine = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false };

function abortEngine(eng) {
  eng.aborted = true;
  if (eng._waitResolve) { const r = eng._waitResolve; eng._waitResolve = null; r(); }
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

  // Write start button
  const isFirstWrite = typeof state !== 'undefined' && state.doc.latestId === 0;
  const btnWS = document.getElementById('btn-write-start');
  btnWS.textContent = we.aborted ? 'Retry' : isFirstWrite ? 'New doc with ID 1' : 'Update doc with ID 1';
  btnWS.disabled    = writeActive || electionActive;
  btnWS.title = electionActive ? 'Election in progress — wait for it to complete'
              : writeActive    ? 'Write already in progress — finish or reset first'
              : '';

  // Write/election Next + Finish — controlled by whichever engine is active
  const activeEng  = electionActive ? ee : we;
  const wnDis = activeEng.busy || activeEng._waitResolve === null;
  document.getElementById('btn-write-next').disabled   = wnDis;
  document.getElementById('btn-write-finish').disabled = activeEng._waitResolve === null;

  // ── Read panel ──
  const btnRS = document.getElementById('btn-read-start');
  btnRS.textContent = re.aborted ? 'Retry' : 'Query doc with ID 1';
  btnRS.disabled    = readActive;
  btnRS.title = readActive ? 'Read already in progress — finish or reset first' : '';
  if (typeof updateReadActionControls === 'function') updateReadActionControls();

  const btnSnapStart = document.getElementById('btn-read-session-start');
  const btnSnapAgain = document.getElementById('btn-read-session-again');
  const btnSnapEnd   = document.getElementById('btn-read-session-end');
  if (btnSnapStart && btnSnapAgain && btnSnapEnd) {
    const sessionActive = !!state.readClient.sessionActive;
    btnSnapStart.disabled = readActive || sessionActive;
    btnSnapStart.title    = readActive    ? 'Read in progress — finish first'
                          : sessionActive ? 'End the current session first' : '';
    btnSnapAgain.disabled = readActive || !sessionActive;
    btnSnapAgain.title    = readActive     ? 'Read in progress — finish first'
                          : !sessionActive ? 'Start a session first' : '';
    btnSnapEnd.disabled   = readActive || !sessionActive;
    btnSnapEnd.title      = !sessionActive ? 'No active session' : '';
  }

  const rnDis = re.busy || re._waitResolve === null;
  document.getElementById('btn-read-next').disabled   = rnDis;
  document.getElementById('btn-read-finish').disabled = re._waitResolve === null;

  // ── Lock dropdowns ──
  const selW = document.getElementById('sel-w');
  const selJ = document.getElementById('sel-j');
  if (selW) { selW.disabled = writeActive; selW.title = writeActive ? 'Cannot change while a write is in progress' : ''; }
  if (selJ) { selJ.disabled = writeActive; selJ.title = writeActive ? 'Cannot change while a write is in progress' : ''; }

  const selRC = document.getElementById('sel-rc');
  const selRP = document.getElementById('sel-readpref');
  if (selRC) { selRC.disabled = readActive; selRC.title = readActive ? 'Cannot change while a read is in progress' : ''; }
  if (selRP) { selRP.disabled = readActive; selRP.title = readActive ? 'Cannot change while a read is in progress' : ''; }

  // ── Canvas election button — contextual overlay near dead primary ──
  const canvasBtnEl = document.getElementById('btn-canvas-election');
  if (canvasBtnEl && typeof state !== 'undefined') {
    const pk = state.primaryKey;
    const pNode = state.nodes[pk];
    const primaryDown   = !state.nodes[pk].alive;
    const hasCandidates = Object.keys(state.nodes).some(k => k !== pk && state.nodes[k].alive);
    const show = primaryDown && hasCandidates && !electionActive && !writeActive && !readActive;
    canvasBtnEl.style.display = show ? 'block' : 'none';
    if (show) {
      // pNode.x/y are CSS pixels within the canvas; canvas sits at padding=14px inside .stage
      canvasBtnEl.style.left = (14 + pNode.x) + 'px';
      canvasBtnEl.style.top  = (14 + pNode.y + 52 + 18) + 'px'; // NR=52, 18px gap
    }
  }
}

// ── Write panel Next/Finish smart wrappers ──
// When election is running, these advance the election engine instead of the write engine.
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

let _autoFinishId = null;
function autoFinishWrite() {
  if (writeEngine.done || writeEngine.idx === -1 || _autoFinishId) return;
  _autoFinishId = setInterval(() => {
    if (writeEngine.done || writeEngine.idx === -1) {
      clearInterval(_autoFinishId); _autoFinishId = null; return;
    }
    if (writeEngine._waitResolve && !writeEngine.busy) advanceWriteStep();
  }, 120);
}

let _autoFinishReadId = null;
function autoFinishRead() {
  if (readEngine.done || readEngine.idx === -1 || _autoFinishReadId) return;
  _autoFinishReadId = setInterval(() => {
    if (readEngine.done || readEngine.idx === -1) {
      clearInterval(_autoFinishReadId); _autoFinishReadId = null; return;
    }
    if (readEngine._waitResolve && !readEngine.busy) advanceReadStep();
  }, 120);
}

function advanceReadStep() {
  if (readEngine._waitResolve) { const r = readEngine._waitResolve; readEngine._waitResolve = null; r(); }
}

function advanceElectionStep() {
  if (electionEngine._waitResolve) { const r = electionEngine._waitResolve; electionEngine._waitResolve = null; r(); }
}

let _autoFinishElectionId = null;
function autoFinishElection() {
  if (electionEngine.done || electionEngine.idx === -1 || _autoFinishElectionId) return;
  _autoFinishElectionId = setInterval(() => {
    if (electionEngine.done || electionEngine.idx === -1) {
      clearInterval(_autoFinishElectionId); _autoFinishElectionId = null; return;
    }
    if (electionEngine._waitResolve && !electionEngine.busy) advanceElectionStep();
  }, 120);
}

async function waitForClick(eng) {
  if (eng.mode === 'auto') return;
  return new Promise(r => { eng._waitResolve = r; syncButtons(); });
}

const IDLE_HINT = {
  'write-step-panel': 'Start a write to step through the replication flow.',
  'read-step-panel':  'Probe the replica set to observe read concern behaviour.',
};

function showStepPanel(i, eng, panelId) {
  // When election uses the write panel, use the actual write panel DOM element IDs
  const prefix = panelId.replace(/-panel$/, '');
  if (i < 0 || eng.steps.length === 0) {
    document.getElementById(prefix + '-badge').textContent = '';
    document.getElementById(prefix + '-title').textContent = '';
    document.getElementById(prefix + '-explain').innerHTML =
      `<span class="step-panel-idle">${IDLE_HINT[panelId] || ''}</span>`;
    document.getElementById(prefix + '-dots').innerHTML = '';
    return;
  }
  const s = eng.steps[i];
  document.getElementById(prefix + '-badge').textContent  = `Step ${i+1} of ${eng.steps.length}`;
  document.getElementById(prefix + '-title').textContent  = s.title;
  // Explain text is collapsible — collapsed by default, user clicks to expand
  document.getElementById(prefix + '-explain').innerHTML  =
    `<details class="step-details">` +
    `<summary class="step-details-toggle">Details</summary>` +
    `<div class="step-explain-body">${s.explain}</div>` +
    `</details>`;
  const dotsEl = document.getElementById(prefix + '-dots');
  dotsEl.innerHTML = '';
  eng.steps.forEach((_, j) => {
    const d = document.createElement('div');
    d.className = 'step-dot' + (j < i ? ' done' : j === i ? ' current' : '');
    dotsEl.appendChild(d);
  });
}

async function runEngine(steps, eng, panelId) {
  eng.steps = steps; eng.idx = -1; eng.done = false; eng.busy = false; eng.aborted = false;
  let lastCompleted = -1;
  for (let i = 0; i < steps.length; i++) {
    if (eng.aborted) break;
    eng.idx = i;
    showStepPanel(i, eng, panelId);
    syncButtons();
    if (i > 0) await waitForClick(eng);
    if (eng.aborted) break;
    eng.busy = true; syncButtons();
    log(`▶ ${steps[i].title}`, 'info');
    await steps[i].run();
    lastCompleted = i;
    eng.busy = false;
    if (eng.aborted) break;
    if (eng.mode === 'auto' && i < steps.length - 1) {
      await delay(AUTO_STEP_MS);
      if (eng.aborted) break;
    }
  }
  if (eng.aborted && lastCompleted >= 0) {
    const bgSteps = steps.slice(lastCompleted + 1).filter(s => s.serverSide);
    if (bgSteps.length > 0) {
      (async () => {
        for (const step of bgSteps) {
          await delay(300);
          log(`▶ [server] ${step.title}`, 'info');
          await step.run();
        }
      })();
    }
  }
  if (!eng.aborted) {
    eng.done = true;
    showStepPanel(steps.length - 1, eng, panelId);
  }
  syncButtons();
}
