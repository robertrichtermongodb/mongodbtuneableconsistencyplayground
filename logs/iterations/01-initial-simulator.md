# Initial Simulator

**ID:** 01
**Date:** 2026-03 (reconstructed)
**Status:** Complete

---

## Description

Built the base MongoDB read/write concerns playground as a single-page application. A 3-node replica set (Primary + 2 Secondaries) rendered on a canvas, with interactive controls for write concerns (w:0 through w:3, w:majority), read concerns (local, available, majority, linearizable, snapshot), read preferences, and manual fault injection (node kill, link partition).

## What Changed

### Files

| File | Change |
|------|--------|
| `index.html` | Page layout: header, config panels, step panels, canvas stage, event log, footer |
| `css/style.css` | All styling extracted from inline `<style>` — dark theme, panel layout, step UI |
| `js/state.js` | Shared state object, doc helpers (`resetDoc`, `advanceMajorityCommit`, `resolveReadTarget`), link model |
| `js/logger.js` | `log()` function separated to break circular dependency |
| `js/icons.js` | SVG Path2D constants for leaf and replica set icons |
| `js/draw.js` | Canvas rendering: nodes, links, clients, particles, doc ledger, hit testing, layout |
| `js/engine.js` | Step engine pattern: `waitForClick`, `syncButtons`, `showStepPanel`, auto-finish |
| `js/simulation.js` | `buildWriteSteps()` (static), `buildReadSteps()`, `buildElectionSteps()` |
| `js/app.js` | Event listeners, canvas interaction (node/link toggle), popup logic, init |
| `package.json` | `npm test` script (added later with testing framework) |

### Key Decisions

- No build step — static HTML deployable to GitHub Pages
- Global scope via `<script>` tags (no ES modules) for simplicity
- Canvas-based rendering for smooth particle animations
- Step-by-step pedagogy: user clicks "Next" to advance each operation phase
- Single document model (`doc #1`) — enough to demonstrate all concern behaviors

## Tests

- **Before:** 0 tests
- **After:** 0 tests (testing added in iteration 04)

## Notes

- The original `buildWriteSteps()` was a static step array — this became a problem when topology changes mid-operation were needed (fixed in iteration 03)
- Welcome and WIP popups use localStorage for first-visit tracking
- Election was a 2-step simplified RAFT (campaign + elected) with a tooltip explaining full RAFT
