# Iteration 28 — Scenario Integration Tests

**ID:** 28
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Added multi-operation integration tests that exercise the full engine pipeline (`runMachine` → `waitForClick` → step execution) for all 7 predefined UI scenarios and 4 high-priority backlog items. No production code changes — test infrastructure only.

## What Changed

### Files

| File | Change |
|------|--------|
| `test/helpers.js` | Element registry with mutable `.value` for select stubs; `scenarioMode` option auto-resolves `waitForClick`; `logStep`/`updateReadActionControls`/`createElement` stubs; bridged `$runMachine`, `$arrayMachine`, `$isEngineActive`, `$TEXTS` |
| `test/scenario-helpers.js` | **New.** Orchestration helpers mirroring `app.js` handlers: `applyScenario`, `performWrite/Read/Election`, `performSnapshotStart/Read`, `endSnapshotSession`, `crashNodeByKey`, `recoverNodeByKey`, `healPartition`, `resetEngines` + 6 assertion helpers |
| `test/scenarios.test.js` | **New.** All 7 TEXTS.scenarios as integration tests: safe-write, partition-safe, snapshot-isolation, linearizable, w1-data-loss, dirty-read, fire-forget |
| `test/app.test.js` | **New.** Multi-operation flows: read-after-write consistency (2 tests), double election (2 tests), partition reconciliation (1 test), engine guards (3 tests) |
| `prompts/test-gap-backlog.md` | Marked backlog items #2, #3, #5 as covered; #1 partially covered; added scenario coverage note |
| `prompts/quality-standards.md` | Added iteration 28 snapshot |
| `docs/architecture.md` | Updated file list with new test files; updated last-updated line |
| `index.html` | Updated footer timestamp; bumped cache version to v31 |

### Key Decisions

- **Do not load `app.js` in VM.** Loading it triggers ~30 `getElementById` calls at parse time — enormous stub surface. Instead, `scenario-helpers.js` replicates the orchestration logic using the same underlying functions (`createWriteMachine`, `buildReadSteps`, `runMachine`, etc.). This tests the real engine pipeline without coupling to DOM wiring.
- **`waitForClick` auto-resolve via scenarioMode.** Overrides the function declaration in the VM with `() => Promise.resolve()`. Same pattern as the existing `awaitParticle` stub. The `runMachine` loop drives to completion instantly.
- **Element registry replaces single stub.** Select elements (`sel-w`, `sel-j`, `sel-rc`, `sel-readpref`) now have mutable `.value` properties so `getSelected*/setSelected*` functions work. All other elements get fresh stub instances (prevents cross-element state leaks).
- **Dirty-read uses direct state setup.** The w:1 write pipeline acks at step 4 but majorityCommitId advances as soon as a secondary receives memory data. To test the "uncommitted read" scenario, we set `s2.memoryVersion = 1` directly after a partial write. This mirrors the approach in existing `reads.test.js`.

## Tests

- **Before:** 131 tests across 5 files
- **After:** 146 tests across 7 files (+15 new)
- **New test breakdown:**
  - `scenarios.test.js`: 7 tests (one per predefined scenario)
  - `app.test.js`: 8 tests (read-after-write ×2, double election ×2, partition reconciliation ×1, engine guards ×3)
- **Backlog coverage:** Items #2 (read-after-write), #3 (double election), #5 (partition reconciliation) fully covered. Item #1 (`checkPartitionHealed`) partially covered via `healPartition()`.

## Quality Scorecard

No production code changes — all metrics unchanged from iteration 27.

| # | Metric | Value | Rating |
|---|--------|-------|--------|
| 1 | Max function length | 30 | GREEN |
| 2 | Functions > 30 lines | 0 | GREEN |
| 3 | Avg function length | 10.4 | GREEN |
| 4 | Magic numbers | ~65 | RED |
| 5 | Single-char variables | 2 | GREEN |
| 6 | Max nesting depth | 3 | GREEN |
| 7 | Max file length | 806 | RED |
| 8 | Mixed-abstraction functions | ~3 | YELLOW |
| 9 | Duplicated code patterns | ~0 | GREEN |
| 10 | Tests passing | 100% | GREEN |
| 11 | Opaque conditionals | 0 | GREEN |
| | **Total** | **19 / 22** | **Healthy** |

## Notes

- `scenario-helpers.js` functions are treated as production-quality code: single concern per function, named assertion helpers, no inline magic values.
- The test infrastructure now supports two modes: basic (`createContext()`) for unit/integration tests that bypass the engine, and `scenarioMode` for full pipeline tests that use `runMachine`.
- Remaining test gaps: client targeting + reads (#4), `cycleClientTarget` (#7), canvas interaction (#8), `syncButtons` edge cases (#9), theme switching (#10). Items #8-#10 need DOM/browser runner (Option B from the analysis).
