# Phase-Based Progress Trail

**ID:** 05
**Date:** 2026-04 (reconstructed)
**Status:** Complete

---

## Description

Replaced the "Step X of Y+" badge for write operations with a semantic phase-based progress trail (breadcrumb UI). Since the write state machine generates steps dynamically, a fixed step count is misleading. The new trail shows meaningful phases: Send, Primary, Repl 1/2, ACK — each as a pill with done/active/pending/error state.

## What Changed

### Files

| File | Change |
|------|--------|
| `index.html` | Added `<div class="phase-trail" id="write-phase-trail">` after the step-dots element in the write panel. |
| `css/style.css` | Added `.phase-trail`, `.phase-pill` (with `.done`, `.active`, `.pending`, `.error` states), `.phase-icon`, `.phase-sep`, and `@keyframes phase-pulse` animation. |
| `js/engine.js` | Added `PHASE_ICONS` constant and `renderPhaseTrail(eng)` function. Modified `showStepPanel` to detect write-panel + machine with `getProgress()` and render the phase trail instead of step dots/badge. |
| `js/simulation.js` | Added `getProgress()` method to `createWriteMachine` return object, exposing `phase`, `acked`, `replicated`, `memApplied`, `secsNeeded`, `totalSecs`, `w`, and `errored`. |

### Key Decisions

- Phase pills rather than step dots — semantically meaningful even when step count is unknown
- `buildPhases(eng)` maps machine progress to visual pill states based on write concern (different phase lists for w:0 vs w:1 vs w:majority)
- Read operations and elections keep the old "Step X of Y" badge since their step arrays are static and predictable

## Tests

- **Before:** ~74 tests
- **After:** ~74 tests (UI-only change, no simulation logic affected)

## Notes

- The phase trail is purely cosmetic — it reads from `getProgress()` but does not influence simulation behavior
- Active pill has a pulse animation for visual feedback
