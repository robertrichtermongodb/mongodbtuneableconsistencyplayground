// Loads the simulation source files into a Node VM context with browser
// globals stubbed out.  Returns the context object so tests can access
// `state`, `createWriteMachine`, helper functions, etc.

const vm   = require('node:vm');
const fs   = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'js');

// Source files in load order (matches index.html <script> tags).
// We skip icons.js (pure SVG paths) and logger.js / draw.js (replaced by stubs).
const SOURCE_FILES = ['theme.js', 'state.js', 'texts.js', 'simulation.js', 'engine.js'];

function createContext() {
  const ctx = vm.createContext({
    // Timer stubs
    setTimeout:    globalThis.setTimeout,
    setInterval:   globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    Promise:       globalThis.Promise,
    Set:           globalThis.Set,
    Object:        globalThis.Object,
    Math:          globalThis.Math,
    Array:         globalThis.Array,
    console:       globalThis.console,

    // Browser stubs — no-ops so source files load without error
    log:            () => {},
    draw:           () => {},
    startAnimLoop:  () => {},
    skipAnimations: true,                   // instant resolution for all delays/particles
    setSkipAnimations(v) { ctx.skipAnimations = v; },

    awaitParticle(_from, _to, _color, _label, onArrive) {
      if (onArrive) onArrive();
      return Promise.resolve();
    },

    // Minimal DOM stubs — only needed if engine.js syncButtons runs
    document: {
      getElementById: () => ({
        disabled: false, title: '', textContent: '',
        style: {}, classList: { add() {}, remove() {} },
        querySelector: () => null,
        innerHTML: '',
        addEventListener: () => {},
      }),
      documentElement: {
        setAttribute() {},
        style: { setProperty() {} },
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
  });

  for (const file of SOURCE_FILES) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf-8');
    vm.runInContext(code, ctx, { filename: file });
  }

  // `const` / `let` declarations inside VM scripts are block-scoped and do NOT
  // become properties on the context object.  Function declarations and `var`s do.
  // Bridge the key const bindings so tests can reach them via ctx.xxx:
  vm.runInContext(`
    this.$state          = state;
    this.$PARTICLE_MS    = PARTICLE_MS;
    this.$AUTO_STEP_MS   = AUTO_STEP_MS;
    this.$writeEngine    = writeEngine;
    this.$readEngine     = readEngine;
    this.$electionEngine = electionEngine;
  `, ctx);

  // Alias the bridged state as plain `state` for convenience in tests.
  Object.defineProperty(ctx, 'state', { get() { return ctx.$state; } });

  return ctx;
}

// Resets the state inside an existing context to a clean 3-node replica set.
function resetState(ctx) {
  ctx.resetDoc();
  ctx.resetLinks();
  const nodes = ctx.state.nodes;
  for (const k of Object.keys(nodes)) {
    nodes[k].alive = true;
    nodes[k].phase = 'idle';
    nodes[k].memoryVersion = 0;
    nodes[k].journalVersion = 0;
  }
  ctx.state.primaryKey = 'primary';
  ctx.state.nodes.primary.label = 'Primary';
  ctx.state.nodes.s1.label = 'Secondary 1';
  ctx.state.nodes.s2.label = 'Secondary 2';
  ctx.state.particles = [];
}

// Drives a machine to completion: calls nextStep() + step.run() in a loop.
// Returns the collected history of step titles for assertion.
async function runMachineToEnd(machine) {
  let step;
  const titles = [];
  while ((step = machine.nextStep())) {
    titles.push(step.title);
    await step.run();
  }
  return titles;
}

// Drives a machine N steps forward (nextStep + run for each).
async function runMachineSteps(machine, n) {
  const titles = [];
  for (let i = 0; i < n; i++) {
    const step = machine.nextStep();
    if (!step) break;
    titles.push(step.title);
    await step.run();
  }
  return titles;
}

// Runs a pre-built step array (like buildReadSteps / buildElectionSteps).
async function runSteps(steps) {
  const titles = [];
  for (const step of steps) {
    titles.push(step.title);
    await step.run();
  }
  return titles;
}

module.exports = { createContext, resetState, runMachineToEnd, runMachineSteps, runSteps };
