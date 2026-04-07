# Primary Bounce & Rollback Risk Visibility

**ID:** 13
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Fixed a bug where killing a primary and bringing it back during an active write allowed replication to continue with data the primary no longer had. Generalized the state machine's invariant from "primary is alive" to "primary is alive AND still holds the write data." Additionally, added explicit "Acknowledged but LOST" indicators in both the consistency view and the canvas doc ledger — making the rollback risk of low write concerns visually unmistakable.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Added `primaryHasData()` and `primaryCanServe()` checks. Renamed `primaryDeadStep()` → `primaryUnavailableStep()` to handle both dead and bounced cases. Added `endAsyncWork()` for clean post-ACK termination (no rollback, no client error). Split `guardRun` into `guardRun` (full data check) and `guardRunAlive` (liveness only, for primaryMem step). Universal guard now checks data integrity from `primaryJournal`/`repl` phases onward. |
| `js/draw.js` | Added "Acknowledged but LOST" state to `updateConsistencyViews()` — detected when `writeClient.phase === 'received'` but `ackCount === 0` and not committed. Canvas doc ledger now shows "LOST" label in red with red border instead of amber "in-flight" when data is gone from all nodes. |
| `test/machine.test.js` | Added 3 new bounce test suites covering: post-ACK bounce (async work aborted), pre-ACK bounce with journal (data survives), pre-ACK bounce without journal (write lost). |

### Key Decisions

- **Two-tier guard**: `primaryMem` step only checks liveness (data hasn't been applied yet), while all subsequent steps check full data integrity. This prevents false-positive invariant failures during normal flow.
- **Post-ACK termination uses `endAsyncWork`**: When the client already received the ACK, `failWrite` (which rolls back version and sets client to error) is wrong. Instead, `endAsyncWork` cleanly terminates the machine and resets node phases without disturbing the client.
- **Bounce with journaled data continues normally**: If the primary bounced but the write was already journaled, `recoverNode` restores `memoryVersion` from `journalVersion`. The machine detects the data is intact and proceeds.
- **"Ack but lost" detection**: Uses `writeClient.phase === 'received' && ackCount === 0 && !committed` — captures exactly when the client believes the write succeeded but no node holds the data.

## Tests

- **Before:** 82 tests across 37 suites
- **After:** 85 tests across 40 suites
- **New tests:**
  - `primary bounce after ACK (w:1 j:false)` — data lost, async work aborted, client keeps 'received'
  - `primary bounce before ACK (w:majority j:false)` — journal survived, data restored, write succeeds
  - `primary bounce before ACK (w:1 j:false, unjournaled)` — data lost, write fails with error

## Notes

- The invariant `primaryCanServe() = primaryAlive() && memoryVersion >= nextId` is the single source of truth for "can this write continue?"
- Five state machine gaps were identified and fixed:
  1. `primaryAlive()` missed data integrity → replaced with `primaryCanServe()`
  2. Universal guard only checked liveness → now checks data from primaryJournal onward
  3. `guardRun()` only checked liveness → now checks full integrity (except primaryMem)
  4. `primaryDeadStep()` had no bounce path → `primaryUnavailableStep()` handles both
  5. `failWrite()` was used for all failures → `endAsyncWork()` added for post-ACK cases
- The "Acknowledged but LOST" UI state is one of the most important pedagogical moments: it shows why `w:majority` matters over `w:1`.
