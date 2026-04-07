const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineToEnd, runMachineSteps } = require('./helpers');

const ctx = createContext();

beforeEach(() => resetState(ctx));

// ─── helpers ────────────────────────────────────────────────────────────────

function machine(w, j) { return ctx.createWriteMachine(w, j); }
const s = () => ctx.state;

// ─── w:1 happy path ─────────────────────────────────────────────────────────

describe('w:1 j:false — primary-only ACK', () => {
  it('produces: send, primaryMem, primaryJournal, ACK, then async repl', async () => {
    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles[0].includes('sends'));
    assert.ok(titles[1].includes('memory'));
    assert.ok(titles[2].includes('journal'));
    assert.ok(titles[3].includes('ACK'));
    assert.ok(titles.length >= 4, `expected >=4 steps, got ${titles.length}`);
  });

  it('ACKs after primary only — no secondary needed', async () => {
    const m = machine(1, false);
    await runMachineToEnd(m);

    assert.equal(s().writeClient.phase, 'received');
    assert.equal(s().doc.latestId, 1);
    const entry = s().doc.versions[0];
    assert.ok(entry.ackedBy.has('primary'));
  });

  it('primary gets memoryVersion and journalVersion = 1', async () => {
    const m = machine(1, false);
    await runMachineToEnd(m);

    assert.equal(s().nodes.primary.memoryVersion, 1);
    assert.equal(s().nodes.primary.journalVersion, 1);
  });

  it('node phases transition correctly through the write', async () => {
    const m = machine(1, false);

    await runMachineSteps(m, 1); // send
    assert.equal(s().nodes.primary.phase, 'active');
    assert.equal(s().writeClient.phase, 'waiting');

    await runMachineSteps(m, 1); // primaryMem
    assert.equal(s().nodes.primary.phase, 'active');

    await runMachineSteps(m, 1); // primaryJournal
    assert.equal(s().nodes.primary.phase, 'active');

    await runMachineSteps(m, 1); // ACK
    assert.equal(s().nodes.primary.phase, 'acked');
    assert.equal(s().writeClient.phase, 'received');
  });
});

// ─── w:majority happy path ──────────────────────────────────────────────────

describe('w:majority j:false — majority ACK', () => {
  it('requires primary journal + one secondary journal before ACK', async () => {
    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);

    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(ackIdx >= 0, 'ACK step should exist');
    // Before ACK: send + primaryMem + primaryJournal + secMem + secJournal = 5 steps
    assert.ok(ackIdx >= 5, `ACK should be at index >= 5, was ${ackIdx}`);
  });

  it('sets majorityCommitId to 1', async () => {
    const m = machine('majority', false);
    await runMachineToEnd(m);

    assert.equal(s().doc.majorityCommitId, 1);
  });

  it('both primary and secondary have journalVersion = 1', async () => {
    const m = machine('majority', false);
    await runMachineToEnd(m);

    assert.equal(s().nodes.primary.journalVersion, 1);
    // At least one secondary should have journaled
    const secJournaled = ['s1', 's2'].some(k => s().nodes[k].journalVersion === 1);
    assert.ok(secJournaled, 'at least one secondary should have journalVersion=1');
  });
});

describe('w:majority — phase transitions', () => {
  it('secondary enters active after mem apply, acked after journal', async () => {
    const m = machine('majority', false);

    await runMachineSteps(m, 3); // send + primaryMem + primaryJournal
    assert.equal(s().nodes.primary.phase, 'active');

    await runMachineSteps(m, 1); // s1 mem
    assert.equal(s().nodes.s1.phase, 'active');

    await runMachineSteps(m, 1); // s1 journal
    assert.equal(s().nodes.s1.phase, 'acked');

    await runMachineSteps(m, 1); // ACK
    assert.equal(s().nodes.primary.phase, 'acked');
    assert.equal(s().writeClient.phase, 'received');
  });

  it('all nodes return to idle after full replication', async () => {
    const m = machine('majority', false);
    await runMachineToEnd(m);

    for (const k of ['primary', 's1', 's2']) {
      assert.equal(s().nodes[k].phase, 'idle', `${k} should be idle after completion`);
    }
  });
});

// ─── w:majority j:true ──────────────────────────────────────────────────────

describe('w:majority j:true', () => {
  it('gates ack on journal (same structure as j:false for majority)', async () => {
    const m = machine('majority', true);
    const titles = await runMachineToEnd(m);

    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(ackIdx >= 5);
    assert.equal(s().doc.majorityCommitId, 1);
  });
});

// ─── w:0 fire-and-forget ────────────────────────────────────────────────────

describe('w:0 j:false — fire-and-forget', () => {
  it('produces send, primaryMem, primaryJournal, fire-and-forget', async () => {
    const m = machine(0, false);
    const titles = await runMachineToEnd(m);

    assert.equal(titles.length, 4);
    assert.ok(titles[3].includes('Fire-and-forget'));
  });

  it('client returns to idle (no ACK)', async () => {
    const m = machine(0, false);
    await runMachineToEnd(m);

    assert.equal(s().writeClient.phase, 'idle');
  });
});

// ─── w:0 j:true → demoted to w:1 ───────────────────────────────────────────

describe('w:0 j:true — demoted to w:1', () => {
  it('behaves like w:1 (produces ACK, not fire-and-forget)', async () => {
    const m = machine(0, true);
    const titles = await runMachineToEnd(m);

    const hasAck = titles.some(t => t.includes('ACK'));
    const hasFireForget = titles.some(t => t.includes('Fire-and-forget'));
    assert.ok(hasAck, 'should have ACK step');
    assert.ok(!hasFireForget, 'should NOT have fire-and-forget');
  });
});

// ─── writer disconnected ────────────────────────────────────────────────────

describe('writer disconnected', () => {
  it('fails immediately when wp link is down', async () => {
    s().links.wp = false;
    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.equal(titles.length, 1);
    assert.ok(titles[0].includes('disconnected'));
    assert.equal(s().writeClient.phase, 'error');
  });
});

// ─── primary down ───────────────────────────────────────────────────────────

describe('primary down after send', () => {
  it('fails when primary is dead at memory-apply phase', async () => {
    const m = machine(1, false);
    // Run only the send step
    await runMachineSteps(m, 1);
    assert.equal(s().doc.latestId, 1);

    // Kill primary
    s().nodes.primary.alive = false;

    // Next step should detect dead primary
    const titles = await runMachineToEnd(m);
    assert.ok(titles.some(t => t.includes('No primary')));
    assert.equal(s().writeClient.phase, 'error');
  });
});

// ─── THE BUG: crash secondary mid-replication, machine retargets ────────────

describe('w:majority — crash S1 after memory apply, retarget to S2', () => {
  it('retargets replication to S2 and still ACKs', async () => {
    const m = machine('majority', false);

    // Run: send(1) + primaryMem(2) + primaryJournal(3) + s1Mem(4)
    const setup = await runMachineSteps(m, 4);
    assert.ok(setup[3].includes('Secondary 1'), `step 4 should replicate to S1, got: ${setup[3]}`);
    assert.equal(s().nodes.s1.memoryVersion, 1);

    // Crash S1
    ctx.crashNode('s1');
    s().nodes.s1.alive = false;

    // Continue — machine should skip S1 journal and retarget to S2
    const rest = await runMachineToEnd(m);

    const hasS2 = rest.some(t => t.includes('Secondary 2'));
    assert.ok(hasS2, `should retarget to S2. Steps after crash: ${rest.join(' | ')}`);

    const hasAck = rest.some(t => t.includes('ACK'));
    assert.ok(hasAck, 'should eventually ACK');
    assert.equal(s().doc.majorityCommitId, 1);
    assert.equal(s().writeClient.phase, 'received');
  });
});

// ─── write concern unsatisfiable ────────────────────────────────────────────

describe('w:majority — both secondaries down', () => {
  it('reports write concern cannot be satisfied', async () => {
    const m = machine('majority', false);
    await runMachineSteps(m, 3);

    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;

    const rest = await runMachineToEnd(m);
    assert.ok(rest.some(t => t.includes('cannot be satisfied')),
      `expected unsatisfiable error. Steps: ${rest.join(' | ')}`);
  });

  it('sets error phases on primary and client', async () => {
    const m = machine('majority', false);
    await runMachineSteps(m, 3);
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;
    await runMachineToEnd(m);

    assert.equal(s().nodes.primary.phase, 'error');
    assert.equal(s().writeClient.phase, 'error');
  });
});

// ─── w:2 — needs exactly 1 secondary ───────────────────────────────────────

describe('w:2 j:false', () => {
  it('ACKs after primary + 1 secondary', async () => {
    const m = machine(2, false);
    const titles = await runMachineToEnd(m);

    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(ackIdx >= 0);
    assert.equal(s().writeClient.phase, 'received');
  });
});

// ─── w:3 — needs all nodes ──────────────────────────────────────────────────

describe('w:3 j:false', () => {
  it('ACKs after all 3 nodes ack', async () => {
    const m = machine(3, false);
    const titles = await runMachineToEnd(m);

    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(ackIdx >= 0);
    // All 3 nodes should have acked
    const entry = s().doc.versions[0];
    assert.equal(entry.ackedBy.size, 3);
  });
});

// ─── crash + recover: unjournaled data lost ─────────────────────────────────

describe('crash + recover mid-write preserves journal', () => {
  it('after crash and recover, node has journalVersion not memoryVersion', async () => {
    const m = machine('majority', false);
    // Run through S1 memory apply (step 4)
    await runMachineSteps(m, 4);
    assert.equal(s().nodes.s1.memoryVersion, 1);
    assert.equal(s().nodes.s1.journalVersion, 0);

    // Crash S1 — loses unjournaled v1
    ctx.crashNode('s1');
    assert.equal(s().nodes.s1.memoryVersion, 0);
    assert.equal(s().nodes.s1.journalVersion, 0);

    // Recover S1
    ctx.recoverNode('s1');
    assert.equal(s().nodes.s1.memoryVersion, 0, 'nothing to recover from empty journal');
  });
});

// ─── second write increments version ────────────────────────────────────────

describe('sequential writes increment version', () => {
  it('second write produces v2', async () => {
    // First write
    await runMachineToEnd(machine(1, false));
    assert.equal(s().doc.latestId, 1);

    // Second write
    const m2 = machine(1, false);
    const titles = await runMachineToEnd(m2);

    assert.equal(s().doc.latestId, 2);
    assert.ok(titles[0].includes('v2'), `should mention v2: ${titles[0]}`);
  });
});

// ─── link partition mid-replication ─────────────────────────────────────────

describe('w:majority — partition link to S1 mid-replication', () => {
  it('retargets to S2 when S1 link goes down', async () => {
    const m = machine('majority', false);
    await runMachineSteps(m, 3); // send + primaryMem + primaryJournal

    // Partition S1
    s().links.ps1 = false;

    const rest = await runMachineToEnd(m);
    const hasS2 = rest.some(t => t.includes('Secondary 2'));
    assert.ok(hasS2, 'should route to S2');
    assert.ok(rest.some(t => t.includes('ACK')), 'should still ACK');
  });
});
