const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineToEnd, runMachineSteps, runSteps } = require('./helpers');

const ctx = createContext();

beforeEach(() => resetState(ctx));

const s = () => ctx.state;
function machine(w, j) { return ctx.createWriteMachine(w, j); }
function electionSteps() { return ctx.buildElectionSteps(); }

// ─── election happy path ────────────────────────────────────────────────────

describe('election — happy path (2 of 3 alive)', () => {
  it('elects a secondary as new primary', async () => {
    s().nodes.primary.alive = false;
    const steps = electionSteps();
    const titles = await runSteps(steps);

    assert.equal(titles.length, 2);
    assert.ok(titles[0].includes('campaigns'));
    assert.ok(titles[1].includes('elected'));
    assert.notEqual(s().primaryKey, 'primary', 'primaryKey should change');
  });

  it('new primary label is "Primary"', async () => {
    s().nodes.primary.alive = false;
    await runSteps(electionSteps());

    const newPK = s().primaryKey;
    assert.equal(s().nodes[newPK].label, 'Primary');
    assert.ok(s().nodes.primary.label.startsWith('Secondary'),
      `old primary should become a secondary, got: ${s().nodes.primary.label}`);
  });

  it('picks the node with highest memoryVersion', async () => {
    s().nodes.s1.memoryVersion = 5;
    s().nodes.s2.memoryVersion = 3;
    s().nodes.primary.alive = false;

    await runSteps(electionSteps());

    assert.equal(s().primaryKey, 's1', 's1 has higher oplog, should win');
  });
});

// ─── election quorum failure ────────────────────────────────────────────────

describe('election — quorum failure', () => {
  it('fails with only 1 alive node (need 2 of 3)', async () => {
    s().nodes.primary.alive = false;
    s().nodes.s2.alive = false;

    const steps = electionSteps();
    const titles = await runSteps(steps);

    assert.equal(titles.length, 1);
    assert.ok(titles[0].includes('impossible') || titles[0].includes('no majority'),
      `should fail: ${titles[0]}`);
    assert.equal(s().primaryKey, 'primary', 'primaryKey should not change');
  });

  it('fails when no candidates (all secondaries dead)', async () => {
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;

    const steps = electionSteps();
    const titles = await runSteps(steps);

    assert.equal(titles.length, 1);
    assert.ok(titles[0].includes('impossible') || titles[0].includes('no majority'));
  });
});

// ─── election rollback ──────────────────────────────────────────────────────

describe('election — rollback of uncommitted writes', () => {
  it('rolls back versions above majorityCommitId', async () => {
    // Write w:1 j:false — stop at ACK before async repl advances majority
    // send + primaryMem + primaryJournal + ACK = 4 steps
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    assert.equal(s().doc.latestId, 1);
    assert.equal(s().doc.majorityCommitId, 0);

    // Primary goes down
    s().nodes.primary.alive = false;
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

    // Election
    await runSteps(electionSteps());

    assert.equal(s().doc.latestId, 0, 'uncommitted v1 should be rolled back');
    assert.equal(s().doc.versions.length, 0, 'version array should be empty');
  });

  it('preserves majority-committed writes during rollback', async () => {
    // Write w:majority — majority-committed
    await runMachineToEnd(machine('majority', false));
    assert.equal(s().doc.majorityCommitId, 1);

    // Write w:1 j:false — stop at ACK before async repl advances majority
    // send + primaryMem + primaryJournal + ACK = 4 steps
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    const m2 = machine(1, false);
    await runMachineSteps(m2, 4);
    assert.equal(s().doc.latestId, 2);
    assert.equal(s().doc.majorityCommitId, 1);

    // Primary down + election
    s().nodes.primary.alive = false;
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(electionSteps());

    assert.equal(s().doc.latestId, 1, 'v1 (majority) survives, v2 rolled back');
    assert.equal(s().doc.versions.length, 1);
    assert.equal(s().doc.majorityCommitId, 1);
  });

  it('caps winning-partition node versions to majorityCommitId', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    s().nodes.primary.alive = false;
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(electionSteps());

    const aliveKeys = Object.keys(s().nodes).filter(k => s().nodes[k].alive);
    for (const k of aliveKeys) {
      assert.ok(s().nodes[k].memoryVersion <= s().doc.majorityCommitId,
        `${k} memoryVersion should be capped`);
      assert.ok(s().nodes[k].journalVersion <= s().doc.majorityCommitId,
        `${k} journalVersion should be capped`);
    }
  });
});

// ─── deferred rollback (partition election) ─────────────────────────────────

describe('election — deferred rollback on partition', () => {
  function partitionPrimary() {
    s().links.ps1 = false;
    s().links.ps2 = false;
  }

  it('old primary retains stale data after partition election', async () => {
    // w:1 — stop after ACK (step 4), before async replication
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    assert.equal(s().nodes.primary.memoryVersion, 1);
    assert.equal(s().doc.majorityCommitId, 0, 'v1 not yet majority-committed');

    partitionPrimary();
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));

    assert.equal(s().nodes.primary.memoryVersion, 1,
      'isolated old primary should still have stale v1');
    assert.equal(s().nodes.primary.journalVersion, 1,
      'isolated old primary journal should still have stale v1');
    assert.equal(s().doc.majorityCommitId, 0,
      'cluster rolled back v1');
  });

  it('stale data is rolled back on reconnection via syncRejoiningNode', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 4);

    partitionPrimary();
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));
    const newPk = s().primaryKey;
    assert.notEqual(newPk, 'primary');
    assert.equal(s().nodes.primary.memoryVersion, 1, 'stale before reconnect');

    // Restore links — simulate reconnection
    s().links.ps1 = true;
    s().links.ps2 = true;
    ctx.syncRejoiningNode('primary');

    assert.equal(s().nodes.primary.memoryVersion, s().nodes[newPk].memoryVersion,
      'old primary should sync to new primary level');
    assert.equal(s().nodes.primary.memoryVersion, 0,
      'stale v1 should be rolled back on rejoin');
  });

  it('winning partition nodes are capped but isolated node is not', async () => {
    // w:1 — stop after ACK, before async replication
    const m = machine(1, false);
    await runMachineSteps(m, 4);

    partitionPrimary();
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));

    for (const k of ['s1', 's2']) {
      assert.ok(s().nodes[k].memoryVersion <= s().doc.majorityCommitId,
        `${k} (winning partition) should be capped`);
    }
    assert.equal(s().nodes.primary.memoryVersion, 1,
      'old primary (isolated) should NOT be capped yet');
  });
});

// ─── split-brain election (primary partitioned, not dead) ───────────────────

describe('split-brain election — primary partitioned', () => {
  function partitionPrimary() {
    s().links.ps1 = false;
    s().links.ps2 = false;
    // s1s2 stays up — secondaries can communicate
  }

  it('succeeds when primary is alive but partitioned from both secondaries', async () => {
    partitionPrimary();
    const steps = ctx.buildElectionSteps({ forcePartition: true });
    const titles = await runSteps(steps);

    assert.equal(titles.length, 2, 'should have campaign + elected steps');
    assert.ok(titles[0].includes('campaigns'), `step 0: ${titles[0]}`);
    assert.ok(titles[1].includes('elected'), `step 1: ${titles[1]}`);
    assert.notEqual(s().primaryKey, 'primary', 'new primary should be a secondary');
  });

  it('fails when primary is partitioned AND s1s2 is also down', async () => {
    partitionPrimary();
    s().links.s1s2 = false;
    const steps = ctx.buildElectionSteps({ forcePartition: true });
    const titles = await runSteps(steps);

    assert.equal(titles.length, 1, 'should be a single impossible step');
    assert.ok(titles[0].includes('impossible') || titles[0].includes('no majority'),
      `should fail: ${titles[0]}`);
  });

  it('picks highest memoryVersion among secondaries', async () => {
    s().nodes.s1.memoryVersion = 2;
    s().nodes.s2.memoryVersion = 5;
    partitionPrimary();

    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));
    assert.equal(s().primaryKey, 's2', 's2 has higher memoryVersion');
  });

  it('old primary becomes a Secondary after force election', async () => {
    partitionPrimary();
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));

    assert.ok(s().nodes.primary.label.startsWith('Secondary'),
      `old primary should become a secondary, got: ${s().nodes.primary.label}`);
    assert.notEqual(s().primaryKey, 'primary');
  });

  it('old primary is isolated after force election (partition still active)', async () => {
    partitionPrimary();
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));

    assert.equal(ctx.isNodeIsolated('primary'), true,
      'old primary should be detected as isolated');
  });
});

// ─── election invalidates snapshot session ──────────────────────────────────

describe('election — snapshot session invalidation', () => {
  it('invalidates session when locked version is rolled back', async () => {
    // Write w:1 j:false — stop at ACK to keep it uncommitted
    // send + primaryMem + primaryJournal + ACK = 4 steps
    const m = machine(1, false);
    await runMachineSteps(m, 4);

    // Fake a snapshot session locked at v1 (above majorityCommitId=0)
    s().readClient.sessionActive = true;
    s().readClient.sessionSnapshotId = 1;

    // Election rolls back v1
    s().nodes.primary.alive = false;
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(electionSteps());

    assert.equal(s().readClient.sessionActive, false, 'session should be invalidated');
    assert.equal(s().readClient.sessionSnapshotId, null);
  });

  it('preserves session when locked version survives rollback', async () => {
    await runMachineToEnd(machine('majority', false));
    assert.equal(s().doc.majorityCommitId, 1);

    s().readClient.sessionActive = true;
    s().readClient.sessionSnapshotId = 1;

    // Write another w:1 then elect — v1 survives
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runMachineToEnd(machine(1, false));
    s().nodes.primary.alive = false;
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(electionSteps());

    assert.equal(s().readClient.sessionActive, true, 'session should survive');
    assert.equal(s().readClient.sessionSnapshotId, 1);
  });
});
