const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineToEnd, runMachineSteps, runSteps, idleAllPhases } = require('./helpers');

const ctx = createContext();

beforeEach(() => resetState(ctx));

const s = () => ctx.state;
function readSteps(rc, pref, snap) { return ctx.buildReadSteps(rc, pref, snap); }
function machine(w, j) { return ctx.createWriteMachine(w, j); }

// Pre-populate a majority-committed v1 for read tests that need data
async function writeV1() {
  await runMachineToEnd(machine('majority', false));
  idleAllPhases(ctx);
}

// ─── rc:local ───────────────────────────────────────────────────────────────

describe('rc:local — reads memoryVersion', () => {
  it('returns none when nothing written', async () => {
    const steps = readSteps('local', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('none')));
    assert.equal(s().readClient.phase, 'received');
  });

  it('returns v1 after a write', async () => {
    await writeV1();
    const steps = readSteps('local', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('v1')));
    assert.equal(s().readClient.lastReceivedVersion.id, 1);
  });

  it('flags dirty read when memoryVersion > majorityCommitId', async () => {
    // Write w:1 j:false — stop at ACK before async replication advances majorityCommitId
    // send + primaryMem + primaryJournal + ACK = 4 steps
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    s().writeClient.phase = 'idle';
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    assert.equal(s().doc.majorityCommitId, 0, 'w:1 ACK before repl should not majority-commit');
    assert.equal(s().nodes.primary.memoryVersion, 1);

    const steps = readSteps('local', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('dirty')), `should flag dirty: ${titles.join(' | ')}`);
    assert.equal(s().readClient.lastReceivedVersion.dirty, true);
  });

  it('reads from secondary (not primary) with secondaryPreferred', async () => {
    await writeV1();
    // Give primary a higher memoryVersion so we can tell if it was read from
    s().nodes.primary.memoryVersion = 99;
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    const steps = readSteps('local', 'secondaryPreferred');
    const titles = await runSteps(steps);

    assert.equal(s().readClient.phase, 'received');
    assert.notEqual(s().readClient.lastReceivedVersion.id, 99,
      'should read from secondary, not primary (v99)');
  });
});

// ─── rc:majority ────────────────────────────────────────────────────────────

describe('rc:majority — reads majorityCommitId', () => {
  it('returns v1 after majority-committed write', async () => {
    await writeV1();
    const steps = readSteps('majority', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('v1')));
    assert.equal(s().readClient.lastReceivedVersion.id, 1);
    assert.equal(s().readClient.lastReceivedVersion.dirty, false);
  });

  it('returns none when only w:1 write done (not majority-committed)', async () => {
    // Stop at ACK — before async replication would advance majorityCommitId
    // send + primaryMem + primaryJournal + ACK = 4 steps
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    const steps = readSteps('majority', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('none')));
  });

  it('detects frozen majority-commit when only 1 node reachable', async () => {
    await writeV1();
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    const steps = readSteps('majority', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('frozen')), `should detect frozen: ${titles.join(' | ')}`);
  });

  it('does not freeze rc:majority when write client targets isolated node but cluster has majority', async () => {
    await writeV1();
    // Simulate post-election: old primary slot isolated at v1; s2 is primary with s1 at v2; mc advanced.
    s().primaryKey = 's2';
    s().nodes.s1.memoryVersion = 2;
    s().nodes.s1.journalVersion = 2;
    s().nodes.s2.memoryVersion = 2;
    s().nodes.s2.journalVersion = 2;
    s().nodes.primary.memoryVersion = 1;
    s().nodes.primary.journalVersion = 1;
    s().doc.latestId = 2;
    s().doc.majorityCommitId = 2;
    s().doc.versions.push({ id: 2, op: 'update', ackedBy: new Set(['s1', 's2']) });
    s().links.ps1 = false;
    s().links.ps2 = false;
    s().links.s1s2 = true;
    s().writeClient.targetNode = 'primary';
    s().readClient.targetNode = 'primary';
    s().writeClient.phase = 'idle';
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    const steps = readSteps('majority', 'primary');
    const titles = await runSteps(steps);

    assert.equal(s().readClient.lastReceivedVersion.id, 1,
      'isolated lagging node min(mc, memory) — must not serve v2');
    assert.equal(s().readClient.lastReceivedVersion.dirty, false);
    assert.ok(!titles.some(t => /frozen/i.test(t)),
      'cluster still has majority — should not take frozen read path');
    assert.ok(titles.some(t => t.includes('v1')));
  });
});

// ─── rc:linearizable ────────────────────────────────────────────────────────

describe('rc:linearizable', () => {
  it('forces target to primary regardless of readPref', async () => {
    await writeV1();
    const steps = readSteps('linearizable', 'secondary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('leadership') || t.includes('Leadership')));
    assert.equal(s().readClient.phase, 'received');
  });

  it('blocks when majority unreachable', async () => {
    await writeV1();
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    const steps = readSteps('linearizable', 'primary');
    await runSteps(steps);

    assert.equal(s().readClient.phase, 'error');
  });

  it('blocks when secondaries die AFTER steps are built (runtime check)', async () => {
    await writeV1();
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    // Build steps while all nodes are alive
    const steps = readSteps('linearizable', 'primary');

    // Run the first step (read request sent to primary)
    await steps[0].run();

    // Kill both secondaries AFTER step-build, before leadership check runs
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;

    // Run remaining steps — leadership check should fail at runtime
    for (let i = 1; i < steps.length; i++) await steps[i].run();

    assert.equal(s().readClient.phase, 'error',
      'should detect dead secondaries at runtime, not just build time');
  });

  it('returns fresh majorityCommitId at data-return time (not build time)', async () => {
    await writeV1();
    assert.equal(s().doc.majorityCommitId, 1);
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    // Build steps while majorityCommitId=1
    const steps = readSteps('linearizable', 'primary');

    // Run steps 0 + 1 (read request + leadership ping)
    await steps[0].run();
    await steps[1].run();

    // Advance majorityCommitId to 2 BETWEEN leadership confirmation and data return
    s().doc.versions.push({ id: 2, op: 'update', ackedBy: new Set(['primary', 's1']) });
    s().doc.latestId = 2;
    s().doc.majorityCommitId = 2;
    s().nodes.primary.memoryVersion = 2;

    // Run leadership evaluation + data return
    await steps[2].run();
    await steps[3].run();

    assert.equal(s().readClient.lastReceivedVersion.id, 2,
      'linearizable should return the CURRENT majorityCommitId (2), not the build-time value (1)');
  });
});

// ─── rc:snapshot ────────────────────────────────────────────────────────────

describe('rc:snapshot', () => {
  it('returns majority-commit point', async () => {
    await writeV1();
    const steps = readSteps('snapshot', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('v1')));
    assert.equal(s().readClient.phase, 'received');
  });

  it('session locks at a fixed point-in-time', async () => {
    await writeV1();
    const snapId = s().doc.majorityCommitId;

    // First read with snapshotOverrideId
    const steps1 = readSteps('snapshot', 'primary', snapId);
    await runSteps(steps1);
    assert.equal(s().readClient.lastReceivedVersion.id, snapId);

    // Do another write — v2
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);
    await runMachineToEnd(machine('majority', false));

    assert.equal(s().doc.majorityCommitId, 2);

    // Second read with same snapshotOverrideId — should still return v1
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);
    const steps2 = readSteps('snapshot', 'primary', snapId);
    await runSteps(steps2);
    assert.equal(s().readClient.lastReceivedVersion.id, snapId,
      'snapshot session should still see v1 despite v2 being committed');
  });
});

// ─── reader disconnected ────────────────────────────────────────────────────

describe('reader disconnected', () => {
  it('fails when rp link is down', async () => {
    s().links.rp = false;
    const steps = readSteps('local', 'primary');
    const titles = await runSteps(steps);

    assert.equal(titles.length, 1);
    assert.ok(titles[0].includes('disconnected'));
    assert.equal(s().readClient.phase, 'error');
  });
});

// ─── primary dead + read pref ───────────────────────────────────────────────

describe('primary dead — read preference fallback', () => {
  it('primary pref fails when primary is down', async () => {
    s().nodes.primary.alive = false;
    const steps = readSteps('local', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('fails') || t.includes('No eligible')));
  });

  it('primaryPreferred falls back to secondary and returns data', async () => {
    await writeV1();
    s().nodes.primary.alive = false;
    s().readClient.phase = 'idle';
    idleAllPhases(ctx);

    const steps = readSteps('local', 'primaryPreferred');
    const titles = await runSteps(steps);

    assert.equal(s().readClient.phase, 'received');
    assert.ok(s().readClient.lastReceivedVersion.id >= 1,
      'secondary should serve replicated data');
  });
});
