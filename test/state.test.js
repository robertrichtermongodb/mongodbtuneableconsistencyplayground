const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineToEnd, runMachineSteps, runSteps, idleAllPhases } = require('./helpers');

const ctx = createContext();

beforeEach(() => resetState(ctx));

// ─── journalFlush ───────────────────────────────────────────────────────────

describe('journalFlush', () => {
  it('copies memoryVersion to journalVersion', () => {
    ctx.state.nodes.primary.memoryVersion = 3;
    ctx.journalFlush('primary');
    assert.equal(ctx.state.nodes.primary.journalVersion, 3);
  });
});

// ─── crashNode ──────────────────────────────────────────────────────────────

describe('crashNode', () => {
  it('wipes memoryVersion to 0', () => {
    ctx.state.nodes.s1.memoryVersion = 5;
    ctx.state.nodes.s1.journalVersion = 3;
    ctx.crashNode('s1');
    assert.equal(ctx.state.nodes.s1.memoryVersion, 0);
  });

  it('preserves journalVersion', () => {
    ctx.state.nodes.s1.memoryVersion = 5;
    ctx.state.nodes.s1.journalVersion = 3;
    ctx.crashNode('s1');
    assert.equal(ctx.state.nodes.s1.journalVersion, 3);
  });

  it('retracts acks above journalVersion', () => {
    const entry = { id: 2, op: 'update', ackedBy: new Set(['primary', 's1']) };
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's1', 's2']) },
      entry,
    ];
    ctx.state.doc.latestId = 2;
    ctx.state.doc.majorityCommitId = 2;
    ctx.state.nodes.s1.memoryVersion = 2;
    ctx.state.nodes.s1.journalVersion = 1;

    ctx.crashNode('s1');

    assert.ok(!entry.ackedBy.has('s1'), 'ack for v2 should be retracted');
    assert.equal(entry.ackedBy.size, 1);
  });

  it('recomputes majorityCommitId after retraction', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's1']) },
      { id: 2, op: 'update', ackedBy: new Set(['primary', 's1']) },
    ];
    ctx.state.doc.latestId = 2;
    ctx.state.doc.majorityCommitId = 2;
    ctx.state.nodes.s1.memoryVersion = 2;
    ctx.state.nodes.s1.journalVersion = 0;

    ctx.crashNode('s1');

    assert.equal(ctx.state.doc.majorityCommitId, 0,
      'no version should have majority after s1 acks retracted');
  });

  it('does nothing extra when memoryVersion <= journalVersion', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's1']) },
    ];
    ctx.state.doc.majorityCommitId = 1;
    ctx.state.nodes.s1.memoryVersion = 1;
    ctx.state.nodes.s1.journalVersion = 1;

    ctx.crashNode('s1');

    assert.equal(ctx.state.doc.majorityCommitId, 1, 'majorityCommit unchanged');
    assert.ok(ctx.state.doc.versions[0].ackedBy.has('s1'), 'journaled ack preserved');
  });
});

// ─── recoverNode ────────────────────────────────────────────────────────────

describe('recoverNode', () => {
  it('restores memoryVersion from journalVersion', () => {
    ctx.state.nodes.s2.memoryVersion = 0;
    ctx.state.nodes.s2.journalVersion = 4;
    ctx.recoverNode('s2');
    assert.equal(ctx.state.nodes.s2.memoryVersion, 4);
  });
});

// ─── advanceMajorityCommit ──────────────────────────────────────────────────

describe('advanceMajorityCommit', () => {
  it('advances when a version reaches 2 acks', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's1']) },
    ];
    ctx.state.doc.majorityCommitId = 0;
    ctx.advanceMajorityCommit();
    assert.equal(ctx.state.doc.majorityCommitId, 1);
  });

  it('finds highest version with majority', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's1']) },
      { id: 2, op: 'update', ackedBy: new Set(['primary', 's1', 's2']) },
    ];
    ctx.state.doc.majorityCommitId = 0;
    ctx.advanceMajorityCommit();
    assert.equal(ctx.state.doc.majorityCommitId, 2);
  });

  it('does not advance if only 1 ack', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary']) },
    ];
    ctx.state.doc.majorityCommitId = 0;
    ctx.advanceMajorityCommit();
    assert.equal(ctx.state.doc.majorityCommitId, 0);
  });
});

// ─── recomputeMajorityCommit ────────────────────────────────────────────────

describe('recomputeMajorityCommit', () => {
  it('resets to 0 when no version has majority', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary']) },
    ];
    ctx.state.doc.majorityCommitId = 1;
    ctx.recomputeMajorityCommit();
    assert.equal(ctx.state.doc.majorityCommitId, 0);
  });

  it('finds correct commit point after partial retraction', () => {
    ctx.state.doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's1']) },
      { id: 2, op: 'update', ackedBy: new Set(['primary']) },
    ];
    ctx.state.doc.majorityCommitId = 2;
    ctx.recomputeMajorityCommit();
    assert.equal(ctx.state.doc.majorityCommitId, 1);
  });
});

// ─── resolveReadTarget ──────────────────────────────────────────────────────

describe('resolveReadTarget', () => {
  it('linearizable always returns primary key', () => {
    assert.equal(ctx.resolveReadTarget('linearizable', 'secondary'), 'primary');
  });

  it('primary preference returns null when primary dead', () => {
    ctx.state.nodes.primary.alive = false;
    assert.equal(ctx.resolveReadTarget('local', 'primary'), null);
  });

  it('primaryPreferred falls back to secondary', () => {
    ctx.state.nodes.primary.alive = false;
    const result = ctx.resolveReadTarget('local', 'primaryPreferred');
    assert.ok(result === 's1' || result === 's2');
  });

  it('secondary preference returns a secondary', () => {
    const result = ctx.resolveReadTarget('local', 'secondary');
    assert.ok(result === 's1' || result === 's2');
  });

  it('secondaryPreferred falls back to primary when all secs dead', () => {
    ctx.state.nodes.s1.alive = false;
    ctx.state.nodes.s2.alive = false;
    assert.equal(ctx.resolveReadTarget('local', 'secondaryPreferred'), 'primary');
  });
});

// ─── getServedVersion ───────────────────────────────────────────────────────

describe('getServedVersion', () => {
  it('rc:local returns memoryVersion', () => {
    ctx.state.nodes.s1.memoryVersion = 3;
    const v = ctx.getServedVersion('s1', 'local');
    assert.equal(v.id, 3);
  });

  it('rc:local flags dirty when above majorityCommitId', () => {
    ctx.state.nodes.s1.memoryVersion = 3;
    ctx.state.doc.majorityCommitId = 1;
    const v = ctx.getServedVersion('s1', 'local');
    assert.equal(v.dirty, true);
  });

  it('rc:majority returns majorityCommitId', () => {
    ctx.state.doc.majorityCommitId = 2;
    ctx.state.nodes.primary.memoryVersion = 5;
    const v = ctx.getServedVersion('primary', 'majority');
    assert.equal(v.id, 2);
    assert.equal(v.dirty, false);
  });
});

// ─── isReachableForWrite ────────────────────────────────────────────────────

describe('isReachableForWrite', () => {
  it('primary is unreachable when dead', () => {
    ctx.state.nodes.primary.alive = false;
    assert.equal(ctx.isReachableForWrite('primary'), false);
  });

  it('secondary unreachable when link is down', () => {
    ctx.state.links.ps1 = false;
    assert.equal(ctx.isReachableForWrite('s1'), false);
  });

  it('secondary unreachable when dead', () => {
    ctx.state.nodes.s1.alive = false;
    assert.equal(ctx.isReachableForWrite('s1'), false);
  });

  it('becomes reachable again when link restored', () => {
    ctx.state.links.ps1 = false;
    assert.equal(ctx.isReachableForWrite('s1'), false);
    ctx.state.links.ps1 = true;
    assert.equal(ctx.isReachableForWrite('s1'), true);
  });
});

// ─── getLinkBetween (s1↔s2) ─────────────────────────────────────────────────

describe('getLinkBetween — s1↔s2 link', () => {
  it('returns s1s2 for s1,s2', () => {
    assert.equal(ctx.getLinkBetween('s1', 's2'), 's1s2');
  });

  it('returns s1s2 for s2,s1 (symmetric)', () => {
    assert.equal(ctx.getLinkBetween('s2', 's1'), 's1s2');
  });

  it('s1s2 link exists in state.links and defaults to true', () => {
    assert.equal(ctx.state.links.s1s2, true);
  });
});

// ─── getPartition ───────────────────────────────────────────────────────────

describe('getPartition', () => {
  it('returns all 3 nodes when all links are up', () => {
    const p = ctx.getPartition('s1');
    assert.deepEqual(p, new Set(['primary', 's1', 's2']));
  });

  it('returns {s1, s2} when primary is partitioned', () => {
    ctx.state.links.ps1 = false;
    ctx.state.links.ps2 = false;
    const p = ctx.getPartition('s1');
    assert.deepEqual(p, new Set(['s1', 's2']));
  });

  it('returns {primary} when primary is partitioned', () => {
    ctx.state.links.ps1 = false;
    ctx.state.links.ps2 = false;
    const p = ctx.getPartition('primary');
    assert.deepEqual(p, new Set(['primary']));
  });

  it('excludes dead nodes', () => {
    ctx.state.nodes.s2.alive = false;
    ctx.state.links.ps1 = false;
    ctx.state.links.ps2 = false;
    const p = ctx.getPartition('s1');
    assert.deepEqual(p, new Set(['s1']));
  });

  it('returns {primary, s1} when only ps2 and s1s2 are down', () => {
    ctx.state.links.ps2 = false;
    ctx.state.links.s1s2 = false;
    const p = ctx.getPartition('primary');
    assert.deepEqual(p, new Set(['primary', 's1']));
  });
});

// ─── isPrimaryPartitioned ───────────────────────────────────────────────────

describe('isPrimaryPartitioned', () => {
  it('true when primary is alive but isolated from both secondaries', () => {
    ctx.state.links.ps1 = false;
    ctx.state.links.ps2 = false;
    assert.equal(ctx.isPrimaryPartitioned(), true);
  });

  it('false when any primary-to-secondary link is up', () => {
    ctx.state.links.ps1 = false;
    // ps2 still up
    assert.equal(ctx.isPrimaryPartitioned(), false);
  });

  it('false when primary is dead (not partitioned, just down)', () => {
    ctx.state.nodes.primary.alive = false;
    ctx.state.links.ps1 = false;
    ctx.state.links.ps2 = false;
    assert.equal(ctx.isPrimaryPartitioned(), false);
  });
});

// ─── effectiveWriteTarget ───────────────────────────────────────────────────

describe('effectiveWriteTarget', () => {
  it('returns primaryKey by default', () => {
    assert.equal(ctx.effectiveWriteTarget(), 'primary');
  });

  it('follows primaryKey after election', () => {
    ctx.state.primaryKey = 's1';
    assert.equal(ctx.effectiveWriteTarget(), 's1');
  });

  it('returns writeClient.targetNode when set', () => {
    ctx.state.writeClient.targetNode = 's2';
    assert.equal(ctx.effectiveWriteTarget(), 's2');
  });

  it('overrides primaryKey when targetNode is set', () => {
    ctx.state.primaryKey = 's1';
    ctx.state.writeClient.targetNode = 'primary';
    assert.equal(ctx.effectiveWriteTarget(), 'primary');
  });
});

// ─── resolveReadTarget with manual targeting ────────────────────────────────

describe('resolveReadTarget — manual targeting', () => {
  it('returns targetNode when set, ignoring readPreference', () => {
    ctx.state.readClient.targetNode = 's1';
    assert.equal(ctx.resolveReadTarget('local', 'primary'), 's1');
  });

  it('returns targetNode even for linearizable', () => {
    ctx.state.readClient.targetNode = 's2';
    assert.equal(ctx.resolveReadTarget('linearizable', 'primary'), 's2');
  });

  it('falls back to normal logic when targetNode is null', () => {
    ctx.state.readClient.targetNode = null;
    assert.equal(ctx.resolveReadTarget('local', 'primary'), 'primary');
  });
});

// ─── isNodeIsolated ─────────────────────────────────────────────────────────

describe('isNodeIsolated', () => {
  it('returns false for the primary', () => {
    assert.equal(ctx.isNodeIsolated('primary'), false);
  });

  it('returns false for a secondary connected to primary', () => {
    assert.equal(ctx.isNodeIsolated('s1'), false);
  });

  it('returns true for a secondary with all links to primary down', () => {
    ctx.state.links.ps1 = false;
    ctx.state.links.s1s2 = false;
    assert.equal(ctx.isNodeIsolated('s1'), true);
  });

  it('returns false for dead nodes', () => {
    ctx.state.nodes.s1.alive = false;
    ctx.state.links.ps1 = false;
    assert.equal(ctx.isNodeIsolated('s1'), false);
  });

  it('isolated when direct link to primary is cut even if s1s2 heartbeat is up', () => {
    // s1 has no direct link to primary — s1s2 is heartbeat-only, no chained replication
    ctx.state.links.ps1 = false;
    assert.equal(ctx.isNodeIsolated('s1'), true);
  });

  it('isolated when ps2 cut even though s2 could reach primary via s1 (no chained replication)', () => {
    // Old (wrong) behavior was false — transitive BFS through s1s2 found a path.
    // Correct behavior: no direct link to primary → isolated.
    ctx.state.links.ps2 = false;
    assert.equal(ctx.isNodeIsolated('s2'), true);
  });

  it('detects isolation when both primary links are down', () => {
    ctx.state.links.ps1 = false;
    ctx.state.links.ps2 = false;
    // Both secondaries are isolated from primary
    assert.equal(ctx.isNodeIsolated('s1'), true);
    assert.equal(ctx.isNodeIsolated('s2'), true);
  });
});

// ─── syncRejoiningNode — oplog catch-up on rejoin ───────────────────────────

function machine(w, j) { return ctx.createWriteMachine(w, j); }
const s = () => ctx.state;

describe('syncRejoiningNode — catches up a node that missed writes while down', () => {
  it('syncs S2 to majorityCommitId after revival', async () => {
    s().nodes.s2.alive = false;
    ctx.crashNode('s2');

    await runMachineToEnd(machine('majority', false));
    assert.equal(s().doc.majorityCommitId, 1);
    assert.equal(s().nodes.s2.memoryVersion, 0);
    assert.equal(s().nodes.s2.journalVersion, 0);

    s().nodes.s2.alive = true;
    ctx.recoverNode('s2');
    const synced = ctx.syncRejoiningNode('s2');

    assert.equal(synced, true);
    assert.equal(s().nodes.s2.memoryVersion, 1);
    assert.equal(s().nodes.s2.journalVersion, 1);
    const v1 = s().doc.versions.find(v => v.id === 1);
    assert.ok(v1.ackedBy.has('s2'), 's2 should be in ack set after catch-up');
  });

  it('catches up to primary level even when majorityCommitId is 0 (w:0 scenario)', async () => {
    s().nodes.s1.alive = false;
    ctx.crashNode('s1');
    s().nodes.s2.alive = false;
    ctx.crashNode('s2');

    await runMachineToEnd(machine(0, false));
    assert.equal(s().nodes.primary.memoryVersion, 1);
    assert.equal(s().doc.majorityCommitId, 0, 'w:0 with no secondaries cannot majority-commit');

    s().nodes.s1.alive = true;
    ctx.recoverNode('s1');
    const synced = ctx.syncRejoiningNode('s1');

    assert.equal(synced, true);
    assert.equal(s().nodes.s1.memoryVersion, 1, 'should catch up to primary level');
    assert.equal(s().nodes.s1.journalVersion, 1);
    assert.equal(s().doc.majorityCommitId, 1, 'should advance majorityCommit now that 2 nodes have v1');
  });

  it('does not sync when primary is dead', () => {
    s().nodes.primary.alive = false;
    const synced = ctx.syncRejoiningNode('s1');
    assert.equal(synced, false);
  });

  it('does not sync a node still isolated from primary (link down)', async () => {
    s().links.ps2 = false;
    await runMachineToEnd(machine('majority', false));
    assert.equal(s().doc.majorityCommitId, 1);

    const synced = ctx.syncRejoiningNode('s2');
    assert.equal(synced, false);
    assert.equal(s().nodes.s2.memoryVersion, 0, 'isolated node should not sync');
  });

  it('caps down a node with stale data beyond primary level', () => {
    s().nodes.primary.memoryVersion = 1;
    s().nodes.primary.journalVersion = 1;
    s().nodes.s1.memoryVersion = 3;
    s().nodes.s1.journalVersion = 3;
    s().doc.majorityCommitId = 1;
    s().doc.versions = [
      { id: 1, op: 'insert', ackedBy: new Set(['primary', 's2']) },
    ];

    const synced = ctx.syncRejoiningNode('s1');
    assert.equal(synced, true);
    assert.equal(s().nodes.s1.memoryVersion, 1, 'should cap down to primary level');
    assert.equal(s().nodes.s1.journalVersion, 1);
  });

  it('is idempotent — second call is a no-op', async () => {
    s().nodes.s2.alive = false;
    ctx.crashNode('s2');
    await runMachineToEnd(machine('majority', false));
    s().nodes.s2.alive = true;
    ctx.recoverNode('s2');

    ctx.syncRejoiningNode('s2');
    const mem1 = s().nodes.s2.memoryVersion;
    const jrn1 = s().nodes.s2.journalVersion;
    ctx.syncRejoiningNode('s2');
    assert.equal(s().nodes.s2.memoryVersion, mem1);
    assert.equal(s().nodes.s2.journalVersion, jrn1);
  });

  it('does not sync the current primary to itself', () => {
    s().nodes.primary.memoryVersion = 5;
    s().doc.majorityCommitId = 3;
    const synced = ctx.syncRejoiningNode('primary');
    assert.equal(synced, false);
    assert.equal(s().nodes.primary.memoryVersion, 5, 'primary unchanged');
  });

  it('syncs old primary after election (now a secondary)', async () => {
    await runMachineToEnd(machine('majority', false));
    assert.equal(s().doc.majorityCommitId, 1);

    s().nodes.primary.alive = false;
    ctx.crashNode('primary');
    idleAllPhases(ctx);
    await runSteps(ctx.buildElectionSteps());
    assert.notEqual(s().primaryKey, 'primary');

    s().nodes.primary.alive = true;
    ctx.recoverNode('primary');

    const synced = ctx.syncRejoiningNode('primary');
    assert.equal(synced, true);
    assert.equal(s().nodes.primary.memoryVersion, s().doc.majorityCommitId);
    assert.equal(s().nodes.primary.journalVersion, s().doc.majorityCommitId);
  });
});
