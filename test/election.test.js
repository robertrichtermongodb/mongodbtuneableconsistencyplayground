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
    assert.equal(s().nodes.primary.label, 'Old Primary');
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

  it('caps node versions to majorityCommitId', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    s().nodes.primary.alive = false;
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runSteps(electionSteps());

    for (const k of Object.keys(s().nodes)) {
      assert.ok(s().nodes[k].memoryVersion <= s().doc.majorityCommitId,
        `${k} memoryVersion should be capped`);
      assert.ok(s().nodes[k].journalVersion <= s().doc.majorityCommitId,
        `${k} journalVersion should be capped`);
    }
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
