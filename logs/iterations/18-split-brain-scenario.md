# Split-Brain Scenario Simulation

**ID:** 18
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Added triangle replica set topology with S1↔S2 link, enabling network partition scenarios that demonstrate split-brain: primary isolation, forced election among the secondary majority, stale-primary writes (w:1 succeeds, w:majority blocks), and reconciliation rollback when the partition heals.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/state.js` | Added `s1s2` link, `writeTarget` field, `stalePrimary` per-node flag. New helpers: `effectiveWriteTarget()`, `getPartition()` (BFS), `isPrimaryPartitioned()`. Updated `getLinkBetween` for s1↔s2, `resetLinks` and `resetDoc` for new fields. `isReachableForWrite` now checks from `effectiveWriteTarget()`. |
| `js/simulation.js` | `buildElectionSteps` accepts `{ forcePartition: true }` option — finds majority partition excluding primary, sets `writeTarget` and `stalePrimary` on election. `createWriteMachine` uses `effectiveWriteTarget()` throughout instead of `state.primaryKey` for all primary references. |
| `js/draw.js` | Triangle `computeLayout` (primary at top, secondaries at bottom). `drawReplicationLinks` draws all 3 inter-node links. `hitTest` detects clicks on S1↔S2 segment. `drawNode` shows amber dashed ring and amber leaf for stale primaries. `drawWriteClientLine` targets `effectiveWriteTarget()`. `drawRSBox` dynamically computes bounds from all node positions. |
| `js/engine.js` | `syncButtons` shows/hides "Force Election (partition)" button between S1/S2 when primary is partitioned. |
| `js/app.js` | Link click handler updated for link-key-based toggling (ps1/ps2/s1s2). Added `handleForceElection()` and `reconcileSplitBrain()` — reconciliation rolls back stale writes, resets labels, clears `writeTarget` when partition heals. |
| `css/style.css` | Canvas height increased to 460px. Added `.canvas-force-election-btn` styling (amber theme). |
| `index.html` | Added `<button id="btn-canvas-force-election">` element. |
| `test/helpers.js` | `resetState` clears `writeTarget` and `stalePrimary`. |
| `test/state.test.js` | +13 tests: `getLinkBetween` s1↔s2, `getPartition` (5 scenarios), `isPrimaryPartitioned` (3 scenarios), `effectiveWriteTarget` (2 scenarios). |
| `test/election.test.js` | +6 tests: split-brain election success/failure, winner selection by memoryVersion, writeTarget set, stalePrimary flag, stale label. |
| `test/machine.test.js` | +4 tests: partitioned primary w:1 succeeds, w:majority fails, stale primary post-election w:1 succeeds, w:majority fails. |
| `docs/architecture.md` | Updated state model, helper table, election docs, layout diagram, test counts, bug tracker (B5/B7 fixed). |
| `docs/correctness.md` | Added 6 correct split-brain behaviors, updated M1 (partially addressed), updated summary counts. |

### Key Decisions

- **`state.writeTarget` for stale-primary writes**: After split-brain election, `state.primaryKey` changes to the new winner but `state.writeTarget` keeps the write client connected to the old (now stale) primary. All write machine references use `effectiveWriteTarget()` which returns `writeTarget || primaryKey`.
- **Triangle layout**: Primary at top (y=185), secondaries at bottom corners (y=310). This visually enables the S1↔S2 link and makes partition scenarios intuitive — cut both diagonal links to isolate the primary.
- **Force election is manual**: In real MongoDB, the secondaries would auto-elect after `electionTimeoutMillis`. Here, a "Force Election" button appears contextually between S1/S2. This matches the pedagogical step-by-step approach.
- **Reconciliation on link restore**: When any partitioned link is restored while `writeTarget` is set, the split-brain resolves immediately — stale writes rolled back, labels reset, write client discovers the new primary.
- **TDD approach**: All 23 new tests written before implementation. Tests fail → implement → tests pass.

## Tests

- **Before:** 85 tests
- **After:** 108 tests (+23)
- **New tests:**
  - `state.test.js`: getLinkBetween s1↔s2 (3), getPartition (5), isPrimaryPartitioned (3), effectiveWriteTarget (2)
  - `election.test.js`: split-brain election (6)
  - `machine.test.js`: partitioned/stale primary writes (4)

## Refinement (same iteration, later pass)

Replaced `stalePrimary` flag and `writeTarget` field with a cleaner model:

- **Instant step-down:** Force election now makes the old primary a secondary immediately. No "stale primary" state where writes still succeed.
- **Dynamic isolation detection:** New `isNodeIsolated(nodeKey)` helper in `state.js` dynamically detects any node that can't reach the current primary. Replaces the per-node `stalePrimary` boolean.
- **S1↔S2 link visual:** Thinner line with shorter dash pattern + muted color. Hover tooltip reads "Heartbeat only — no replication" (chained replication excluded from simulator).
- **Partition healing:** `checkPartitionHealed()` replaces `reconcileSplitBrain()`. No rollback needed (no stale writes accepted). Simply caps reconnected node versions and logs healing.
- **Test updates:** Removed `stalePrimary`/`writeTarget` assertions. Added `isNodeIsolated` tests (+6). Updated post-force-election write tests: writes now succeed on new primary (w:1 and w:majority).
- **Test count:** 113 tests total (was 108).

## Refinement 2: Client targeting + link visual fix

- **Bug fix: S1↔S2 link visual after election.** `isSecSec` was hardcoded to `lk === 's1s2'`. After election (e.g., S1 becomes primary), the old ps1 link is now secondary↔secondary but still looked like a replication link. Fixed to check `aKey !== primaryKey && bKey !== primaryKey` (role-based).
- **Client targeting:** Click (without drag) on a client circle cycles `targetNode` through `null → primary → s1 → s2 → null`. Target label shown below client circle in purple.
  - `effectiveWriteTarget()` returns `writeClient.targetNode || primaryKey`
  - `resolveReadTarget()` returns `readClient.targetNode` if set, else normal readPref logic
  - Writing to a non-primary target produces `NotWritablePrimary` error
  - Writing to a down target produces "node is down" error
  - Reset scenario and UI-reset both clear targeting
- **Test count:** 122 tests total (was 113). +5 state tests (effectiveWriteTarget override, resolveReadTarget manual targeting), +4 machine tests (write-to-secondary error, write-to-primary succeeds, write-to-down-target error).

## Refinement 3: Canvas tooltips + interaction hints

- **Canvas hover tooltips:** Added native `canvas.title` tooltips for all interactive canvas elements (nodes, links, clients, client connection lines). Tooltip texts centralized in `TEXTS.canvasTips` in `js/texts.js`. `canvasTipFor()` helper in `app.js` maps the hover target to a tooltip string.
  - Nodes: label + click action (shut down / restart)
  - Links: endpoint labels + partition state + click action; S1↔S2 additionally notes "heartbeat only"
  - Client circles: current target, next-click target, drag hint
  - Client connection lines: connected/disconnected state + click action
- **Topo-bar instruction text updated:** Now reads "Click nodes to toggle health · Click links to partition · Click clients to pick target node · Drag clients to reposition"
- **No test changes** — UI-only; existing 122 tests still pass.

## Notes

- The force election button only appears when the primary is alive but partitioned
- Auto-step-down (M1) is not fully modeled — the user must manually trigger the force election
- Pedagogical simplification: no "danger zone" where w:1 writes briefly succeed on isolated primary before step-down
