# Bug Fixes — Rejoining Node Sync & Deferred Election Rollback

**ID:** 20
**Date:** 2026-04-09
**Status:** Complete

---

## Description

Two related correctness fixes for post-topology-change data synchronization. (1) Nodes that missed writes while down or partitioned now catch up via `syncRejoiningNode()` when they reconnect — previously they stayed at stale/empty state indefinitely. (2) Partition elections now only cap nodes in the winning partition; the isolated old primary retains its stale data until reconnection triggers a deferred rollback, matching real MongoDB behavior.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/state.js` | Added `syncRejoiningNode(nodeKey)` — oplog catch-up / rollback on rejoin. Syncs a secondary to the primary's `memoryVersion`: catches up if behind, caps down if stale post-election. Adds/removes acks from `doc.versions` entries and calls `advanceMajorityCommit()`. Guards: skips if nodeKey is primary, if primary is dead, if node is dead, or if node is isolated from primary (via `isNodeIsolated()`). |
| `js/simulation.js` | `buildElectionSteps` "elected" step: replaced `Object.values(state.nodes).forEach(...)` blanket cap with `getPartition(winner)` scoped cap — only nodes in the winning partition have `memoryVersion`/`journalVersion` clamped to `majorityCommitId`. Isolated old primary retains stale data. Updated rollback log message to distinguish deferred rollback ("retains stale data until it reconnects") from immediate rollback. |
| `js/app.js` | Node restart handler: calls `syncRejoiningNode(hit.key)` after `recoverNode(hit.key)`. Log message shows actual caught-up version. `checkPartitionHealed()`: iterates all non-primary alive nodes, calls `syncRejoiningNode(k)` for each, logs healing only when `memoryVersion` actually changed. |
| `test/state.test.js` | Added 8 tests for `syncRejoiningNode`: catch-up after revival, w:0 catch-up (majorityCommitId=0 but primary has data), primary-dead guard, isolation guard (link down), caps-down stale data, idempotency, skip-self guard, post-election old-primary sync. |
| `test/election.test.js` | Added 3 tests for deferred rollback: old primary retains stale data after partition election, stale data rolled back on reconnection via `syncRejoiningNode`, winning-partition nodes capped but isolated node untouched. Renamed existing test to "caps winning-partition node versions" and narrowed assertion scope to alive nodes only. |
| `docs/architecture.md` | Updated iteration header (22). Added `syncRejoiningNode` to key helpers table. Updated election description with deferred rollback behavior. Test counts 127→130, election tests 15→18. |
| `docs/correctness.md` | Updated iteration header (22). P5 updated from "all nodes capped" to partition-scoped deferred rollback. M9 upgraded from "partially modeled" to "modeled". Split-brain election row updated to describe stale data retention. Updated summary counts. |
| `index.html` | Footer timestamp updated. |

### Key Decisions

- **Sync target = `primary.memoryVersion`, not `majorityCommitId`:** A secondary pulling from the primary's oplog gets everything the primary has, not just what's majority-committed. This correctly handles `w:0` and `w:1` writes where the primary has data but `majorityCommitId` is still 0. After syncing, `advanceMajorityCommit()` may advance the commit point now that more nodes hold the data.
- **`isNodeIsolated()` over `getPartition()` for sync guard:** `getPartition()` uses BFS and would consider s2 reachable via s1 (chained path). But the simulator doesn't model chained replication — a secondary must have a direct link to the primary. `isNodeIsolated()` checks exactly this.
- **Deferred rollback over eager global cap:** Real MongoDB doesn't roll back an old primary's data on step-down — rollback happens when it reconnects to the new primary. The existing amber badge and "(isolated)" label on the old primary already convey "stale data pending rollback" without any UI additions.
- **Version entries still pruned globally:** `state.doc.versions` is filtered to `<= majorityCommitId` during election (global cluster record). The old primary's node-level `memoryVersion`/`journalVersion` retain the stale value. On reconnection, `syncRejoiningNode` clamps the node down and the version entries are already gone — no dangling ack references.

## Tests

- **Before:** 119 tests
- **After:** 130 tests
- **New tests (11):**
  - `syncRejoiningNode` — 8 tests in `state.test.js` (catch-up, w:0 scenario, primary-dead guard, isolation guard, caps-down, idempotency, skip-self, post-election sync)
  - Deferred rollback — 3 tests in `election.test.js` (stale retention, reconnection rollback, partition-scoped capping)

## Notes

- The `syncRejoiningNode` function is called in two places: node restart (click to revive) and link restoration (`checkPartitionHealed`). Both paths use the same sync logic.
- For dead-primary elections (non-partition), the dead primary's `memoryVersion` was already wiped by `crashNode()`. The partition-scoping is effectively a no-op here since the dead primary isn't in `getPartition(winner)` anyway.
- The w:0 scenario was the key edge case: fire-and-forget writes don't advance `majorityCommitId`, so syncing to `majorityCommitId` would leave rejoining nodes at v0. Syncing to `primary.memoryVersion` fixes this and is how real oplog tailing works.
