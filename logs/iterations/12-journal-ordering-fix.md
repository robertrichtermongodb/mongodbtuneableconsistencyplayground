# Journal Ordering Fix (j:false deferred flush)

**ID:** 12
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Fixed incorrect journal ordering for all `j:false` write concerns (w:1, w:2, w:3). The simulator was showing the primary journal flush *before* the ACK, but with `j:false` MongoDB counts the ack on memory apply and flushes the journal asynchronously (~50ms later). The ACK now correctly fires immediately after memory apply, with journal flushes deferred to post-ACK async steps.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Added `asyncJournal` set. `primaryMem` skips to `repl` phase when `!ackNeedsJournal && w !== 0`. Repl phase promotes mem-applied secondaries immediately for j:false (no journal gate). Deferred journal flushes run post-ACK. Updated ACK explain text to mention pending journals. |
| `test/machine.test.js` | Updated w:1 j:false tests for new step order (ACK at index 2 instead of 3). Added new `w:1 j:true` test suite verifying journal-gated path. Updated w:2 and w:3 tests to assert ACK before journals. |
| `test/election.test.js` | Adjusted `runMachineSteps` counts from 4→3 for w:1 j:false (no longer includes primaryJournal step before ACK). |
| `test/reads.test.js` | Same step count adjustment for tests that stop at ACK to test pre-replication state. |

### Key Decisions

- **w:0 unchanged:** w:0 still goes through `primaryJournal → fireForget` since there's no ACK at all — ordering relative to ACK is irrelevant.
- **w:majority unchanged:** `writeConcernMajorityJournalDefault:true` means majority always journal-gates, regardless of client j value. This path is preserved exactly.
- **Deferred journals shown explicitly:** Post-ACK journal flushes are shown as separate steps (not hidden) to teach users that the data isn't crash-safe until the journal completes.
- **Promotion pattern:** In the repl phase, j:false mem-applied secondaries are promoted to `replicated` immediately (ack counted on memory), avoiding `pendingJournal` overhead.

## Tests

- **Before:** 77 tests across 34 suites
- **After:** 82 tests across 37 suites
- **New/modified tests:**
  - `w:1 j:false`: rewrote to assert ACK at index 2, added "journal flush happens after ACK" test
  - `w:1 j:true`: new suite (2 tests) verifying journal-before-ACK path
  - `w:2 j:false`: added ACK index assertion (index 3) and "journal flushes come after ACK"
  - `w:3 j:false`: added ACK index assertion (index 4) and "journal flushes come after ACK"
  - Election/reads tests: adjusted step counts to match new w:1 j:false flow

## Notes

- The correct step sequences per scenario are now:
  - **w:1 j:false:** Send → PriMem → ACK → PriJournal(async) → S1Mem → S2Mem → S1Journal → S2Journal → Done
  - **w:1 j:true:** Send → PriMem → PriJournal → ACK → (async repl) → Done
  - **w:majority:** Send → PriMem → PriJournal → S1Mem → S1Journal → ACK → (async repl) → Done
  - **w:2 j:false:** Send → PriMem → S1Mem → ACK → PriJournal(async) → S2Mem → S1Journal → S2Journal → Done
  - **w:3 j:false:** Send → PriMem → S1Mem → S2Mem → ACK → PriJournal(async) → S1Journal → S2Journal → Done
  - **w:0:** Send → PriMem → PriJournal → FireAndForget (unchanged)
- Primary async journal always fires right after the ACK (before secondary replication resumes), matching the typical real-world ordering where the ~50ms checkpoint fires before secondaries fully replicate.
