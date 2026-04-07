# Primary Journal Before Replication

**ID:** 15
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Eliminated the `deferJournal` code path that allowed `j:false` writes to skip the primary's journal flush and jump straight to secondary replication. The primary now always completes memory apply + journal flush before any replication begins, regardless of the `j` flag. This fixes a recurring visualization issue where the primary appeared to replicate to secondaries before writing to its own disk.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Removed `deferJournal` branch in `primaryMem` — always sets `phase = 'primaryJournal'`. Removed `asyncJournal` set (no longer needed). Removed step 2b (primary async journal post-ACK) and section 5 (deferred journal batch). Updated `primaryMem` explain text ("not crash-safe until the next step" instead of "asynchronously"). Updated ACK explain text for `w:1` (removed "journal pending" since it's already done) and `w:2/w:3` (removed misleading "flushes still pending"). |
| `test/machine.test.js` | Updated `w:1 j:false` tests: ACK now at index 3 (was 2), journal before ACK (was after). Updated `w:2 j:false`: ACK at index 5 (was 4), asserts primary journal before secondary replication. Updated `w:3 j:false`: ACK at index 7 (was 6). Changed "primary bounce after ACK (w:1 j:false)" from data-lost test to data-survives test (journal now happens before ACK). Updated phase transition test to include primaryJournal step. |
| `test/election.test.js` | Updated `runMachineSteps` from 3 to 4 for `w:1 j:false` writes (send + primaryMem + primaryJournal + ACK). |
| `test/reads.test.js` | Same step count update (3 → 4) for `w:1 j:false` write setup. |
| `docs/architecture.md` | Updated phase progression to show single unified path. Removed `asyncJournal` from state tracking. Updated example step sequences. |

### Key Decisions

- The `j` flag now only controls *when the ack counts* (memory apply for j:false, journal flush for j:true), not *whether the primary journals before replication*. This is a pedagogical simplification that eliminates a recurring source of confusing visualizations.
- The "primary bounce after ACK (w:1 j:false) — data lost" scenario no longer exists in the step-by-step flow, since the primary always journals before ACK. The bounce-after-primaryMem-before-journal scenario still demonstrates data loss correctly.
- Removed ~20 lines of dead code (`asyncJournal`, step 2b, section 5) that were only needed for the deferred journal path.

## Tests

- **Before:** 85 tests
- **After:** 85 tests (same count, updated assertions)
- **Modified tests:** `w:1 j:false` (5 tests), `w:2 j:false` (2 tests), `w:3 j:false` (2 tests), `primary bounce after ACK` (1 test), election rollback (3 tests), reads (2 tests)

## Notes

- This is an imprecise simplification (P-level in correctness.md): in real MongoDB, the primary's journal flush is async and replication can start before it completes. However, showing the primary's full write cycle (memory → disk) before replication provides a clearer mental model and avoids the recurring confusion of "why is the primary replicating before it's durable?"
