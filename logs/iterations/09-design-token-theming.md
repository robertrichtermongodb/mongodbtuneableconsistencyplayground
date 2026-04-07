# Design Token System & Dark/Light Theme

**ID:** 09
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Extracted all hardcoded color values from CSS, Canvas rendering (draw.js), and simulation particle colors (simulation.js) into a centralized design token system. Added a dark/light theme toggle with localStorage persistence. This gives full control over contrasts, accents, and overall palette from a single source of truth — enabling easy theming and future design tuning.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/theme.js` | New file. Defines `THEMES.dark` and `THEMES.light` with ~100 semantic tokens each. Provides `T` (active theme object for canvas), `applyTheme()`, `toggleTheme()`. Auto-applies saved theme on load to prevent FOUC. |
| `css/style.css` | Replaced all ~50 hardcoded hex colors with `var(--token)` references. No color literal remains in CSS. |
| `js/draw.js` | Replaced all ~118 hardcoded hex colors with `T.xxx` references. Converted `PHASE_FILL`/`PHASE_STROKE` from static objects to `phaseFill()`/`phaseStroke()` functions that read from `T` at draw-time. |
| `js/simulation.js` | Replaced 11 particle color literals (`#F5A623`, `#4A90D9`, `#00ED64`, `#FF6B6B`, `#7EC8E3`, `#3D5570`) with `T.flowWrite`, `T.flowRepl`, `T.flowAck`, `T.flowErr`, `T.flowRead`, `T.flowDim`. |
| `index.html` | Added `theme.js` in `<head>` (before body scripts, prevents FOUC). Added theme toggle button (☀/☾) in topo-bar. Updated footer inline style to use `var(--footerBorder)`. |
| `js/app.js` | Added click handler for theme toggle button. |
| `test/helpers.js` | Added `theme.js` to VM source file load order. Added `document.documentElement` stub with `setAttribute` and `style.setProperty` no-ops. |

### Key Decisions

- **CSS custom properties set by JS, not CSS-only**: The `applyTheme()` function pushes all tokens to `document.documentElement.style` at runtime. This avoids duplication between CSS theme blocks and the JS theme object used by Canvas. One source of truth per theme.
- **theme.js loaded in `<head>`**: Runs before body parse, setting CSS vars before first paint. Avoids flash of unstyled content even for the light theme.
- **Semantic token naming**: Tokens are grouped by purpose (surfaces, borders, text, accents, canvas-specific). Canvas gets dedicated tokens (e.g., `T.linkDefault`, `T.phaseFill`) rather than reusing generic CSS tokens — keeps canvas and CSS concerns separate.
- **Light theme palette tuned for readability**: Accent colors darkened for white backgrounds (e.g., green `#00ED64` → `#00B850`, blue `#7EC8E3` → `#2090C0`). Canvas surfaces use warm grays for contrast.

## Tests

- **Before:** 77 tests
- **After:** 77 tests (all passing)
- **New/modified tests:** Updated `test/helpers.js` to load `theme.js` in VM context and stub `document.documentElement`. No new test cases — the theme system is purely visual and covered by existing integration tests that exercise simulation + draw stubs.

## Notes

- Light theme is a first pass — contrast ratios and accent shades may need tuning after visual review.
- The `color + '55'` pattern in `drawDocIconAt` for the fold highlight appends alpha to the hex color. This works for 6-digit hex but would break for rgb()/hsl() colors if tokens ever change format.
- Future: consider deriving alpha variants programmatically instead of separate tokens (e.g., `amberAlpha40`, `greenPillBg`).
