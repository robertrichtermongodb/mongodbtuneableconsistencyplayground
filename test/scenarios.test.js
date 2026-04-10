const { describe, it, beforeEach } = require('node:test');
const { createContext, resetState, runMachineSteps, idleAllPhases } = require('./helpers');
const {
  applyScenario, performWrite, performRead,
  performSnapshotStart, performSnapshotRead, endSnapshotSession,
  performElection, crashNodeByKey, resetEngines,
  assertWriteOutcome, assertReadResult, assertReadError, assertPrimaryIs, assertNodeVersion,
} = require('./scenario-helpers');

// All 7 scenarios from TEXTS.scenarios, exercised as multi-operation integration tests.
// Each test mirrors the user-facing "next steps" instructions in the scenario card.

describe('scenarios', () => {
  let ctx;
  const findScenario = (id) => ctx.$TEXTS.scenarios.find(s => s.id === id);

  beforeEach(() => {
    ctx = createContext({ scenarioMode: true });
    resetState(ctx);
  });

  function resetBetweenOps() {
    resetEngines(ctx);
    idleAllPhases(ctx);
    ctx.state.particles = [];
  }

  // ── Consistent by default ──────────────────────────────────────────

  describe('safe-write: primary crashes after a safe write', () => {
    it('data survives crash + election because w:majority replicated first', async () => {
      applyScenario(ctx, findScenario('safe-write'));
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);
      assertNodeVersion(ctx, 's1', 1, 1);

      resetBetweenOps();
      crashNodeByKey(ctx, 'primary');

      await performElection(ctx);
      assertPrimaryIs(ctx, 's1');

      resetBetweenOps();
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 1, false);
    });
  });

  describe('partition-safe: write blocked, consistency preserved', () => {
    it('w:majority rejects the write under full primary partition', async () => {
      applyScenario(ctx, findScenario('partition-safe'));
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'error');
      // No data should have been committed
      assert_noCommittedData(ctx);
    });
  });

  describe('snapshot-isolation: repeatable reads', () => {
    it('session read returns pre-write data, post-session read sees new data', async () => {
      applyScenario(ctx, findScenario('snapshot-isolation'));

      // Session starts with no committed data
      await performSnapshotStart(ctx);
      const snapVersion = ctx.state.readClient.lastReceivedVersion;

      // Write a new document while session is active
      resetBetweenOps();
      ctx.setSelectedWriteConcern('majority');
      ctx.setSelectedJournal('false');
      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);

      // Read again within session — still sees pre-write state
      resetBetweenOps();
      ctx.state.readClient.lastReceivedVersion = null;
      await performSnapshotRead(ctx);
      assertReadResult(ctx, snapVersion ? snapVersion.id : 0, false);

      // End session, read again — now sees v1
      endSnapshotSession(ctx);
      resetBetweenOps();
      ctx.setSelectedReadConcern('majority');
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 1, false);
    });
  });

  describe('linearizable: read blocked under partition', () => {
    it('rc:linearizable fails when primary cannot confirm leadership', async () => {
      applyScenario(ctx, findScenario('linearizable'));
      await performRead(ctx);
      assertReadError(ctx, 'linearizable');
    });
  });

  // ── Trading safety for speed ───────────────────────────────────────

  describe('w1-data-loss: fast confirmation, data at risk', () => {
    it('w:1 write on isolated primary is lost after election', async () => {
      applyScenario(ctx, findScenario('w1-data-loss'));

      await performWrite(ctx);
      assertWriteOutcome(ctx, 'received', 1);
      // Data is only on the isolated primary — secondaries have nothing
      assertNodeVersion(ctx, 's1', 0, 0);
      assertNodeVersion(ctx, 's2', 0, 0);

      resetBetweenOps();
      await performElection(ctx, { forcePartition: true });
      // Secondaries elected a new primary; old primary's data is rolled back
      const newPrimary = ctx.state.primaryKey;
      assertNodeVersion(ctx, newPrimary, 0, 0);

      resetBetweenOps();
      ctx.state.readClient.lastReceivedVersion = null;
      await performRead(ctx);
      assertReadResult(ctx, 0);
    });
  });

  describe('dirty-read: rc:local stale data possible', () => {
    it('secondary returns uncommitted data before majority confirms', async () => {
      applyScenario(ctx, findScenario('dirty-read'));

      // Partially execute w:1 write — stop after ACK (4 steps: send, mem, journal, ack)
      const machine = ctx.createWriteMachine(1, false);
      await runMachineSteps(machine, 4);
      // Simulate replication to a secondary's memory without majority commit.
      // resolveReadTarget('local', 'secondary') picks s2, so that's where we
      // place the unreplicated data.
      ctx.state.nodes.s2.memoryVersion = 1;
      idleAllPhases(ctx);

      ctx.state.readClient.lastReceivedVersion = null;
      const readSteps = ctx.buildReadSteps('local', 'secondary');
      for (const step of readSteps) await step.run();
      assertReadResult(ctx, 1, true);
    });
  });

  describe('fire-forget: w:0 maximum throughput', () => {
    it('client returns immediately with no acknowledgment', async () => {
      applyScenario(ctx, findScenario('fire-forget'));
      await performWrite(ctx);
      // w:0 means write is fire-and-forget — client goes idle, data is stored
      assertWriteOutcome(ctx, 'idle', 1);
    });
  });
});

// ── Private helpers ──────────────────────────────────────────────────

function assert_noCommittedData(ctx) {
  const assert = require('node:assert/strict');
  assert.equal(ctx.state.doc.majorityCommitId, 0,
    `majorityCommitId should be 0, got ${ctx.state.doc.majorityCommitId}`);
}
