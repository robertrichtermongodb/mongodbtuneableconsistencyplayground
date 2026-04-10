# Iteration 27 — GPT-5.3 Assessment Remediation

**ID:** 27
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Addressed all three findings from a fresh GPT-5.3 codebase assessment: linearizable reads to manually-targeted secondaries now produce an explicit error (option C — consistent with the existing `NotWritablePrimary` pattern for writes), project rules and docs were aligned with the post-split module layout, and stale comments were cleaned up. Additionally pushed the quality scorecard from 17/22 ("Acceptable debt") to 19/22 ("Healthy") by eliminating all functions over 30 lines and reducing max nesting depth from 4 to 3.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/read-steps.js` | Added `buildLinearizableNotPrimaryStep` — error step when `rc:linearizable` targets a non-primary. Extracted `issueReadRun`, `onLinearizableArrive`, `onStandardReadArrive`, `onFrozenArrive` to flatten nesting from awaitParticle callbacks. Guard in `buildConcernSteps` short-circuits with error when `targetKey !== state.primaryKey` for linearizable. |
| `js/texts.js` | Added `TEXTS.read.linearizableNotPrimary(targetLabel)` — step panel text explaining the rejection. Added `TEXTS.consistency.readLinearizableNotPrimary(sessionSuffix)` — consistency view for the error state. |
| `js/draw.js` | New `errorReason === 'linearizableNotPrimary'` branch in `updateReadStatusView`. Extracted `drawNodes`, `syncResetButton`, `computeLedgerState`, `drawNodeHoverRing` to shrink `draw` (32→21), `drawDocLedger` (32→20), `drawNode` (31→27). Fixed stale BFS comment (line 197). |
| `js/write-machine.js` | Extracted `wmBuildContext` from `createWriteMachine` (32→19). Extracted `wmOnSecondaryMemArrive`, `wmApplyPrimaryMem`, `wmApplyPrimaryJournal`, `wmOnFireForgetArrive`, `wmFireForgetRun`, `wmWcFailureRun` to flatten nesting depth from 4 to 3 across all phase handlers. |
| `js/election-steps.js` | Flattened `logElectionResult` from nested if/else (depth 4) to ternary (depth 2). |
| `js/state.js` | Fixed stale comment referencing `simulation.js` on `resolveReadTarget`. |
| `js/theme.js` | Fixed stale comment referencing `simulation.js` in particle color section. |
| `.cursor/rules/tcp-project.mdc` | Updated load order to 13-file sequence matching `index.html`. Replaced `simulation.js` row with `write-machine.js`, `read-steps.js`, `election-steps.js`, `animation.js`, `tooltips.js`. Updated `resolveReadTarget` invariant to note linearizable error guard. |
| `docs/architecture.md` | Updated `resolveReadTarget` helper description, last-updated header. |
| `prompts/quality-standards.md` | Added iteration 27 scorecard snapshot. |
| `test/reads.test.js` | Added `rejects when manually targeted to a secondary` — asserts `phase: 'error'`, `errorReason: 'linearizableNotPrimary'`, title matches `/not.*primary/i`. |
| `index.html` | Updated footer timestamp. |

### Key Decisions

- **Option C (error step) over option A (silent redirect) or option B (force primary):** The user pointed out that writes to a non-primary already show an explicit `NotWritablePrimary` error — the educational value is in showing *why* it fails, not in silently fixing the routing. Linearizable reads now follow the same pattern: let the read go to the targeted secondary, then show an error explaining that the driver enforces primary routing.
- **Guard in `buildConcernSteps`, not `resolveReadTarget`:** `resolveReadTarget` still returns `targetNode` for linearizable when set — the existing test (`'returns targetNode even for linearizable'`) stays, documenting the resolution behavior. The error guard lives one layer up in the step builder, which has access to step panel UI. This keeps `resolveReadTarget` a pure routing function and the step builder as the place where educational logic lives.
- **Nesting flattened via named arrival callbacks:** Every `awaitParticle` callback that caused depth 4 was extracted to a module-level function. The trade-off is more mixed-abstraction functions (state + draw in the same body), but these are step-execution helpers that inherently need both. Genuine mixed-abstraction count (~3 in app.js event handlers) is unchanged.

## Tests

- **Before:** 130 tests
- **After:** 131 tests (+1)
- **New test:** `rc:linearizable — rejects when manually targeted to a secondary` in `test/reads.test.js` — sets `readClient.targetNode = 's1'`, runs linearizable read steps, asserts error phase with `linearizableNotPrimary` reason and title matching "not primary".

## Quality Scorecard

| # | Metric | Previous | Current | Δ | Rating |
|---|--------|----------|---------|---|--------|
| 1 | Max function length | 32 (`draw`) | 30 (`drawLockHint`) | **-2** | GREEN |
| 2 | Functions > 30 lines | 4 | 0 | **-4** | GREEN |
| 3 | Avg function length | 11.0 | 10.4 | -0.6 | GREEN |
| 4 | Magic numbers | ~65 | ~65 | 0 | RED |
| 5 | Single-char variables | 3 | 2 | -1 | GREEN |
| 6 | Max nesting depth | 4 (`logElectionResult`) | 3 (`awaitParticle`) | **-1** | GREEN |
| 7 | Max file length | 797 (`draw.js`) | 806 (`draw.js`) | +9 | RED |
| 8 | Mixed-abstraction functions | ~3 | ~3 | 0 | YELLOW |
| 9 | Duplicated code patterns | ~0 | ~0 | 0 | GREEN |
| 10 | Tests passing | 100% | 100% | 0 | GREEN |
| 11 | Opaque conditionals | 0 | 0 | 0 | GREEN |
| | **Total** | **17 / 22** | **19 / 22** | **+2** | **Healthy** |

## Notes

- The scorecard crossed the "Healthy" threshold (18+) for the first time. Two RED metrics remain: magic numbers (~65, diminishing returns) and max file length (806 in `draw.js`, needs a file split which is a larger effort).
- `draw.js` grew by 9 lines despite extractions because the new helper functions (`drawNodes`, `syncResetButton`, `computeLedgerState`, `drawNodeHoverRing`) add function signatures. A net reduction requires moving a section (hit testing or status views) to a separate file.
- The `resolveReadTarget` test `'returns targetNode even for linearizable'` still passes and documents that the routing function itself doesn't enforce the primary constraint — the guard is in the step builder layer. This is intentional separation of concerns.
