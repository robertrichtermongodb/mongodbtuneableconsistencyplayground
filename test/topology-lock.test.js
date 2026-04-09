'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState } = require('./helpers');

describe('topology lock (engines + snapshot session)', () => {
  it('isAnyEngineActive is false when only a snapshot session is open', () => {
    const ctx = createContext();
    resetState(ctx);
    const re = ctx.$readEngine;
    re.idx = -1;
    re.done = true;
    re.busy = false;
    re.aborted = false;
    ctx.state.readClient.sessionActive = true;
    ctx.state.readClient.sessionSnapshotId = 0;
    assert.equal(ctx.$isAnyEngineActive(), false);
    assert.equal(ctx.$isTopologyLocked(), true);
  });

  it('isTopologyLocked follows idle engines when session is closed', () => {
    const ctx = createContext();
    resetState(ctx);
    const re = ctx.$readEngine;
    re.idx = -1;
    re.done = true;
    re.busy = false;
    re.aborted = false;
    ctx.state.readClient.sessionActive = false;
    ctx.state.readClient.sessionSnapshotId = null;
    assert.equal(ctx.$isTopologyLocked(), false);
  });

  it('write machine can advance while a snapshot session is open (engines idle)', async () => {
    const ctx = createContext();
    resetState(ctx);
    ctx.state.readClient.sessionActive = true;
    ctx.state.readClient.sessionSnapshotId = 0;

    const machine = ctx.createWriteMachine('majority', false);
    const step = machine.nextStep();
    assert.ok(step, 'first write step should be available');
    assert.match(step.title, /Write Client sends/);
    await step.run();

    assert.equal(ctx.$isTopologyLocked(), true);
  });
});
