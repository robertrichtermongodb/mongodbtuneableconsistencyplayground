// ═══════════════════════════════════════
// ENGINES
// ═══════════════════════════════════════
const writeEngine = { mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false };
const readEngine  = { mode: 'auto', steps: [], idx: -1, _waitResolve: null, busy: false, done: false };

function setReadMode(m) {
  readEngine.mode = m;
  document.getElementById('btn-rmode-auto').classList.toggle('rmode-on', m === 'auto');
  document.getElementById('btn-rmode-step').classList.toggle('rmode-on', m === 'step');
  syncButtons();
}

function syncButtons() {
  const we = writeEngine, re = readEngine;

  // Write start
  const btnWS = document.getElementById('btn-write-start');
  btnWS.textContent = we.done ? 'New Write' : 'Start';
  btnWS.disabled    = we.busy || (we.idx !== -1 && !we.done);

  // Write next
  const btnWN = document.getElementById('btn-write-next');
  btnWN.disabled = we.busy || we._waitResolve === null;

  // Write finish (auto-complete remaining steps)
  const btnWF = document.getElementById('btn-write-finish');
  btnWF.disabled = we.done || we.idx === -1 || we.busy;

  // Read probe
  const btnRS = document.getElementById('btn-read-start');
  btnRS.textContent = re.done ? 'Probe Again' : 'Probe Read';
  btnRS.disabled    = re.busy || (re.idx !== -1 && !re.done);

  // Read next
  const btnRN = document.getElementById('btn-read-next');
  btnRN.style.display = re.mode === 'step' ? '' : 'none';
  btnRN.disabled = re.busy || re._waitResolve === null;
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

function advanceReadStep() {
  if (readEngine._waitResolve) { const r = readEngine._waitResolve; readEngine._waitResolve = null; r(); }
}

async function waitForClick(eng) {
  if (eng.mode === 'auto') return;
  return new Promise(r => { eng._waitResolve = r; syncButtons(); });
}

function showStepPanel(i, eng, panelId) {
  const panel = document.getElementById(panelId);
  if (i < 0 || eng.steps.length === 0) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const s = eng.steps[i];
  // Sub-element IDs use prefix without '-panel' suffix: 'write-step-panel' → 'write-step'
  const prefix = panelId.replace(/-panel$/, '');
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
  eng.steps = steps; eng.idx = -1; eng.done = false; eng.busy = false;
  for (let i = 0; i < steps.length; i++) {
    eng.idx = i;
    showStepPanel(i, eng, panelId);
    syncButtons();
    await waitForClick(eng);
    eng.busy = true; syncButtons();
    log(`▶ ${steps[i].title}`, 'info');
    await steps[i].run();
    eng.busy = false;
    if (eng.mode === 'auto' && i < steps.length - 1) await delay(AUTO_STEP_MS);
  }
  eng.done = true;
  showStepPanel(steps.length - 1, eng, panelId);
  syncButtons();
}
