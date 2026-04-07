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
  it('ACKs after primary memory + journal (same as j:true for w:1)', async () => {
    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles[0].includes('sends'));
    assert.ok(titles[1].includes('memory'));
    assert.ok(titles[2].includes('journal'), `step 3 should be journal, got: ${titles[2]}`);
    assert.ok(titles[3].includes('ACK'), `step 4 should be ACK, got: ${titles[3]}`);
  });

  it('primary journal comes before ACK', async () => {
    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    const journalIdx = titles.findIndex(t => t.includes('journal'));
    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(journalIdx < ackIdx,
      `journal (idx ${journalIdx}) must come before ACK (idx ${ackIdx})`);
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

// ─── w:1 j:true — journal-gated ─────────────────────────────────────────────

describe('w:1 j:true — journal flush required before ACK', () => {
  it('journal flush comes before ACK', async () => {
    const m = machine(1, true);
    const titles = await runMachineToEnd(m);

    const journalIdx = titles.findIndex(t => t.includes('journal'));
    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(journalIdx >= 0, 'should have journal step');
    assert.ok(ackIdx >= 0, 'should have ACK step');
    assert.ok(journalIdx < ackIdx,
      `journal (idx ${journalIdx}) must come before ACK (idx ${ackIdx})`);
  });

  it('step sequence is: send, primaryMem, primaryJournal, ACK', async () => {
    const m = machine(1, true);
    const titles = await runMachineToEnd(m);

    assert.ok(titles[0].includes('sends'));
    assert.ok(titles[1].includes('memory'));
    assert.ok(titles[2].includes('journal'));
    assert.ok(titles[3].includes('ACK'), `step 4 should be ACK, got: ${titles[3]}`);
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

describe('w:majority j:true — identical to j:false for majority', () => {
  it('produces same step count and final state as j:false', async () => {
    const mTrue  = machine('majority', true);
    const mFalse = machine('majority', false);

    const titlesTrue  = await runMachineToEnd(mTrue);
    resetState(ctx);
    const titlesFalse = await runMachineToEnd(mFalse);

    assert.equal(titlesTrue.length, titlesFalse.length,
      'j:true and j:false should produce same number of steps for w:majority');
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
    await runMachineSteps(m, 1);
    assert.equal(s().doc.latestId, 1);

    s().nodes.primary.alive = false;

    const titles = await runMachineToEnd(m);
    assert.ok(titles.some(t => t.includes('No primary')));
    assert.equal(s().writeClient.phase, 'error');
  });

  it('rolls back latestId and versions on failure', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 1);
    assert.equal(s().doc.latestId, 1);
    assert.equal(s().doc.versions.length, 1);

    s().nodes.primary.alive = false;
    await runMachineToEnd(m);

    assert.equal(s().doc.latestId, 0, 'failed write should roll back latestId');
    assert.equal(s().doc.versions.length, 0, 'failed write should remove version entry');
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
  it('ACKs after primary journal + 1 secondary journal', async () => {
    const m = machine(2, false);
    const titles = await runMachineToEnd(m);

    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(ackIdx >= 0, 'should contain ACK step');
    // w:2 j:false: send(0) + primaryMem(1) + primaryJournal(2) + s1Mem(3) + s1Journal(4) → ACK(5)
    assert.equal(ackIdx, 5, `ACK should be at index 5, was ${ackIdx}`);
    assert.equal(s().writeClient.phase, 'received');

    const entry = s().doc.versions[0];
    assert.ok(entry.ackedBy.size >= 2, `w:2 needs >=2 acks, got ${entry.ackedBy.size}`);
    assert.ok(entry.ackedBy.has('primary'), 'primary must be among acked nodes');
  });

  it('primary journal comes before secondary replication', async () => {
    const m = machine(2, false);
    const titles = await runMachineToEnd(m);

    const priJournalIdx = titles.findIndex(t => t.includes('journal') && t.includes('Primary'));
    const secMemIdx = titles.findIndex(t => t.includes('receives') || (t.includes('memory') && !t.includes('Primary')));
    assert.ok(priJournalIdx < secMemIdx,
      `primary journal (idx ${priJournalIdx}) should come before secondary mem (idx ${secMemIdx})`);
  });
});

// ─── w:3 — needs all nodes ──────────────────────────────────────────────────

describe('w:3 j:false', () => {
  it('ACKs after all 3 nodes memory + journal', async () => {
    const m = machine(3, false);
    const titles = await runMachineToEnd(m);

    const ackIdx = titles.findIndex(t => t.includes('ACK'));
    assert.ok(ackIdx >= 0);
    // w:3 j:false: send(0) + primaryMem(1) + primaryJournal(2) + s1Mem(3) + s1Journal(4) + s2Mem(5) + s2Journal(6) → ACK(7)
    assert.equal(ackIdx, 7, `ACK should be at index 7, was ${ackIdx}`);
    const entry = s().doc.versions[0];
    assert.equal(entry.ackedBy.size, 3);
  });

  it('primary journal comes before all secondary replication', async () => {
    const m = machine(3, false);
    const titles = await runMachineToEnd(m);

    const priJournalIdx = titles.findIndex(t => t.includes('journal') && t.includes('Primary'));
    const secMemIdxs = titles.map((t, i) => (t.includes('memory') && !t.includes('Primary')) ? i : -1).filter(i => i >= 0);
    assert.ok(secMemIdxs.every(i => i > priJournalIdx),
      `all secondary mem applies should come after primary journal`);
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

// ─── primary crash at various stages ────────────────────────────────────────

describe('primary crash after memory apply (before journal)', () => {
  it('errors with "unjournaled write lost"', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 2); // send + primaryMem
    assert.equal(s().nodes.primary.memoryVersion, 1);

    // Kill primary (crashNode wipes memory)
    ctx.crashNode('primary');
    s().nodes.primary.alive = false;

    const rest = await runMachineToEnd(m);
    assert.ok(rest.some(t => t.includes('crashed')), `should report crash: ${rest.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
  });
});

describe('primary crash after journal flush (during replication)', () => {
  it('errors with "replication halted"', async () => {
    const m = machine('majority', false);
    await runMachineSteps(m, 3); // send + primaryMem + primaryJournal
    assert.equal(s().nodes.primary.journalVersion, 1);

    // Kill primary (journal survives)
    ctx.crashNode('primary');
    s().nodes.primary.alive = false;

    const rest = await runMachineToEnd(m);
    assert.ok(rest.some(t => t.includes('crashed')), `should report crash: ${rest.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
    assert.equal(s().nodes.primary.journalVersion, 1, 'journal should survive crash');
  });
});

describe('primary crash after secondary mem apply (mid-replication)', () => {
  it('errors instead of continuing to ACK', async () => {
    const m = machine('majority', false);
    await runMachineSteps(m, 4); // send + primaryMem + primaryJournal + s1Mem
    assert.equal(s().nodes.s1.memoryVersion, 1);

    // Kill primary
    ctx.crashNode('primary');
    s().nodes.primary.alive = false;

    const rest = await runMachineToEnd(m);
    assert.ok(rest.some(t => t.includes('crashed')), `should report crash: ${rest.join(' | ')}`);
    assert.ok(!rest.some(t => t.includes('ACK returned')), 'must NOT ack the client');
    assert.equal(s().writeClient.phase, 'error');
  });
});

// ─── primary bounce (kill + revive) ─────────────────────────────────────────

describe('primary bounce after ACK (w:1 j:false) — data survives', () => {
  it('data survives bounce because primary journaled before ACK', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 4); // send + primaryMem + primaryJournal + ACK
    assert.equal(s().writeClient.phase, 'received');
    assert.equal(s().nodes.primary.journalVersion, 1);

    // Bounce primary: crash wipes memory, recover restores from journal (=1)
    ctx.crashNode('primary');
    s().nodes.primary.alive = false;
    s().nodes.primary.alive = true;
    ctx.recoverNode('primary');
    assert.equal(s().nodes.primary.memoryVersion, 1, 'restored from journal');

    const rest = await runMachineToEnd(m);
    assert.ok(!rest.some(t => t.includes('lost')),
      'data should NOT be lost — journal survived');
  });
});

describe('primary bounce before ACK (w:majority j:false) — write lost', () => {
  it('fails the write with error', async () => {
    const m = machine('majority', false);
    await runMachineSteps(m, 3); // send + primaryMem + primaryJournal
    assert.equal(s().nodes.primary.journalVersion, 1);
    assert.equal(s().nodes.primary.memoryVersion, 1);

    // Bounce: crash preserves journal, recover restores from it
    ctx.crashNode('primary');
    s().nodes.primary.alive = false;
    s().nodes.primary.alive = true;
    ctx.recoverNode('primary');
    assert.equal(s().nodes.primary.memoryVersion, 1, 'journal survived, data restored');

    // Machine should continue normally since data is intact
    const rest = await runMachineToEnd(m);
    assert.ok(rest.some(t => t.includes('ACK')), 'should still ACK — data survived');
    assert.equal(s().writeClient.phase, 'received');
  });
});

describe('primary bounce before ACK (w:1 j:false, unjournaled) — write lost', () => {
  it('fails the write since data was only in memory', async () => {
    const m = machine(1, false);
    await runMachineSteps(m, 2); // send + primaryMem (no journal yet)
    assert.equal(s().nodes.primary.memoryVersion, 1);
    assert.equal(s().nodes.primary.journalVersion, 0);

    // Bounce: crash wipes memory (no journal to recover from)
    ctx.crashNode('primary');
    s().nodes.primary.alive = false;
    s().nodes.primary.alive = true;
    ctx.recoverNode('primary');
    assert.equal(s().nodes.primary.memoryVersion, 0, 'data lost — no journal backup');

    const rest = await runMachineToEnd(m);
    assert.ok(rest.some(t => t.includes('restarted') || t.includes('lost')),
      `should report data loss: ${rest.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
  });
});
