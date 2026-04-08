const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineToEnd, runMachineSteps, runSteps } = require('./helpers');

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

// ─── pre-existing topology: secondaries down before write starts ─────────────

describe('w:majority — both secondaries down before write', () => {
  it('reports write concern cannot be satisfied', async () => {
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;

    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);
    assert.ok(titles.some(t => t.includes('cannot be satisfied')),
      `expected unsatisfiable error. Steps: ${titles.join(' | ')}`);
  });

  it('sets error phases on primary and client', async () => {
    s().nodes.s1.alive = false;
    s().nodes.s2.alive = false;

    const m = machine('majority', false);
    await runMachineToEnd(m);

    assert.equal(s().nodes.primary.phase, 'error');
    assert.equal(s().writeClient.phase, 'error');
  });
});

// ─── pre-existing topology: one secondary down, retargets to other ──────────

describe('w:majority — S1 down before write, routes to S2', () => {
  it('replicates to S2 and ACKs', async () => {
    s().nodes.s1.alive = false;

    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);

    const hasS2 = titles.some(t => t.includes('Secondary 2'));
    assert.ok(hasS2, `should route to S2. Steps: ${titles.join(' | ')}`);
    assert.ok(titles.some(t => t.includes('ACK')), 'should ACK');
    assert.equal(s().doc.majorityCommitId, 1);
    assert.equal(s().writeClient.phase, 'received');
  });
});

// ─── pre-existing topology: link partitioned before write starts ─────────────

describe('w:majority — S1 link partitioned before write', () => {
  it('retargets to S2 and ACKs', async () => {
    s().links.ps1 = false;

    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);

    const hasS2 = titles.some(t => t.includes('Secondary 2'));
    assert.ok(hasS2, 'should route to S2');
    assert.ok(titles.some(t => t.includes('ACK')), 'should still ACK');
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

// ─── split-brain: writes on partitioned/stale primary ────────────────────────

describe('partitioned primary — w:1 succeeds', () => {
  it('ACKs locally when primary is alive but both links are down', async () => {
    s().links.ps1 = false;
    s().links.ps2 = false;

    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('ACK')), 'should ACK');
    assert.equal(s().writeClient.phase, 'received');
    assert.equal(s().nodes.primary.memoryVersion, 1);
  });
});

describe('partitioned primary — w:majority fails', () => {
  it('cannot achieve write concern with only 1 reachable node', async () => {
    s().links.ps1 = false;
    s().links.ps2 = false;

    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('cannot') || t.includes('Cannot')),
      `should report failure: ${titles.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
  });
});

describe('after split-brain election — writes go to new primary', () => {
  it('w:1 succeeds on new primary in majority partition', async () => {
    s().links.ps1 = false;
    s().links.ps2 = false;
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));

    assert.notEqual(s().primaryKey, 'primary', 'new primary should be a secondary');

    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('ACK')), 'should ACK on new primary');
    assert.equal(s().writeClient.phase, 'received');
  });

  it('w:majority succeeds on new primary with majority partition', async () => {
    s().links.ps1 = false;
    s().links.ps2 = false;
    await runSteps(ctx.buildElectionSteps({ forcePartition: true }));

    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('ACK')),
      `should succeed with majority: ${titles.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'received');
  });
});

// ─── client targeting: write to secondary fails ──────────────────────────────

describe('client targeting — write to secondary', () => {
  it('rejects w:1 when writer targets a secondary', async () => {
    s().writeClient.targetNode = 's1';

    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('Not primary') || t.includes('not primary')),
      `should report not-primary error: ${titles.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
  });

  it('rejects w:majority when writer targets a secondary', async () => {
    s().writeClient.targetNode = 's2';

    const m = machine('majority', false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('Not primary') || t.includes('not primary')),
      `should report not-primary error: ${titles.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
  });

  it('succeeds when writer targets the actual primary', async () => {
    s().writeClient.targetNode = 'primary';

    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('ACK')), 'should ACK');
    assert.equal(s().writeClient.phase, 'received');
  });

  it('rejects write when targeted primary-slot node is down', async () => {
    // Target the primary slot, but kill it first
    s().writeClient.targetNode = 'primary';
    s().nodes.primary.alive = false;

    const m = machine(1, false);
    const titles = await runMachineToEnd(m);

    assert.ok(titles.some(t => t.includes('down') || t.includes('Down')),
      `should report node-down error: ${titles.join(' | ')}`);
    assert.equal(s().writeClient.phase, 'error');
  });
});
