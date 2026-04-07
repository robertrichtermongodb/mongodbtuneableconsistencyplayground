# Write State Machine

**ID:** 03
**Date:** 2026-04 (reconstructed)
**Status:** Complete

---

## Description

Replaced the static `buildWriteSteps()` function with `createWriteMachine()` — a lazy step generator that evaluates live topology on each `nextStep()` call. This fixes the fundamental bug where crashing a node mid-replication caused the pre-built step array to continue targeting the dead node, ultimately ACKing the client with data that was never properly replicated.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Removed `buildWriteSteps()`. Added `createWriteMachine(w, j)` returning `{ history, isDone, nextStep(), getProgress() }`. Internal phase progression: `send` → `primaryMem` → `primaryJournal` → `repl` → `done`. Tracks `replicated`, `memApplied`, `pendingJournal`, `acked` across steps. Dynamically retargets surviving secondaries when a node crashes or partitions. |
| `js/engine.js` | Added `runMachine(machine, eng, panelId)` — unified engine loop that drives any machine. Added `arrayMachine(steps)` wrapper so `buildReadSteps` and `buildElectionSteps` still work through the same interface. |
| `js/app.js` | `handleWrite()` changed from `runSteps(buildWriteSteps(...))` to `runMachine(createWriteMachine(w, j), writeEngine, 'write-step-panel')`. |

### Key Decisions

- Lazy generator pattern (produce one step at a time) rather than re-building the full step array on each topology change — simpler, less error-prone
- `arrayMachine()` wrapper keeps reads and elections backward-compatible without refactoring them
- Machine's `getProgress()` method exposes phase/acked/replicated state for the UI progress trail (iteration 05)

## Tests

- **Before:** 0 tests
- **After:** 0 tests (testing added in iteration 04, which was built against this machine)

## Notes

- This was the single biggest architectural change in the project
- The old static step array is documented as I4 (fixed) in `docs/correctness.md`
- Read steps remain static arrays — less critical because reads are 2-3 fast steps with no replication loop
