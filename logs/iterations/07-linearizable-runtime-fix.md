# Linearizable Runtime Topology Fix

**ID:** 07
**Date:** 2026-04-15
**Status:** Complete

---

## Description

Fixed three issues in the `rc:linearizable` read path where topology and served values were evaluated at step-build time rather than step-execution time. If secondaries died between building the read steps and executing the leadership check, the stale build-time values would cause the read to incorrectly succeed. The served value (`majorityCommitId`) was also stale if a write completed during the leadership confirmation phase.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | **Linearizable section**: `liveSecs` now computed at runtime inside the leadership ping step's `run()`. Dead nodes skipped before ping/ack particles. `majorityOk` re-evaluated at runtime in the leadership evaluation step. **Data-return step**: split into linearizable-specific (runtime `getServedVersion()` call, skip on error) vs non-linearizable (build-time values, unchanged). Removed stale `isBlocked` gate variable. **Snapshot section**: added secondary staleness note in explain text. |
| `test/reads.test.js` | Updated existing "blocks when majority unreachable" test (removed title-based assertion, kept phase assertion). Added 2 new tests: "blocks when secondaries die AFTER steps are built" (runtime topology check), "returns fresh majorityCommitId at data-return time" (runtime served value). |
| `docs/correctness.md` | Added I5 (linearizable runtime fix). Updated correct behavior count. |

### Key Decisions

- Runtime evaluation inside `run()` functions rather than converting reads to a full state machine — minimal change, sufficient for the 2-3 step read flow
- Separate data-return step for linearizable (runtime-computed) vs other read concerns (build-time is correct for them)
- Snapshot secondary staleness is a pedagogical note only, not a behavior change

## Tests

- **Before:** 74 tests (after vanity test cleanup)
- **After:** 77 tests (+2 linearizable runtime tests, +1 from iteration 06 overlap)

## Notes

- Documented as I5 in `docs/correctness.md`
- Read steps remain static arrays — only the `run()` functions evaluate state at runtime, which is sufficient since reads don't have a replication loop
