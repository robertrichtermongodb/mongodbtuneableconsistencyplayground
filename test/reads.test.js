const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineToEnd, runMachineSteps, runSteps } = require('./helpers');

const ctx = createContext();

beforeEach(() => resetState(ctx));

const s = () => ctx.state;
function readSteps(rc, pref, snap) { return ctx.buildReadSteps(rc, pref, snap); }
function machine(w, j) { return ctx.createWriteMachine(w, j); }

// Pre-populate a majority-committed v1 for read tests that need data
async function writeV1() {
  await runMachineToEnd(machine('majority', false));
  // Reset client phases so reads start clean
  s().writeClient.phase = 'idle';
  s().readClient.phase = 'idle';
  Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
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
    // Write w:1 — stop at ACK before async replication advances majorityCommitId
    const m = machine(1, false);
    await runMachineSteps(m, 4); // send + primaryMem + primaryJournal + ACK
    s().writeClient.phase = 'idle';
    s().readClient.phase = 'idle';
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

    assert.equal(s().doc.majorityCommitId, 0, 'w:1 ACK before repl should not majority-commit');
    assert.equal(s().nodes.primary.memoryVersion, 1);

    const steps = readSteps('local', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('dirty')), `should flag dirty: ${titles.join(' | ')}`);
    assert.equal(s().readClient.lastReceivedVersion.dirty, true);
  });

  it('reads from secondary with secondaryPreferred', async () => {
    await writeV1();
    const steps = readSteps('local', 'secondaryPreferred');
    const titles = await runSteps(steps);

    assert.equal(s().readClient.phase, 'received');
    assert.ok(s().readClient.lastReceivedVersion.id >= 0);
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
    const m = machine(1, false);
    await runMachineSteps(m, 4);
    s().readClient.phase = 'idle';
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

    const steps = readSteps('majority', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('none')));
  });

  it('detects frozen majority-commit when only 1 node reachable', async () => {
    await writeV1();
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;
    s().readClient.phase = 'idle';
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

    const steps = readSteps('majority', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('frozen')), `should detect frozen: ${titles.join(' | ')}`);
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
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });

    const steps = readSteps('linearizable', 'primary');
    const titles = await runSteps(steps);

    assert.ok(titles.some(t => t.includes('blocks') || t.includes('Cannot confirm')),
      `should block: ${titles.join(' | ')}`);
    assert.equal(s().readClient.phase, 'error');
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
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
    await runMachineToEnd(machine('majority', false));

    assert.equal(s().doc.majorityCommitId, 2);

    // Second read with same snapshotOverrideId — should still return v1
    s().readClient.phase = 'idle';
    Object.values(s().nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
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

  it('primaryPreferred falls back to secondary', async () => {
    await writeV1();
    s().nodes.primary.alive = false;
    s().readClient.phase = 'idle';

    const steps = readSteps('local', 'primaryPreferred');
    const titles = await runSteps(steps);

    assert.equal(s().readClient.phase, 'received');
  });
});
