# Custom Tooltip Component

**ID:** 11
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Replaced native browser `title` tooltips with a custom-styled tooltip component. Tooltips now appear with consistent styling, proper line-break/paragraph support, a title+body layout, and a directional arrow. Extended tooltip coverage from the 4 dropdowns to all 12 interactive buttons (write/read actions, snapshot session, reset, theme toggle, election).

## What Changed

### Files

| File | Change |
|------|--------|
| `css/style.css` | Added `.tip`, `.tip-title`, `.tip-body`, `.tip-arrow`, `.tip.below`, `.tip.visible` rules. Styled with card background, border, shadow, and design tokens. Supports above/below positioning with a rotated arrow. |
| `js/app.js` | Replaced native-title `TOOLTIPS` + `syncTooltips()` with: (1) custom tooltip component (~60 lines: creates a single floating `<div>`, shows/hides on mouseenter/mouseleave with 420ms delay, auto-positions above or below, clamps to viewport); (2) `DROPDOWN_TIPS` map for 4 selects (16 values); (3) `BUTTON_TIPS` map for 12 buttons; (4) `syncTooltips()` now sets `data-tip` instead of `title`; (5) `initButtonTips()` applies `data-tip` to all buttons at init. |
| `js/engine.js` | Removed all `.title = ...` assignments from `syncButtons()`. The custom tooltip system handles hover info; native titles would flash underneath and conflict. |
| `index.html` | Removed native `title` attributes from `btn-theme-toggle` and `btn-canvas-election`. |

### Key Decisions

- **Single floating `<div>` reused for all tooltips**: No per-element DOM overhead. The element is created once and repositioned on demand.
- **`data-tip` attribute pattern**: Any element with `data-tip="..."` automatically gets a tooltip. Delegated event listeners on `document` — no per-element binding needed.
- **`\n\n` as title/body separator**: The first paragraph becomes a bold title, the rest becomes the body. Single `\n` becomes `<br>`. Simple convention, no markup in the data attribute.
- **420ms delay**: Long enough to avoid flashing when moving the mouse across buttons, short enough to feel responsive.
- **Auto-flip**: Tooltip positions above the element by default; if it would go off-screen, it flips below with the arrow on top.
- **Removed all native `.title` overrides from `syncButtons()`**: Prevents dual-tooltip conflicts where native and custom tooltips would both appear.

## Tests

- **Before:** 77 tests
- **After:** 77 tests (all passing)
- **New/modified tests:** None — tooltip component is purely presentational with delegated DOM events, not testable in the headless VM harness.

## Notes

- The tooltip does not currently handle touch/mobile — it relies on mouseenter/mouseleave. Mobile users won't see tooltips, which is acceptable since the step-panel details provide the same information.
- Arrow positioning uses a simple left-offset calculation. For very narrow elements near the screen edge, the arrow may not perfectly center — but it stays within bounds.
