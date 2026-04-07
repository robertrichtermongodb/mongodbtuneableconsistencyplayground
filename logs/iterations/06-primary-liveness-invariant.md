# Primary Liveness Invariant

**ID:** 06
**Date:** 2026-04 (reconstructed)
**Status:** Complete

---

## Description

Refactored the primary liveness checks in `createWriteMachine` from 8 scattered `if (!state.nodes[state.primaryKey].alive)` blocks into a centralized set of helper functions. This ensures the invariant "primary must be alive for writes to proceed" is enforced consistently at both step-generation time and step-execution time.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Added 4 helpers inside `createWriteMachine`: `primaryAlive()` (simple predicate), `failWrite(title, explain)` (creates error step, sets phase='done'), `primaryDeadStep()` (builds context-aware error: "unjournaled write lost" vs "replication halted" based on phase and journal state), `guardRun(fn)` (wraps a step's `run()` to re-check liveness at execution time). Replaced all scattered checks with a single `nextStep()` guard + `guardRun()` wrappers on all step `run()` functions. |
| `test/machine.test.js` | Added 3 tests: primary crash after memory apply (before journal), primary crash after journal flush (during replication), primary crash after secondary mem apply (mid-replication). |

### Key Decisions

- Single invariant check at top of `nextStep()` (excluding 'send' phase which has its own connectivity check) rather than per-phase checks
- `guardRun()` wrapper handles the race condition where primary dies between step generation and execution
- Error messages are context-sensitive: "unjournaled write lost" when data was only in memory vs "replication halted" when journal is safe

## Tests

- **Before:** ~74 tests
- **After:** 77 tests (+3 primary crash scenario tests)

## Notes

- The 'send' phase is excluded from the universal guard because writer disconnection (link down) has its own separate check at that point
- This refactor was prompted by a reflection on code quality: the scattered checks were identified as a "fractured if/else" anti-pattern
