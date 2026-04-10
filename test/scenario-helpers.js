// Scenario-level orchestration helpers for integration tests.
// Each function mirrors the corresponding app.js handler, operating on the
// VM context directly. Uses the real runMachine/engine pipeline when the
// context is created with { scenarioMode: true }.

const assert = require('node:assert/strict');

// ═══════════════════════════════════════
// SCENARIO SETUP
// ═══════════════════════════════════════

function applyScenario(ctx, scenario) {
  const setup = scenario.setup;
  ctx.setSelectedWriteConcern(setup.w);
  ctx.setSelectedJournal(setup.j);
  ctx.setSelectedReadConcern(setup.rc);
  ctx.setSelectedReadPref(setup.readPref);
  if (setup.links) {
    for (const [k, v] of Object.entries(setup.links)) ctx.state.links[k] = v;
  }
}

// ═══════════════════════════════════════
// WRITE / READ / ELECTION
// ═══════════════════════════════════════

async function performWrite(ctx) {
  const wVal = ctx.getSelectedWriteConcern();
  const wResolved = wVal === 'majority' ? 'majority' : parseInt(wVal, 10);
  const journalRequired = ctx.isJournalRequired();
  const machine = ctx.createWriteMachine(wResolved, journalRequired);
  await ctx.$runMachine(machine, ctx.$writeEngine, 'write-step-panel');
}

async function performRead(ctx) {
  const rc = ctx.getSelectedReadConcern();
  const readPref = ctx.getSelectedReadPref();
  const steps = ctx.buildReadSteps(rc, readPref);
  await ctx.$runMachine(ctx.$arrayMachine(steps), ctx.$readEngine, 'read-step-panel');
}

async function performSnapshotStart(ctx) {
  ctx.state.readClient.sessionActive = true;
  ctx.state.readClient.sessionSnapshotId = ctx.state.doc.majorityCommitId;
  const readPref = ctx.getSelectedReadPref();
  const snapId = ctx.state.readClient.sessionSnapshotId;
  const steps = ctx.buildReadSteps('snapshot', readPref, snapId);
  await ctx.$runMachine(ctx.$arrayMachine(steps), ctx.$readEngine, 'read-step-panel');
}

async function performSnapshotRead(ctx) {
  const readPref = ctx.getSelectedReadPref();
  const snapId = ctx.state.readClient.sessionSnapshotId;
  const steps = ctx.buildReadSteps('snapshot', readPref, snapId);
  await ctx.$runMachine(ctx.$arrayMachine(steps), ctx.$readEngine, 'read-step-panel');
}

function endSnapshotSession(ctx) {
  ctx.state.readClient.sessionActive = false;
  ctx.state.readClient.sessionSnapshotId = null;
}

async function performElection(ctx, opts) {
  const steps = ctx.buildElectionSteps(opts);
  await ctx.$runMachine(ctx.$arrayMachine(steps), ctx.$electionEngine, 'write-step-panel');
}

// ═══════════════════════════════════════
// TOPOLOGY MUTATIONS
// ═══════════════════════════════════════

function crashNodeByKey(ctx, nodeKey) {
  ctx.state.nodes[nodeKey].alive = false;
  ctx.crashNode(nodeKey);
}

function recoverNodeByKey(ctx, nodeKey) {
  ctx.state.nodes[nodeKey].alive = true;
  ctx.recoverNode(nodeKey);
  ctx.syncRejoiningNode(nodeKey);
  ctx.state.nodes[nodeKey].phase = 'idle';
}

function healPartition(ctx) {
  ctx.state.links.ps1 = true;
  ctx.state.links.ps2 = true;
  ctx.state.links.s1s2 = true;
  const pk = ctx.state.primaryKey;
  for (const k of Object.keys(ctx.state.nodes)) {
    if (k === pk || !ctx.state.nodes[k].alive) continue;
    ctx.syncRejoiningNode(k);
  }
  Object.values(ctx.state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
}

function resetEngines(ctx) {
  for (const eng of [ctx.$writeEngine, ctx.$readEngine, ctx.$electionEngine]) {
    eng.aborted = true;
    if (eng._waitResolve) { const r = eng._waitResolve; eng._waitResolve = null; r(); }
    eng.done = false; eng.idx = -1; eng.busy = false;
    eng.steps = []; eng._machine = null;
    if (eng._autoFinishId) { clearInterval(eng._autoFinishId); eng._autoFinishId = null; }
  }
}

// ═══════════════════════════════════════
// ASSERTION HELPERS
// ═══════════════════════════════════════

function assertNodeVersion(ctx, nodeKey, expectedMem, expectedDisk) {
  const node = ctx.state.nodes[nodeKey];
  assert.equal(node.memoryVersion, expectedMem,
    `${node.label} memoryVersion: expected ${expectedMem}, got ${node.memoryVersion}`);
  if (expectedDisk !== undefined) {
    assert.equal(node.journalVersion, expectedDisk,
      `${node.label} journalVersion: expected ${expectedDisk}, got ${node.journalVersion}`);
  }
}

function assertWriteOutcome(ctx, expectedPhase, expectedLatestId) {
  assert.equal(ctx.state.writeClient.phase, expectedPhase,
    `writeClient.phase: expected '${expectedPhase}', got '${ctx.state.writeClient.phase}'`);
  if (expectedLatestId !== undefined) {
    assert.equal(ctx.state.doc.latestId, expectedLatestId,
      `doc.latestId: expected ${expectedLatestId}, got ${ctx.state.doc.latestId}`);
  }
}

function assertReadResult(ctx, expectedId, expectedDirty) {
  const ver = ctx.state.readClient.lastReceivedVersion;
  assert.notEqual(ver, null, 'readClient.lastReceivedVersion should not be null');
  assert.equal(ver.id, expectedId,
    `read result version: expected ${expectedId}, got ${ver.id}`);
  if (expectedDirty !== undefined) {
    assert.equal(ver.dirty, expectedDirty,
      `read result dirty: expected ${expectedDirty}, got ${ver.dirty}`);
  }
}

function assertReadError(ctx, expectedReason) {
  assert.equal(ctx.state.readClient.phase, 'error',
    `readClient.phase: expected 'error', got '${ctx.state.readClient.phase}'`);
  if (expectedReason !== undefined) {
    assert.equal(ctx.state.readClient.errorReason, expectedReason,
      `readClient.errorReason: expected '${expectedReason}', got '${ctx.state.readClient.errorReason}'`);
  }
}

function assertPrimaryIs(ctx, expectedKey) {
  assert.equal(ctx.state.primaryKey, expectedKey,
    `primaryKey: expected '${expectedKey}', got '${ctx.state.primaryKey}'`);
}

module.exports = {
  applyScenario, performWrite, performRead,
  performSnapshotStart, performSnapshotRead, endSnapshotSession,
  performElection, crashNodeByKey, recoverNodeByKey,
  healPartition, resetEngines,
  assertNodeVersion, assertWriteOutcome, assertReadResult,
  assertReadError, assertPrimaryIs,
};
