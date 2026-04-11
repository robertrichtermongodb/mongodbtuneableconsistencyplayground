const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createContext, resetState, runMachineSteps, idleAllPhases, partitionPrimary } = require('./helpers');
const {
  performWrite, performRead, performElection,
  crashNodeByKey, recoverNodeByKey, healPartition, resetEngines,
  assertWriteOutcome, assertReadResult, assertNodeVersion, assertPrimaryIs,
} = require('./scenario-helpers');

// Integration tests for multi-operation flows from the test-gap backlog.
// These exercise real engine pipelines via scenario-mode context.

describe('multi-operation flows', () => {
  let ctx;

  beforeEach(() => {
    ctx = createContext({ scenarioMode: true });
    resetState(ctx);
    ctx.setSelectedWriteConcern('majority');
    ctx.setSelectedJournal('false');
    ctx.setSelectedReadConcern('majority');
    ctx.setSelectedReadPref('primary');
  });

  function resetBetweenOps() {
    resetEngines(ctx);
    idleAllPhases(ctx);
    ctx.state.particles = [];
  }

  // ── Backlog #2: Read-after-write consistency ─────────────────────

  describe('read-after-write consistency', () => {
    it('rc:local from secondary returns stale data during w:majority write', async () => {
      // Partially write w:majority — stop after primary journal (3 steps)
      // so secondaries haven't replicated yet
      const machine = ctx.createWriteMachine('majority', false);
      await runMachineSteps(machine, 3);
      idleAllPhases(ctx);

      // Read from secondary with rc:local — should get v0 (stale)
      ctx.state.readClient.lastReceivedVersion = null;
      const readSteps = ctx.buildReadSteps('local', 'secondary');
      for (const step of readSteps) await step.run();
      assertReadResult(ctx, 0);
    });

    it('rc:majority from primary returns v1 after w:majority completes', async () => {
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      resetBetweenOps();
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 1, false);
    });
  });

  // ── Backlog #3: Double election ──────────────────────────────────

  describe('double election', () => {
    it('elects twice with correct label cycling and no stale data', async () => {
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      // First election: crash primary, elect from secondaries
      resetBetweenOps();
      crashNodeByKey(ctx, 'primary');
      await performElection(ctx);
      const firstNewPrimary = ctx.state.primaryKey;
      assert.notEqual(firstNewPrimary, 'primary', 'new primary should not be the crashed node');
      assertNodeVersion(ctx, firstNewPrimary, 1, 1);

      // Recover the old primary so we have quorum for a second election
      resetBetweenOps();
      recoverNodeByKey(ctx, 'primary');
      crashNodeByKey(ctx, firstNewPrimary);
      await performElection(ctx);

      // The remaining alive secondary (or recovered old primary) becomes primary
      assert.notEqual(ctx.state.primaryKey, firstNewPrimary,
        'crashed node should not be primary');
      assertNodeVersion(ctx, ctx.state.primaryKey, 1, 1);

      // Read confirms data survived two elections
      resetBetweenOps();
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 1, false);
    });

    it('rolled-back data does not reappear after second election', async () => {
      // Write with w:1 on an isolated primary — data will be rolled back
      ctx.setSelectedWriteConcern('1');
      partitionPrimary(ctx);
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      // Force election — secondaries become new primary, data rolled back
      resetBetweenOps();
      await performElection(ctx, { forcePartition: true });
      const firstNewPrimary = ctx.state.primaryKey;

      // Crash the new primary, elect the other secondary
      resetBetweenOps();
      healPartition(ctx);
      crashNodeByKey(ctx, firstNewPrimary);
      await performElection(ctx);

      // The rolled-back data should not exist on any surviving node
      const finalPrimary = ctx.state.primaryKey;
      assertNodeVersion(ctx, finalPrimary, 0, 0);
    });
  });

  // ── Backlog #5: Partition reconciliation ─────────────────────────

  describe('partition reconciliation', () => {
    it('isolated nodes sync to majority-committed state after partition heals', async () => {
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      // Partition: isolate primary
      resetBetweenOps();
      partitionPrimary(ctx);

      // Force election — secondaries elect new primary
      await performElection(ctx, { forcePartition: true });
      const newPrimary = ctx.state.primaryKey;
      assert.notEqual(newPrimary, 'primary');

      // Heal partition — old primary should sync to majority-committed state
      resetBetweenOps();
      healPartition(ctx);

      // All alive nodes should agree on the committed version
      const committedId = ctx.state.doc.majorityCommitId;
      for (const [k, node] of Object.entries(ctx.state.nodes)) {
        if (!node.alive) continue;
        assert.ok(node.memoryVersion <= committedId,
          `${node.label} memoryVersion ${node.memoryVersion} should be <= committedId ${committedId}`);
      }

      // Read from new primary confirms consistent state
      resetBetweenOps();
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, committedId, false);
    });
  });

  // ── Backlog #4: Client targeting + reads ─────────────────────────

  describe('client targeting', () => {
    it('manual read target overrides readPreference', async () => {
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      resetBetweenOps();
      ctx.state.readClient.targetNode = 's1';
      ctx.setSelectedReadPref('primary');
      ctx.setSelectedReadConcern('local');
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 1, false);
    });

    it('manual read target to dead node returns no data', async () => {
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      resetBetweenOps();
      ctx.state.readClient.targetNode = 's2';
      ctx.state.nodes.s2.alive = false;
      ctx.setSelectedReadConcern('local');
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assert.equal(ctx.state.readClient.phase, 'error',
        'reading from dead target should error');
    });

    it('read from isolated secondary returns stale but valid data', async () => {
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      resetBetweenOps();
      ctx.state.links.ps2 = false;
      ctx.state.readClient.targetNode = 's2';
      ctx.setSelectedReadConcern('local');
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 1, false);
    });

    it('manual write target overrides primaryKey', () => {
      assert.equal(ctx.effectiveWriteTarget(), 'primary');
      ctx.state.writeClient.targetNode = 's1';
      assert.equal(ctx.effectiveWriteTarget(), 's1');
    });
  });

  // ── Backlog #7: cycleClientTarget cycling ───────────────────────

  describe('cycleClientTarget logic', () => {
    function cycleTarget(client) {
      const nodeKeys = [null, ...Object.keys(ctx.state.nodes)];
      const current = client.targetNode;
      const idx = nodeKeys.indexOf(current);
      client.targetNode = nodeKeys[(idx + 1) % nodeKeys.length];
      return client.targetNode;
    }

    it('write client cycles through null → primary → s1 → s2 → null', () => {
      const wc = ctx.state.writeClient;
      assert.equal(wc.targetNode, null);
      assert.equal(cycleTarget(wc), 'primary');
      assert.equal(cycleTarget(wc), 's1');
      assert.equal(cycleTarget(wc), 's2');
      assert.equal(cycleTarget(wc), null);
    });

    it('read client cycles through the same sequence', () => {
      const rc = ctx.state.readClient;
      assert.equal(rc.targetNode, null);
      assert.equal(cycleTarget(rc), 'primary');
      assert.equal(cycleTarget(rc), 's1');
      assert.equal(cycleTarget(rc), 's2');
      assert.equal(cycleTarget(rc), null);
    });

    it('cycling still works after election changes primaryKey', async () => {
      crashNodeByKey(ctx, 'primary');
      await performElection(ctx);
      const newPK = ctx.state.primaryKey;
      assert.notEqual(newPK, 'primary');

      const rc = ctx.state.readClient;
      rc.targetNode = null;
      const first = cycleTarget(rc);
      assert.equal(first, 'primary', 'node key is still "primary" even after election');
      const second = cycleTarget(rc);
      assert.equal(second, 's1');
    });
  });

  // ── Engine mutual exclusion ──────────────────────────────────────

  describe('engine guards', () => {
    it('isEngineActive reflects running state', async () => {
      assert.equal(ctx.$isEngineActive(ctx.$writeEngine), false, 'idle write engine');
      assert.equal(ctx.$isEngineActive(ctx.$readEngine), false, 'idle read engine');
      assert.equal(ctx.$isAnyEngineActive(), false, 'no engine active');
    });

    it('engine is not active after completed operation', async () => {
      await performWrite(ctx);
      assert.equal(ctx.$writeEngine.done, true, 'write engine should be done');
      assert.equal(ctx.$isEngineActive(ctx.$writeEngine), false, 'done engine is not active');
    });

    it('topology is locked during active snapshot session', () => {
      ctx.state.readClient.sessionActive = true;
      assert.equal(ctx.$isTopologyLocked(), true);
      ctx.state.readClient.sessionActive = false;
      assert.equal(ctx.$isTopologyLocked(), false);
    });
  });
});
