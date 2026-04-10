# Iteration 26 — Quality Refactoring Part 5: Function Splitting

**ID:** 26
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Systematic function-splitting iteration targeting the two worst RED metrics: max function length (57 lines) and functions > 30 lines (14). Also fixed measurement methodology — added a deterministic script and corrected the previous iteration's scorecard which had inconsistent manual estimates.

## What Changed

### Files

| File | Change |
|------|--------|
| `scripts/measure-quality.js` | **New.** Deterministic quality scorecard measurement script — counts function lengths, single-char vars, nesting depth, file lengths via brace-depth tracking |
| `js/read-steps.js` | Split `buildReadSteps` (57→10), `buildMajorityReadSteps` (41→16), `buildDataReturnStep` (34→5), `buildLinearizableReadSteps` (33→24). Extracted: `buildDisconnectedStep`, `buildIssueReadStep`, `buildNoTargetStep`, `buildConcernSteps`, `buildMajorityFrozenSteps`, `pingAckSecondary`, `buildLinearizableReturnStep`, `buildStandardReturnStep` |
| `js/election-steps.js` | Split `buildElectionSteps` (50→12). Extracted: `buildQuorumFailureStep`, `buildCampaignAndElectedSteps` |
| `js/write-machine.js` | Split `wmHandleSendPhase` (38→16). Extracted: `wmValidateSendTarget`, `wmRecordAck`. Nesting depth 5→3 in mem/journal steps |
| `js/draw.js` | Split `drawDocLedger` (46→32), `drawReplicationLinks` (41→6), `drawReadClient` (40→15), `drawNodeDocBadge` (35→26), `updateReadStatusView` (33→22). Extracted: `drawLedgerVersionRows`, `drawSingleReplicationLink`, `drawReadClientMeta`, `drawBadgeFrame`, `drawClientLine` (shared), `readStatusHTML`. Deduped `drawWriteClientLine`/`drawReadClientLine` via shared `drawClientLine` |
| `prompts/quality-standards.md` | Corrected iteration 25 snapshot (measurement errors). Added mandatory measurement rules. Added iteration 26 snapshot. Fixed stale `simulation.js` reference in rule #1 |
| `docs/architecture.md` | Updated last-updated line |
| `index.html` | Updated footer timestamp, bumped cache version to v30 |

### Key Decisions

- **Deterministic measurement over manual estimation:** The root cause of the scorecard "regression" in iteration 25 was inconsistent manual counting. A script eliminates this permanently. Metrics 1, 2, 3, 5, 6, 7 are now automated.
- **Extract-then-delegate pattern:** Every split follows the same approach — extract a coherent block into a named function, then have the parent delegate to it. No logic changed; no new behavior.
- **Client line deduplication via parameterized colors:** `drawWriteClientLine` and `drawReadClientLine` were 90% identical. A colors object parameter captures the only real difference.
- **`wmRecordAck` reduces nesting and deduplication:** The same ack-recording pattern appeared in both `wmMakeMemStep` and `wmMakeJournalStep`.

## Tests

- **Before:** 130 tests
- **After:** 130 tests (0 new, 0 removed)
- **Verification:** All 130/130 green after every atomic split (12 checkpoints)
- **One fix needed:** `buildLinearizableReturnStep` initially referenced `rc` from parent scope after extraction — fixed by using the literal `'linearizable'` since the function is only called for that concern

## Quality Scorecard

| # | Metric | Previous | Current | Δ | Rating |
|---|--------|----------|---------|---|--------|
| 1 | Max function length | 57 (`buildReadSteps`) | 32 (`draw`) | **-25** | YELLOW |
| 2 | Functions > 30 lines | 14 | 4 | **-10** | GREEN |
| 3 | Avg function length | 12.0 | 11.0 | -1 | GREEN |
| 4 | Magic numbers | ~65 | ~65 | 0 | RED |
| 5 | Single-char variables | 3 | 3 | 0 | GREEN |
| 6 | Max nesting depth | 5 (`buildMajorityReadSteps`) | 4 (`logElectionResult`) | **-1** | YELLOW |
| 7 | Max file length | 810 (`draw.js`) | 797 (`draw.js`) | -13 | RED |
| 8 | Mixed-abstraction functions | ~4 | ~3 | -1 | RED |
| 9 | Duplicated code patterns | ~1 | ~0 | -1 | GREEN |
| 10 | Tests passing | 100% | 100% | 0 | GREEN |
| 11 | Opaque conditionals | 0 | 0 | 0 | GREEN |
| | **Total** | **13 / 22** | **17 / 22** | **+4** | **Acceptable debt** |

## Notes

- The 4 remaining functions > 30 lines (32, 32, 32, 31) are all orchestrators (`draw`, `drawDocLedger`, `createWriteMachine`, `drawNode`) where further splitting would fragment the call sequence without improving cohesion. These are acceptable at YELLOW.
- `draw.js` at 797 lines is still the biggest file. The function splits shrank it by 13 lines; the remaining bulk is rendering helpers which are each small but numerous. A larger win would require moving hit-testing or status views to a separate file.
- `scripts/measure-quality.js` only automates metrics 1–3, 5–7. Metrics 4 (magic numbers), 8 (mixed-abstraction), 9 (duplication), 11 (opaque conditionals) still require manual assessment. Consider extending the script.
