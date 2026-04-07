# Dropdown Info Tooltips

**ID:** 10
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Added native browser hover tooltips to all four configuration dropdowns (write concern, journal, read concern, read preference). Each tooltip provides a compact, plain-language explanation of the currently selected value, helping users understand what they're configuring without leaving the UI.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/app.js` | Added `TOOLTIPS` map with explanations for all 16 dropdown values across 4 selectors. Added `syncTooltips()` function that sets each `<select>` element's `title` attribute based on its current value. Wired into change handlers and init. |

### Key Decisions

- **Native `title` attribute**: Used the browser's built-in tooltip mechanism rather than a custom tooltip component. Zero CSS/JS overhead, works on all browsers, accessible by default. Trade-off: limited styling control and slight delay before showing — acceptable for an info tooltip.
- **Compact wording**: Each tooltip is one sentence, focused on the practical consequence (e.g., "rollback risk", "no coordination", "crash-safe") rather than deep technical detail. The step-panel details already cover the full explanation.
- **`syncTooltips()` centralized**: One function updates all four selects. Called from change handlers and init — no per-element logic scattered around.

## Tests

- **Before:** 77 tests
- **After:** 77 tests (all passing)
- **New/modified tests:** None — tooltips are purely informational UI with no logic to test.

## Notes

- The native tooltip delay (~0.5–1s) varies by OS/browser. If faster feedback is desired, a custom tooltip component could replace the `title` attribute later.
- Tooltip text is static per value. If dynamic context were needed (e.g., "majority = 2 nodes in this topology"), the `syncTooltips()` function could compute it.
