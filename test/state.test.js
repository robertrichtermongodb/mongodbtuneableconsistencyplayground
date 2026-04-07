const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState } = require('./helpers');

const ctx = createContext();

beforeEach(() => resetState(ctx));

// ─── journalFlush ───────────────────────────────────────────────────────────

describe('journalFlush', () => {
  it('copies memoryVersion to journalVersion', () => {
    ctx.state.nodes.primary.memoryVersion = 3;
    ctx.journalFlush('primary');
    assert.equal(ctx.state.nodes.primary.journalVersion, 3);
  });

  it('is idempotent when already flushed', () => {
    ctx.state.nodes.s1.memoryVersion = 2;
    ctx.state.nodes.s1.journalVersion = 2;
    ctx.journalFlush('s1');
    assert.equal(ctx.state.nodes.s1.journalVersion, 2);
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

  it('is a no-op when journal is empty', () => {
    ctx.state.nodes.s2.memoryVersion = 0;
    ctx.state.nodes.s2.journalVersion = 0;
    ctx.recoverNode('s2');
    assert.equal(ctx.state.nodes.s2.memoryVersion, 0);
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
  it('primary is reachable when alive', () => {
    assert.equal(ctx.isReachableForWrite('primary'), true);
  });

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

  it('secondary reachable when alive and link up', () => {
    assert.equal(ctx.isReachableForWrite('s1'), true);
  });
});
