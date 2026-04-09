# Quality-Focused Refactoring Part 2

**ID:** 23
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Second iteration of structural refactoring. Focus: decompose all functions over 30 lines, convert `createWriteMachine` from closure to context-object pattern, introduce semantic DOM helper functions, and split complex functions across all JS files. Zero behavioral changes — all 130 tests passed throughout every batch.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/state.js` | Added semantic DOM helpers: `getSelectedWriteConcern`, `getSelectedJournal`, `isJournalRequired`, `getSelectedReadConcern`, `getSelectedReadPref` + 4 setter counterparts. Replaced ~28 inline `document.getElementById('sel-...').value` calls across 3 files. |
| `js/write-machine.js` | Rewrote from 306-line closure to context-object pattern. Extracted 23 module-level functions: `normalizeWriteConcern`, `buildWriteOp`, `buildTopoSnapshot`, `wmEmit`, `wmFailWrite`, `wmAckCount`, `wmIsWcSatisfied`, `wmEligibleSecs`, `wmPickNextSec`, `wmMakeMemStep`, `wmMakeJournalStep`, 5 phase handlers, 5 replication sub-handlers (`wmTryJournalAfterMem`, `wmTryPendingJournal`, `wmTryAckStep`, `wmTryNextSecondaryMem`, `wmTryWcFailure`, `wmReplCompleteStep`). Factory `createWriteMachine` reduced to ~25 lines. |
| `js/election-steps.js` | Extracted `selectElectionCandidates`, `swapPrimaryRole`, `rollbackUncommittedVersions`, `capWinningPartitionVersions`, `invalidateSnapshotIfNeeded`, `logElectionResult`. `buildElectionSteps` reduced from 119 to ~50 lines. |
| `js/draw.js` | Extracted `leafColorForNode`, `drawPhaseRing`, `drawAlivePip` from `drawNode`. Extracted `versionBadgeColor`, `versionBadgeText` from `drawNodeDocBadge`. Extracted `hitTestNodeLinks`, `hitTestClientLinks` from `hitTest`. Extracted `drawDebugBadge`, `drawDebugNodeLabels`, `drawDebugLinkLabels` from `drawDebugLabels`. Split `updateConsistencyViews` into `updateWriteStatusView` + `updateReadStatusView`. |
| `js/engine.js` | Extracted `renderStepExplain`, `renderStepDots` from `showStepPanel`. Decomposed `buildPhases` into `buildFireForgetPhases`, `buildW1Phases`, `buildMajorityPhases` + promoted `phaseReplState`, `phaseAckState` to module level. Extracted `isElectionEligible`, `positionElectionButton` from `syncElectionButton`. |
| `js/read-steps.js` | Extracted `computeReadContext` from `buildReadSteps`. |
| `js/app.js` | Extracted `tipForLink`, `tipForClient` from `canvasTipFor`. Extracted `handleCanvasDrag`, `cursorForHit`, `handleCanvasHover` from mousemove listener. Extracted `placeDomDebugBadge` + `DEBUG_ELEMENT_IDS` constant from `createDomBadges`. Replaced selector calls with semantic helpers. |
| `js/tooltips.js` | Extracted `renderTipContent`, `positionTooltip` from `showTip`. |
| `prompts/quality-standards.md` | Added iteration 23 scorecard snapshot |

### Batches

| Batch | Scope | Functions Extracted |
|-------|-------|-------------------|
| 0 | Semantic DOM helpers | 10 getter/setter helpers in `state.js`, ~28 call-site replacements |
| 1 | `createWriteMachine` context-object | 23 module-level functions, closure → ctx pattern |
| 2 | `buildElectionSteps` | 6 extracted functions |
| 3 | `draw.js` | 12 extracted functions |
| 4 | `engine.js` | 9 extracted functions + 3 sub-builders |
| 5 | `read-steps.js` | 1 extracted function (`computeReadContext`) |
| 6 | `app.js` | 6 extracted functions + 1 constant |
| 7 | `tooltips.js` | 2 extracted functions |

### Key Decisions

- **`wm` prefix for write-machine helpers** — module-level functions in a flat global namespace need disambiguation. The `wm` prefix keeps them clearly scoped to the write machine without a class wrapper.
- **Semantic DOM helpers in `state.js`** — placed here because `state.js` loads first and all downstream files need them. Functions like `getSelectedWriteConcern()` replace duplicated `document.getElementById('sel-w').value` patterns.
- **Kept `|| fallback` at call sites** — test VM stubs return objects without `.value`, so callers that need defensive fallbacks (e.g. `getSelectedWriteConcern() || 'majority'`) keep them. Helpers return raw values.
- **`handleReplPhase` → chain of `||` calls** — `wmTryJournalAfterMem(ctx) || wmTryPendingJournal(ctx) || ...` is cleaner than a 60-line if-else ladder and makes the priority chain explicit.

## Tests

- **Before:** 130 tests
- **After:** 130 tests (no test changes)
- **New/modified tests:** None — all structural changes.

## Quality Score

- **Before:** 5/20 (iteration 22)
- **After:** 9/20 (+4)
- **Key improvements:** Max function length 306 → 57 (RED → YELLOW), nesting depth 6 → 4 (RED → YELLOW), duplicated patterns ~3 → ~1 (YELLOW → GREEN), functions >30 lines 23 → 13 (-10), mixed-abstraction ~10 → ~4, single-char vars ~62 → ~52
