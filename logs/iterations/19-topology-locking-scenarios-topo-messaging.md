# Topology Locking, Scenarios Panel & Topology-Aware Messaging

**ID:** 19
**Date:** 2026-04-08
**Status:** Complete

---

## Description

Major iteration combining five interconnected changes: (1) topology locking during in-flight operations eliminates mid-operation state complexity, (2) scenarios panel with grouped suggested configurations, (3) topology-aware step messaging via `topo` context object, (4) CAP trade-off and linearizable-specific error messaging, (5) debug label overlay for UI communication.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Removed ~80 lines of guard code (`guardRun`, `guardRunAlive`, `primaryUnavailableStep`, `_guardAbort`, `endAsyncWork`). Removed dead code (`resolveW`, `canAchieve`). Added `topo` context object computed once at `createWriteMachine()` start — `{ reachable, total, primaryPartitioned, allHealthy }`. `topoNote` derived from it and passed to `TEXTS.write.ack`, `replComplete`, `fireForget`. Linearizable return step uses dynamic getters for title/explain based on `readClient.phase`. `readClient.errorReason = 'linearizable'` set on blocked linearizable reads. `readPrefLabel` now delegates to `TEXTS.readPrefLabel`. |
| `js/texts.js` | Added `TEXTS.topoNote(topo)` — generates topology warning suffix. Added `TEXTS.readPrefLabel` lookup table. Added `TEXTS.scenarios` array with two groups (4 resilience + 4 risk scenarios). Added `canvasTips.lockBanner` tooltip text. Added `consistency.readLinearizableBlocked()`. Added `read.linearizableBlocked` step text. Updated `write.ack` — w:1 includes PA/CAP note + accepts `topoNote`. Updated `write.wcUnsatisfied` — w:majority includes CP/CAP note + step-down timing. Updated `write.replComplete` — topology-aware suffix when degraded. Updated `write.fireForget` — accepts `topoNote`. |
| `js/app.js` | Added `isAnyEngineActive()` — blocks topology clicks during operations. Added `handleCanvasClick` guard for locked topology. Added cursor `not-allowed` for locked elements, `help` for lock banner. Added `applyScenario()` and `initScenarios()` for scenario panel rendering with group headers. Added `resetScenario()` fix: clears `eng.aborted = false` after full teardown. Added `readClient.errorReason = null` in `resetReadVisual()`. Added debug overlay: `toggleDebugLabels()`, `createDomBadges()`, `removeDomBadges()` with `#dbg-overlay` container using `getBoundingClientRect()`. |
| `js/draw.js` | Added `drawLockHint()` — amber banner at canvas bottom during active operations. Added `_lockBannerBounds` for hit-test detection. Added `lockBanner` hit type in `hitTest()`. Added `drawDebugLabels()` — hot-pink badges for all canvas regions (nodes, clients, links, MEM/DISK, docLedger, rsBox, lockBanner). Canvas layout shifted down 20px (`topY` 40→60, `priY` 185→205, `secY` 310→330). Updated `updateConsistencyViews` for linearizable-specific error via `readClient.errorReason`. |
| `js/engine.js` | Fixed `resetEngine` race condition — `eng.aborted` stays `true` so async loop terminates. Force election button centered with `translateX(-50%)`. |
| `css/style.css` | Canvas height 460→530px. Added scenarios panel styles (`.scenario-group-hdr`, `.scenario-grid`, `.scenario-item`, etc.). Added debug overlay styles (`#dbg-overlay`, `.dbg-badge`, `#btn-debug`). Added `#event-log` styles (renamed from `#log`). |
| `index.html` | Added scenarios panel `<details>` with `<div id="scenarios-list">`. Added `<button id="btn-debug">` in footer. Added IDs `topo-bar`, `topo-hint`. Renamed IDs: `writer-consistency`→`write-status`, `reader-consistency`→`read-status`, `w-default-badge`→`w-default-pill`, `step-card`→`step-panels-card`, `snapshot-session-actions`→`session-actions`, `write-step-dots`→`write-progress-dots`, `read-step-dots`→`read-progress-dots`, `log`→`event-log`. |
| `js/logger.js` | Updated `getElementById('log')` → `getElementById('event-log')`. |
| `docs/architecture.md` | Updated with topology locking, topo-aware messaging, scenarios panel, debug overlay, CAP messaging docs. |
| `docs/correctness.md` | Added 3 correct behaviors (topo-aware messaging, CAP trade-offs, linearizable-specific error). Updated summary counts. |
| `.cursor/rules/tcp-project.mdc` | Fixed file load order to match actual HTML: `theme.js → state.js → logger.js → icons.js → texts.js → draw.js → engine.js → simulation.js → app.js`. |

### Key Decisions

- **Topology locking over dynamic guards:** Blocking UI changes during operations eliminates the combinatorial explosion of mid-operation state transitions. The write machine stays a clean lazy generator — topology is stable throughout. All guard functions removed (~80 lines).
- **`topo` context computed once:** Since topology is locked, a single assessment at machine creation is sufficient. No scattered if/else checks. The `topoNote` pattern mirrors the existing `defaultNote` — a conditional suffix appended to key step texts.
- **Scenarios grouped by narrative:** "Defaults under pressure" (4 resilience scenarios) comes first — showing MongoDB defaults hold up under stress. "Lowering the guardrails" (4 risk scenarios) follows — clearly labeled as opt-in risk. This avoids the "9 doom cases" framing.
- **Debug overlay via `getBoundingClientRect()`:** All badges positioned absolutely in a single overlay container. Avoids issues with `<select>` children and `overflow: hidden` containers. Canvas regions labeled by a dedicated `drawDebugLabels()` pass.
- **ID rename for clarity:** `writer-consistency`→`write-status`, `log`→`event-log`, etc. Makes debug labels self-documenting and improves code readability.
- **Reset race condition fix:** `resetEngine()` keeps `eng.aborted = true` for the async loop. `resetScenario()` explicitly clears it after full teardown — safe because no async loop can be running.

## Tests

- **Before:** 116 tests
- **After:** 116 tests (no new test files; changes are UI/text layer)
- **All passing**

## Notes

- `updateConsistencyViews` still called from `draw()` — runs every frame during animation. Moving it to step transitions only is a known improvement item.
- `readPrefLabel` kept as a thin wrapper in `simulation.js` delegating to `TEXTS.readPrefLabel` — avoids changing all call sites.
- Dead code removed: `resolveW()`, `canAchieve()` (unused since topology locking made pre-checks unnecessary).
