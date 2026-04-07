# Centralize and Rewrite All User-Facing Texts

**ID:** 16
**Date:** 2026-03-15
**Status:** Complete

---

## Description

All user-facing text (step panel titles/explains, dropdown tooltips, button tooltips, consistency views, election messages) was extracted from `simulation.js`, `draw.js`, and `app.js` into a single `js/texts.js` file. Every text was rewritten for understandability: jargon replaced with plain English, each explanation follows a "what happens → technical detail" pattern, and terse labels were expanded. Additionally fixed a read correctness bug and a canvas rendering race condition.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/texts.js` | **New.** Central registry of all user-facing strings: dropdown/button tooltips, write step texts, read step texts, election texts, consistency view HTML, config badge tooltips, and safety notes. |
| `js/simulation.js` | Replaced all inline title/explain strings with `TEXTS.write.*`, `TEXTS.read.*`, `TEXTS.election.*` references. No logic changes. |
| `js/draw.js` | Replaced inline consistency view HTML with `TEXTS.consistency.*` calls. |
| `js/app.js` | Replaced `DROPDOWN_TIPS` and `BUTTON_TIPS` objects with aliases to `TEXTS.dropdowns` / `TEXTS.buttons`. Badge tooltip strings replaced with `TEXTS.badge.*`. Added `window.addEventListener('load', resizeCanvas)` to fix canvas sizing race. |
| `js/state.js` | **Bug fix:** `getServedVersion` now caps `majorityCommitId` by `node.memoryVersion` — a node can only serve data it has actually replicated. |
| `css/style.css` | `.step-title` min-height increased to `2.6em` (2 lines) to prevent layout bouncing on long titles. |
| `index.html` | Added `<script src="js/texts.js">` in load order. Added `Cache-Control`, `Pragma`, `Expires` meta tags to prevent stale cache. |
| `test/helpers.js` | Added `texts.js` to `SOURCE_FILES` array (loaded before `simulation.js`). |
| `test/machine.test.js` | Updated one title-matching assertion to account for renamed secondary mem step title. |

### Key Decisions

- **Keep "journal" and "ACK" in titles.** These are standard MongoDB terms users should learn. Texts use them alongside plain-English explanations.
- **Function-based text generation.** Texts depending on runtime values are functions in TEXTS; static texts are plain objects.
- **Cap served version by node's memoryVersion.** Fixes incorrect rc:majority reads from nodes that haven't replicated the data yet — matches real MongoDB behavior.

## Tests

- **Before:** 85 tests
- **After:** 85 tests (all green)
- **Modified tests:** 1 assertion updated in `w:2 j:false` suite to match renamed title pattern

## Notes

- `getServedVersion` bug: a secondary without v1 replicated would incorrectly return v1 for rc:majority because the function used the global `majorityCommitId` without checking the node's local `memoryVersion`.
- Canvas race: `resizeCanvas()` called before CSS/fonts loaded could produce wrong dimensions. The `load` event listener ensures a correct re-measure.
- Log messages (console/log panel) kept inline in simulation.js — they are developer-facing, not user-facing.
