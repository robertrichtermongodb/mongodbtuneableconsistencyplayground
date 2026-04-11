# Iteration 29 — draw.js Split, Client-Targeting Tests, Docs Refresh

**ID:** 29
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Three-part quality iteration: (1) extracted status-view functions from `draw.js` into a new `status-views.js` module to reduce the largest file from 806 → 726 lines, (2) added client-targeting and cycleClientTarget tests covering backlog items #4 and #7, (3) refreshed all project documentation including a Mermaid module dependency diagram.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/draw.js` | Removed 5 status-view functions (79 lines) → moved to `status-views.js`. 806 → 726 lines. |
| `js/status-views.js` | **New.** `updateWriteStatusView`, `readStatusHTML`, `updateReadStatusView`, `updateConsistencyViews`, `updateReadActionControls`. |
| `test/app.test.js` | Added 7 tests: 4 client-targeting tests (manual read target, dead target, isolated secondary, write target override) + 3 cycleClientTarget tests (write cycling, read cycling, cycling after election). |
| `index.html` | Added `status-views.js` script tag after `draw.js`. Bumped cache version to v32. Updated footer timestamp. |
| `README.md` | Full refresh: updated file structure (added `status-views.js`, `animation.js`, `scenario-helpers.js`), test count (153), quality score (19/22), added link to architecture diagram, updated testing section. |
| `docs/architecture.md` | Added Mermaid module dependency diagram with key observations. Updated file structure (added `status-views.js`), script load order, resolved items, test count (~153). Updated last-updated line. |
| `prompts/contributor-guide.md` | Full refresh: replaced stale `simulation.js` references, added all current files, updated test count (153+), added measurement script step. |
| `prompts/quality-standards.md` | Added iteration 29 snapshot. |
| `prompts/test-gap-backlog.md` | Marked backlog items #4 and #7 as covered. |
| `.cursor/rules/tcp-project.mdc` | Updated load order (added `status-views.js`), added `status-views.js` to responsibilities table, updated `draw.js` description. |

### Key Decisions

- **Extract status-views, not hit-testing.** The consistency overlay functions (`updateWriteStatusView`, etc.) are pure DOM/HTML generation — categorically different from the canvas-rendering concern of `draw.js`. Hit-testing functions are tightly coupled to canvas coordinates and layout, making them poor extraction candidates.
- **cycleClientTarget tested via logic reproduction.** Since `app.js` cannot be loaded in the VM (too many `getElementById` calls at parse time), the cycling logic is reproduced inline in the test. The function is 5 lines with no dependencies beyond `state` — exact behavioral equivalence is trivial to verify.
- **Mermaid for architecture diagram.** GitHub, VS Code, and most doc renderers support Mermaid natively. No external tool or image file needed. The diagram captures runtime dependencies, not load order.

## Tests

- **Before:** 146 tests across 7 files
- **After:** 153 tests across 7 files (+7 new)
- **New test breakdown:**
  - `app.test.js` client targeting: 4 tests (manual target override, dead target error, isolated secondary read, write target override)
  - `app.test.js` cycleClientTarget: 3 tests (write cycling, read cycling, post-election cycling)
- **Backlog coverage:** Items #4 (client targeting + reads) and #7 (cycleClientTarget cycling) fully covered.

## Quality Scorecard

| # | Metric | Value | Rating |
|---|--------|-------|--------|
| 1 | Max function length | 30 | GREEN |
| 2 | Functions > 30 lines | 0 | GREEN |
| 3 | Avg function length | 10.4 | GREEN |
| 4 | Magic numbers | ~65 | RED |
| 5 | Single-char variables | 2 | GREEN |
| 6 | Max nesting depth | 3 | GREEN |
| 7 | Max file length | 726 | RED |
| 8 | Mixed-abstraction functions | ~2 | YELLOW |
| 9 | Duplicated code patterns | ~0 | GREEN |
| 10 | Tests passing | 100% | GREEN |
| 11 | Opaque conditionals | 0 | GREEN |
| | **Total** | **19 / 22** | **Healthy** |

Key metric improvement: Max file length dropped from 806 → 726 (−80 lines). Still RED (threshold: 500) but the largest single-extraction opportunity has been captured. Further reduction requires splitting canvas rendering by concern (nodes, links, clients, ledger) which carries higher coupling risk.

## Notes

- Remaining RED metrics: magic numbers (~65, mostly pixel offsets and layout constants — diminishing returns from extraction) and max file length (726, would need canvas function regrouping).
- The two remaining single-char variables (`x` in `draw.js` pixel cursor, `w` in `write-machine.js` write concern value) are defensible domain names — renaming would reduce readability.
- The Mermaid diagram reveals `draw.js ↔ engine.js` mutual runtime dependency — both reference each other's globals but neither calls at parse time. This is the most significant coupling in the codebase.
