# Quality-Focused Refactoring

**ID:** 22
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Major structural refactoring applying clean code principles across the entire JS codebase. Extracted helper functions, named magic numbers, decomposed large functions, split monolithic files into focused modules, and renamed cryptic variables. Zero behavioral changes — all 130 tests passed throughout every batch without modification.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/state.js` | Added `majorityThreshold()`, `getVersionEntry()`, `isEngineActive()` helpers; added timing constants (`PAUSE_SHORT_MS`, `PAUSE_MEDIUM_MS`, `PAUSE_LONG_MS`, `PAUSE_STAGGER_MS`, `PAUSE_JOURNAL_MS`, `PAUSE_RECOVERY_MS`, `AUTO_FINISH_TICK`); renamed `lk` → `linkKey` |
| `js/theme.js` | Renamed `let T` → `let THEME` |
| `js/draw.js` | Renamed `T` → `THEME` (132×), `NR` → `NODE_RADIUS`, `CR` → `CLIENT_RADIUS`; extracted 15+ named constants for layout, hit-testing, and drawing sizing; extracted animation code to `animation.js`; added `drawBrokenMidpoint()` and `drawHoverMidpoint()` helpers; renamed `lk` → `linkKey` |
| `js/engine.js` | Decomposed `syncButtons()` into `syncWritePanelButtons`, `syncReadPanelButtons`, `syncDropdownLocks`, `syncElectionButton`; replaced inline engine-active checks with `isEngineActive()`; replaced magic `10` with `AUTO_FINISH_TICK` |
| `js/app.js` | Extracted tooltip code to `tooltips.js`; decomposed `handleCanvasClick()` into `handleNodeClick`, `handleLinkClick`, `handleClientLinkClick`; renamed `j` → `journalRequired` in `handleWrite()`; replaced magic `600` with `PAUSE_RECOVERY_MS` |
| `js/simulation.js` | **Deleted** — split into `write-machine.js`, `read-steps.js`, `election-steps.js` |
| `js/write-machine.js` | **New** — `createWriteMachine` with phase dispatch table and 5 named handlers (`handleSendPhase`, `handlePrimaryMemPhase`, `handlePrimaryJournalPhase`, `handleFireForgetPhase`, `handleReplPhase`) |
| `js/read-steps.js` | **New** — `buildReadSteps` orchestrator with per-concern builders (`buildLocalReadSteps`, `buildMajorityReadSteps`, `buildLinearizableReadSteps`, `buildSnapshotReadSteps`, `buildDataReturnStep`) |
| `js/election-steps.js` | **New** — `buildElectionSteps` |
| `js/animation.js` | **New** — `skipAnimations`, `setSkipAnimations`, `awaitParticle`, `ease`, `startAnimLoop` extracted from `draw.js` |
| `js/tooltips.js` | **New** — `tipEl`, `showTip`, `hideTip`, `syncTooltips`, `initButtonTips` extracted from `app.js` |
| `index.html` | Updated `<script>` tags for new file structure |
| `test/helpers.js` | Updated `SOURCE_FILES` array for new file structure |
| `prompts/quality-standards.md` | Added iteration 22 scorecard snapshot |

### Key Decisions

- **Kept `engine.js` intact** — splitting would break the test harness since `runMachine` calls UI functions (`showStepPanel`, `syncButtons`) that are not loaded in the test VM. Internal decomposition achieved the same modularity benefit.
- **Phase dispatch table in `createWriteMachine`** — instead of a full class/context-object refactor, used a `phaseHandlers` map of inner functions sharing closure state. Clean dispatcher without over-engineering.
- **`lk` → `linkKey` but kept `i`/`j`/`k` loop counters** — idiomatic loop variables left unchanged per convention. Only renamed variables where the abbreviation obscured domain meaning.
- **`T` → `THEME` globally** — single-char global variable was the most confusing abbreviation. Worth the 132-occurrence rename for clarity.
- **Functions > 30 lines increased (19 → 23)** — decomposing large functions created new extracted helpers, some of which are 30–40 lines. Net benefit: average function length dropped from 21 → 18, and the largest function shrank from 337 → 306.

## Tests

- **Before:** 130 tests
- **After:** 130 tests (no test changes)
- **New/modified tests:** None — all structural changes. Zero test modifications required across 11 refactoring batches.

## Notes

- Quality score improved from 3/20 → 5/20. The biggest wins were in duplicated code patterns (RED → YELLOW) and average function length.
- The `createWriteMachine` closure is still 306 lines (RED) — further decomposition requires extracting the closure state into an explicit context object, which is a larger architectural change for a future iteration.
- `draw.js` at 784 lines is still the largest file (RED). Further splitting requires isolating the hit-test logic or the per-node drawing routines, which have tight coupling to the canvas context.
- ~100 magic numbers remain, primarily pixel coordinates, font sizes, and RGB values in drawing code. These are visual tuning values where named constants add marginal clarity.
