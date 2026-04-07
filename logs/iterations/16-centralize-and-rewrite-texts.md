# Centralize and Rewrite All User-Facing Texts

**ID:** 16
**Date:** 2026-03-15
**Status:** Complete

---

## Description

All user-facing text (step panel titles/explains, dropdown tooltips, button tooltips, consistency views, election messages) was extracted from `simulation.js`, `draw.js`, and `app.js` into a single `js/texts.js` file. Every text was rewritten for understandability: jargon replaced with plain English, each explanation follows a "what happens → technical detail" pattern, and terse labels were expanded.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/texts.js` | **New.** Central registry of all user-facing strings: dropdown/button tooltips, write step texts, read step texts, election texts, consistency view HTML, config badge tooltips, and safety notes. |
| `js/simulation.js` | Replaced all inline title/explain strings with `TEXTS.write.*`, `TEXTS.read.*`, `TEXTS.election.*` references. No logic changes. |
| `js/draw.js` | Replaced inline consistency view HTML with `TEXTS.consistency.*` calls. |
| `js/app.js` | Replaced `DROPDOWN_TIPS` and `BUTTON_TIPS` objects with aliases to `TEXTS.dropdowns` / `TEXTS.buttons`. Badge tooltip strings replaced with `TEXTS.badge.*`. |
| `index.html` | Added `<script src="js/texts.js">` before `draw.js` in load order. |
| `test/helpers.js` | Added `texts.js` to `SOURCE_FILES` array (loaded before `simulation.js`). |
| `test/machine.test.js` | Updated one title-matching assertion to account for renamed secondary mem step title ("receives" instead of "memory"). |

### Key Decisions

- **Keep "journal" and "ACK" in titles.** These are standard MongoDB terms that users should learn. Texts use them alongside plain-English explanations rather than replacing them entirely.
- **Function-based text generation.** Texts that depend on runtime values (opLabel, node label, version IDs) are functions in TEXTS. Static texts are plain objects.
- **Spread pattern for step objects.** Read steps use `...TEXTS.read.linearizableCheck` to cleanly merge title/explain while keeping the `run` function in simulation.js.
- **Consistency views in same file.** Both write and read consistency box HTML live in `TEXTS.consistency` so all user-facing text is reviewable in one place.

## Tests

- **Before:** 85 tests
- **After:** 85 tests (all green)
- **Modified tests:** 1 assertion updated in `w:2 j:false` suite to match renamed title pattern

## Notes

- `texts.js` is loaded as a global `TEXTS` object (same pattern as other browser globals). No module system required.
- The `simulation.js` and `draw.js` files are now significantly shorter since text construction moved out.
- Log messages (console/log panel) were intentionally kept inline in simulation.js — they are developer-facing, not user-facing.
