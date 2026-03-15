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
  const we = writeEngine, re = readEngine;
  const writeActive = we.busy || (we.idx !== -1 && !we.done && !we.aborted);
  const readActive  = re.busy || (re.idx !== -1 && !re.done && !re.aborted);

  // Write start button — text reflects whether this is a first insert or a subsequent update
  const isFirstWrite = typeof state !== 'undefined' && state.doc.latestId === 0;
  const btnWS = document.getElementById('btn-write-start');
  btnWS.textContent = we.aborted ? 'Retry' : isFirstWrite ? 'New doc with ID 1' : 'Update doc with ID 1';
  btnWS.disabled    = writeActive;

  const wnDis = we.busy || we._waitResolve === null;
  document.getElementById('btn-write-next').disabled   = wnDis;
  document.getElementById('btn-write-finish').disabled = we._waitResolve === null;

  // Read start button — always describes the action
  const btnRS = document.getElementById('btn-read-start');
  btnRS.textContent = re.aborted ? 'Retry' : 'Query doc with ID 1';
  btnRS.disabled    = readActive;
  if (typeof updateReadActionControls === 'function') updateReadActionControls();

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
  document.getElementById('btn-read-next').style.display = '';
  document.getElementById('btn-read-next').disabled      = rnDis;
  document.getElementById('btn-read-finish').disabled      = re._waitResolve === null;

  // Election button
  const ee = electionEngine;
  const electionActive = ee.busy || (ee.idx !== -1 && !ee.done && !ee.aborted);
  const btnElect = document.getElementById('btn-election-start');
  if (btnElect) {
    // Only allow election when the current primary is down and at least one secondary is alive
    const pk = typeof state !== 'undefined' ? state.primaryKey : 'primary';
    const primaryDown = typeof state !== 'undefined' && !state.nodes[pk].alive;
    const hasCandidates = typeof state !== 'undefined' &&
      Object.keys(state.nodes).some(k => k !== pk && state.nodes[k].alive);
    btnElect.disabled = electionActive || writeActive || readActive || !primaryDown || !hasCandidates;
    btnElect.title = (!primaryDown)
      ? 'Take the primary offline first (click the Primary node on the canvas)'
      : (!hasCandidates)
      ? 'No alive secondaries to elect'
      : 'Trigger a new primary election';
  }
  const enDis = ee.busy || ee._waitResolve === null;
  const btnEN = document.getElementById('btn-election-next');
  const btnEF = document.getElementById('btn-election-finish');
  if (btnEN) btnEN.disabled = enDis;
  if (btnEF) btnEF.disabled = ee._waitResolve === null;

  // Lock write concern dropdowns while a write is running
  const selW = document.getElementById('sel-w');
  const selJ = document.getElementById('sel-j');
  if (selW) selW.disabled = writeActive;
  if (selJ) selJ.disabled = writeActive;
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
  'write-step-panel':    'Start a write to step through the replication flow.',
  'read-step-panel':     'Probe the replica set to observe read concern behaviour.',
  'election-step-panel': 'Take the primary offline, then trigger an election to see how MongoDB elects a new primary.',
};

function showStepPanel(i, eng, panelId) {
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
  document.getElementById(prefix + '-explain').innerHTML  = s.explain;
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
