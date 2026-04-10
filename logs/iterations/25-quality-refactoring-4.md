# Iteration 25 — Quality Refactoring Part 4

**ID:** 25
**Date:** 2026-04-10
**Status:** Complete

---

## Description

Cross-cutting quality iteration targeting three previously unaddressed areas: CSS quality (first-ever), test infrastructure hardening, and dead code / duplication. All changes are structural — zero behavioral change.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/state.js` | Removed dead `getVersionEntry()`; added `LINK_PAIR_LABELS` constant |
| `js/read-steps.js` | Removed dead `buildIssueReadStep()` |
| `js/app.js` | Replaced 2× inline `pairMap` with `LINK_PAIR_LABELS` |
| `js/draw.js` | Replaced 1× inline `pairMap` with `LINK_PAIR_LABELS` |
| `css/style.css` | Removed dead `.btn-group`, `.wip-badge`; removed `!important`; added `button:focus-visible`, `@media (prefers-reduced-motion: reduce)`; fixed duplicate `.step-card`; extracted `.modal-overlay`/`.modal-box` shared base; added `.topo-actions`, `.footer-disclaimer`, `.footer-rule` classes |
| `index.html` | Replaced 4 inline styles with CSS classes; added `modal-overlay`/`modal-box` to popups; bumped cache version to v29 |
| `test/helpers.js` | Added `idleAllPhases()`, `partitionPrimary()`; added engine field resets to `resetState()` |
| `test/election.test.js` | Replaced 8× `idleAllPhases`, 8× `partitionPrimary(ctx)` calls; removed 2 duplicate local function defs |
| `test/reads.test.js` | Replaced 12× `idleAllPhases` calls; simplified `writeV1()` |
| `test/state.test.js` | Replaced 1× `idleAllPhases` call |
| `docs/architecture.md` | Fixed stale `simulation.js` refs → `write-machine.js`/`read-steps.js`/`election-steps.js`; added `animation.js`/`tooltips.js` to file list; updated script load order; added `LINK_PAIR_LABELS` to state.js description; updated test counts |

### Key Decisions

- **CSS quality as a new dimension:** This is the first iteration to touch CSS. Focused on hygiene (dead rules, `!important`, inline styles) and accessibility basics (`focus-visible`, `prefers-reduced-motion`) rather than a full restructure.
- **Test helpers over test rewrites:** Extracted shared setup utilities rather than rewriting tests. Assertions remain identical — only the setup boilerplate changed, guaranteeing behavioral equivalence.
- **Engine reset in `resetState()`:** Defensive change — prevents future cross-test leakage if new tests manipulate engine state directly.
- **`LINK_PAIR_LABELS` in `state.js`:** Centralized because it's topology-structural data, not rendering or app logic. Used by both `draw.js` and `app.js`.

## Tests

- **Before:** 130 tests
- **After:** 130 tests (0 new tests — this iteration hardened infrastructure, not coverage)
- **Verification:** Tests run at 9 checkpoints during the iteration; all 130/130 at every checkpoint.
- **Test infrastructure improvements:** `idleAllPhases()` eliminated 22 inline repeated patterns; `partitionPrimary()` eliminated 2 duplicate local functions; engine fields now reset between tests.

## Quality Scorecard

| # | Metric | Previous | Current | Δ | Rating |
|---|--------|----------|---------|---|--------|
| 1 | Max function length | 57 (`buildReadSteps`) | 57 (`buildReadSteps`) | 0 | YELLOW |
| 2 | Functions > 30 lines | 13 | 14 | +1 | RED |
| 3 | Avg function length | ~18 | ~12 | -6 | GREEN |
| 4 | Magic numbers | ~68 | ~65 | -3 | RED |
| 5 | Single-char variables | 0 | 6 | +6 | GREEN |
| 6 | Max nesting depth | 4 | 3 | -1 | GREEN |
| 7 | Max file length | 810 (`draw.js`) | 810 (`draw.js`) | 0 | RED |
| 8 | Mixed-abstraction functions | ~4 | ~4 | 0 | RED |
| 9 | Duplicated code patterns | ~1 | ~1 | 0 | GREEN |
| 10 | Tests passing | 100% | 100% | 0 | GREEN |
| 11 | Opaque conditionals | 0 | 0 | 0 | GREEN |
| | **Total** | **15 / 22** | **17 / 22** | **+2** | **Acceptable debt** |

## Notes

- CSS quality is now on the radar but has no formal scorecard metric yet. Recommend adding CSS metrics (dead rules, `!important` count, inline styles, a11y CSS features) in a future iteration.
- `draw.js` at 810 lines remains the biggest RED. The `drawWriteClientLine`/`drawReadClientLine` deduplication is the highest-impact next step for shrinking it.
- Test coverage for `app.js`, `draw.js`, `animation.js`, `tooltips.js` (1,525 lines total) remains at zero — see `prompts/test-gap-backlog.md`.
- Architecture doc was significantly stale on file structure (still referenced `simulation.js`); now accurate.
