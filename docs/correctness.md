# Correctness Assessment — MongoDB Concerns Playground

*Last updated 2026-03-15 against the official MongoDB documentation (MongoDB 8.0). Reflects Iteration 18 (Refinement 3).*
*Reference sources: `docs/research.md`, `docs/mongodb-read-write-concerns.md`.*

This document separates simulation behaviors into four categories:

- **Correct** — matches documented MongoDB behavior
- **Incorrect** — objectively wrong against official docs (fix required)
- **Imprecise** — simplified for pedagogy but not wrong (acceptable)
- **Missing** — real MongoDB behavior not modeled at all

---

## 1. CORRECT — Matches MongoDB behavior

### Write concerns

| Behavior | Where | Notes |
|---|---|---|
| w:0 — no ACK, async replication | `createWriteMachine` in simulation.js | Fire-and-forget, client returns immediately. |
| w:0 + j:true — demoted to w:1 | `createWriteMachine` in simulation.js | Guard at top of machine overrides w to 1. |
| w:1 — primary-only ACK before replication | `createWriteMachine` | `secsNeeded=0`, ACK after primary applies. |
| w:2 — primary + 1 secondary before ACK | `createWriteMachine` | `secsNeeded=1`, one required, one async. |
| w:3 — all 3 nodes before ACK | `createWriteMachine` | `secsNeeded=2`, both secondaries required. |
| w:majority — primary + 1 secondary (majority=2) | `createWriteMachine` | Matches majority calculation for 3-node P-S-S. |
| w:majority + j:false — fully durable on default config | `createWriteMachine` | Explain text notes `writeConcernMajorityJournalDefault:true` overrides client j. |
| Unachievable write concern blocks; write NOT rolled back | `createWriteMachine` | Explain text correctly describes wtimeout behavior. |
| Dynamic topology adaptation during write | `createWriteMachine` | Machine re-evaluates live node liveness and link state on each `nextStep()` call, retargeting surviving secondaries when a node crashes or partitions mid-replication. |
| Primary always journals before replication | `createWriteMachine` | Primary memory → journal → replication, regardless of j setting. For j:false, the ack counts on memory apply but the journal still happens before any secondary receives data. |
| j:false interleaves secondary journal per node | `createWriteMachine` | Each secondary completes memory apply + journal flush before the next secondary starts, avoiding misleading batch visualization. |
| Primary bounce detection (data loss) | `createWriteMachine` | `primaryHasData()` detects when a restarted primary lost unjournaled data. Handles both pre-ACK (write fails) and post-ACK (async work aborted, "Acknowledged but LOST" state). |
| "Acknowledged but LOST" UI state | `draw.js` | Detects `writeClient.phase === 'received' && ackCount === 0 && !committed` and displays explicit data-loss warning. |

### Read concerns

| Behavior | Where | Notes |
|---|---|---|
| rc:local returns node's current in-memory state | state.js `getServedVersion` | Returns `node.memoryVersion`, flags dirty if above `majorityCommitId`. |
| rc:available = rc:local on replica sets | state.js | Same code path. Correct per docs. |
| rc:majority returns majority-commit point (capped by node) | state.js | Returns `min(majorityCommitId, node.memoryVersion)` — a node can only serve data it has replicated. |
| rc:majority frozen when commit point can't advance | simulation.js | Detects `<2 reachable nodes`, returns frozen value. |
| rc:majority frozen reads are stale but rollback-safe | simulation.js | Explain text distinguishes causal vs non-causal. |
| rc:linearizable forces primary regardless of readPreference | state.js `resolveReadTarget` | Hardcoded `return pk`. |
| rc:linearizable — primary confirms leadership before serving | simulation.js | Pings secondaries and waits for acks. Runtime topology evaluation. |
| rc:linearizable blocks when majority unreachable (runtime) | simulation.js | Majority check evaluated at step execution time, not build time. |
| rc:linearizable returns fresh majorityCommitId at data-return time | simulation.js | `getServedVersion` called in `run()`, not at step-build time. |
| rc:linearizable skips particles to dead secondaries | simulation.js | `alive` guard before ping/ack particle dispatch. |
| rc:snapshot returns point-in-time majority-committed data | simulation.js | Returns `majorityCommitId` at time of read. |
| rc:snapshot session locks a fixed point-in-time view | app.js | `sessionSnapshotId` captured once, reused on subsequent reads. |
| Dirty read flagging (nodeVersion > majorityCommitId) | state.js, simulation.js | Correctly identifies the dirty read condition. |

### Read preferences

| Behavior | Where | Notes |
|---|---|---|
| primary — only primary, null if dead | state.js `resolveReadTarget` | Correct. |
| primaryPreferred — primary, fall back to secondary | state.js | Correct. |
| secondary — only secondaries | state.js | Correct. |
| secondaryPreferred — secondary, fall back to primary | state.js | Correct. |

### Election

| Behavior | Where | Notes |
|---|---|---|
| Election requires majority of voting members (2 of 3) | simulation.js `buildElectionSteps` | Checks `totalAlive >= majorityNeeded`. |
| Winner = node with most up-to-date oplog | simulation.js | Sorts by `memoryVersion` descending. |
| Uncommitted writes rolled back on election | simulation.js | Versions above `majorityCommitId` removed. |
| Snapshot session invalidated if locked version rolled back | simulation.js | Session cleared if `sessionSnapshotId > majorityCommitId`. |

### Storage layer model (memory vs journal)

| Behavior | Where | Notes |
|---|---|---|
| Write applied to memory first, then journal | `createWriteMachine` | Two-step: `memoryVersion` set, then `journalVersion` via `journalFlush()`. |
| j:true gates ack on journal flush | `createWriteMachine` | `ackNeedsJournal` flag controls when `ackedBy.add()` happens. |
| w:majority gates ack on journal (default config) | `createWriteMachine` | `writeConcernMajorityJournalDefault:true` modeled: journal required for majority ack. |
| j:false acks on memory apply (fast path) | `createWriteMachine` | Ack counted immediately on `memoryVersion` set. |
| Crash wipes memory, preserves journal | state.js `crashNode` | `memoryVersion = 0`, `journalVersion` unchanged. |
| Crash before journal flush loses unjournaled writes | state.js `crashNode` | Acks above `journalVersion` retracted, `majorityCommitId` recomputed. |
| Recovery from journal on restart | state.js `recoverNode` | `memoryVersion = journalVersion`. |
| Node enters recovering phase on restart | app.js | 600ms `recovering` phase before returning to idle. |

### Other

| Behavior | Where | Notes |
|---|---|---|
| Majority-commit is cumulative (vN committed implies all prior) | state.js `advanceMajorityCommit` | Scans backward, stops at first qualifying. |
| Client disconnect aborts write engine cleanly | app.js canvas click handler | Engine aborted; no remaining steps execute. Server-side replication that was *already applied* to node state persists. |
| Failed write rolls back `latestId` and version entry | simulation.js `failWrite` | Prevents stale UI state (e.g., "Update" button when no doc exists). |
| Reads don't change node write-state colors | simulation.js `buildReadSteps` | Read operations don't mutate node phases — node colors reflect write concern state only. |
| All user-facing texts centralized | texts.js | Single source of truth for all step titles, explains, tooltips, and consistency views. |
| Split-brain: w:1 succeeds on partitioned primary | simulation.js | Partitioned primary has `reachableCount=1 >= 1`, write succeeds locally. |
| Split-brain: w:majority fails on partitioned primary | simulation.js | Partitioned primary has `reachableCount=1 < 2`, cannot achieve write concern. |
| Split-brain: partition-aware election in secondary majority | simulation.js | `buildElectionSteps({ forcePartition: true })` uses `getPartition()` to find majority partition among connected secondaries. |
| Split-brain: old primary steps down instantly on force election | simulation.js | Old primary becomes a secondary; writes route to new primary. No "danger zone" stale writes — simplified for pedagogical clarity. |
| Split-brain: isolated nodes detected dynamically | state.js, draw.js | `isNodeIsolated()` checks if a node can reach the primary. Isolated nodes get amber dashed ring + "(isolated)" label. |
| Split-brain: partition healing caps versions | app.js | `checkPartitionHealed()` caps reconnected node versions to majority-committed level, logs healing. |
| Triangle topology with S1↔S2 link | state.js, draw.js | All 3 inter-node links modeled (`ps1`, `ps2`, `s1s2`); triangle layout. S1↔S2 visually distinct (thinner, shorter dash) with "heartbeat only" tooltip. |
| Secondary↔secondary link visual is role-based | draw.js | `isSecSec` checks `aKey !== primaryKey && bKey !== primaryKey`, not link key — correct after election when roles swap. |
| Client targeting: manual node selection | state.js, app.js | Click client circle to cycle `targetNode` through all nodes. `effectiveWriteTarget` and `resolveReadTarget` respect override. |
| Client targeting: NotWritablePrimary error | simulation.js | Writing to a non-primary target produces clear error with MongoDB error name. |

---

## 2. INCORRECT — Fixed

### ~~I1. `w:0 + j:true` not demoted to `w:1`~~ ✅ Fixed

**Problem:** When `w:0` and `j:true`, the simulator showed "Fire-and-forget — no ACK." Per the docs, `w:0 + j:true` demotes to `w:1` — the primary acknowledges after journal flush.

**Fix:** Added a guard at the top of `createWriteMachine`: when `w === 0 && j`, override `w` to `1` with a log message. The w:1 flow handles it from there.

**File:** `simulation.js`, `createWriteMachine` function.

---

### ~~I2. `w:majority + j:false` explain text implied fragility on default config~~ ✅ Fixed

**Problem:** The ACK step text said "j:false means a majority crash before journal flush could lose this write." On a default config with `writeConcernMajorityJournalDefault:true`, the server overrides j:false — the write is still fully durable.

**Fix:** Changed the ACK text to always say "Fully durable" for `w:majority`, with an italic note when `j:false` explaining the server default override.

**File:** `simulation.js`, ACK step generated by `createWriteMachine`.

---

### ~~I3. Election succeeded with only 1 alive node out of 3~~ ✅ Fixed

**Problem:** `buildElectionSteps` allowed election with `candidates.length > 0` (1 alive secondary). RAFT requires a majority — 2 of 3 voting members.

**Fix:** Added `totalAlive >= majorityNeeded` check (where `majorityNeeded = floor(N/2)+1 = 2`). Election fails with an explanatory error step when quorum isn't met. Also updated `syncButtons()` to hide the canvas election button when quorum is insufficient.

**Files:** `simulation.js` in `buildElectionSteps`, `engine.js` in `syncButtons`.

---

### ~~I4. Static step array didn't adapt to topology changes during write~~ ✅ Superseded

**Problem:** The old `buildWriteSteps()` function pre-computed an ordered list of steps before the write started. If a secondary crashed mid-replication, the pre-built steps would still target it.

**Fix (Iteration 18):** Replaced with `createWriteMachine()` — a lazy step generator with mid-operation liveness guards.

**Superseded (Iteration 19):** Topology is now locked while any engine is active. The UI (`isAnyEngineActive()` in `app.js`) blocks node/link/client-link clicks during operations, so mid-operation topology changes cannot occur. All runtime guard code (`guardRun`, `guardRunAlive`, `primaryUnavailableStep`, `_guardAbort`, `endAsyncWork`) was removed. Users configure topology *before* starting an operation.

**File:** `simulation.js` (`createWriteMachine`), `app.js` (`isAnyEngineActive`, `handleCanvasClick`).

---

### ~~I5. rc:linearizable used stale topology and served values~~ ✅ Fixed

**Problem:** `buildReadSteps` for rc:linearizable pre-computed `liveSecs`, `majorityOk`, and `served` at step-build time. If secondaries died between step-build and execution, the leadership check would still "succeed" using stale topology. The data-return step also used the build-time `majorityCommitId`, so a write completing during the leadership check would not be reflected in the result.

**Fix:** Moved all three evaluations into the step `run()` functions:
1. `liveSecs` is computed at runtime in the leadership ping step; dead nodes are skipped.
2. `majorityOk` is re-evaluated at runtime in the leadership evaluation step; sets error if <2 reachable.
3. `served` is computed at runtime in the data-return step via `getServedVersion()`.
4. Data-return step checks `readClient.phase === 'error'` and skips if leadership was blocked.

**Files:** `simulation.js` (linearizable section + data-return step in `buildReadSteps`).

---

### I6. `resolveReadTarget` ignores reader network reachability — Known limitation

**Status:** Not fixed. Acknowledged as a model simplification.

**Problem:** `resolveReadTarget` checks `node.alive` but not whether the reader can reach the specific node. The reader connection is modeled as a single `rp` boolean, not per-node.

**Why deferred:** The `!state.links.rp` guard at the top of `buildReadSteps` catches total disconnection. Making this fully correct requires per-node reader links, which is a larger design change.

### ~~I7. Failed write left stale `latestId` and orphan version entry~~ ✅ Fixed

**Problem:** The send step optimistically set `state.doc.latestId = nextId` and pushed a version entry. If the write subsequently failed (primary crash), these were never rolled back — causing the UI to show "Update" instead of "New doc".

**Fix:** Added rollback logic to `failWrite()` that removes the version entry and reverts `latestId` when a write errors out. (The `guardRun` wrapper was removed in Iteration 19; `failWrite` still handles rollback for pre-existing topology errors like writer disconnected or target-not-primary.)

**File:** `simulation.js` (`failWrite`).

---

## 3. IMPRECISE — Simplified but not wrong

| # | What | Simulator | MongoDB | Why acceptable |
|---|---|---|---|---|
| P1 | Replication direction | Primary pushes to secondaries | Secondaries pull from primary's oplog | Same outcome; push is easier to visualize |
| P2 | Replication parallelism | Required secondaries replicate sequentially | Oplog tailing is parallel | Sequential is necessary for step-by-step pedagogy |
| P3 | j:true mechanism | Two-step model: memory apply → journal flush, with ack gated on flush | Each counted node flushes journal before its ack counts | Now visually distinct: separate memory and journal steps per node |
| P4 | Majority-commit tracking | Single global `majorityCommitId` | Each node tracks its own majority-commit view | Global value is correct for primary; secondary lag is not modeled |
| P5 | Election rollback scope | All nodes capped to `majorityCommitId` | Only old primary rolls back when it rejoins | End result is correct for the educational narrative |
| P6 | rc:linearizable mechanism | Ping/ack round-trip to secondaries | No-op write with w:majority | Same outcome: confirms primary can still achieve majority |
| P7 | rc:linearizable single-doc restriction | Not enforced | Must uniquely identify one document | Only one document exists in the simulator |
| P8 | Oplog ack vs query visibility | Ack and visibility simultaneous | MongoDB 8.0+: oplog ack durable, collection apply async | Hard to show in a single-doc model |
| P9 | Snapshot timestamps | Integer version IDs | `atClusterTime` oplog timestamps | Functionally equivalent for single-doc model |
| P10 | Election trigger | Manual (user clicks button) | Automatic after `electionTimeoutMillis` (10s default) | Acceptable for step-by-step pedagogy |
| P11 | Reader network model | Single `rp` boolean for all nodes | Per-node connectivity from the client | See I5; simplification of the model |

---

## 4. MISSING — Not modeled

| # | Feature | MongoDB behavior | Impact on educational value |
|---|---|---|---|
| M1 | **Primary auto-step-down** | Isolated primary steps down automatically | Partially modeled: force election + reconciliation simulates the effect, but step-down is manual (user triggers it) rather than automatic. |
| M2 | **Retryable writes** | Drivers auto-retry with unique txn IDs | Central to "zero missed operations" HA story |
| M3 | **wtimeout** | Configurable timeout; returns error without rollback | Simulator models blocking but has no timeout control |
| M4 | **Causal consistency sessions** | `afterClusterTime` ensures monotonic reads, read-your-own-writes | Key for reading from secondaries safely |
| M5 | **readPreference: nearest** | Routes to lowest-latency member | Not in dropdown |
| M6 | **readPreference tag sets** | Route reads by tag criteria | Out of scope for 3-node sim |
| M7 | **Oplog/collection apply gap (8.0+)** | Secondary may ack oplog before applying to collections | Would need two-phase secondary model |
| M8 | **writeConcernMajorityJournalDefault toggle** | Controls whether w:majority implies journaling | Simulator hardcodes the default (true) |
| M9 | **Old primary rejoin as secondary** | Old primary rolls back, syncs, rejoins | Toggling old primary on doesn't trigger rollback/sync |
| M10 | **Reconfiguration (rs.reconfig)** | Changes voting membership for recovery | Not modeled |
| M11 | **Multi-document transactions** | Atomic operations across multiple documents | Single-doc only |
| M12 | **Arbiter nodes** | Non-data-bearing voting members | Fixed P-S-S topology |

---

## Summary

| Category | Count |
|---|---|
| Correct | ~51 behaviors (13 write concern + 13 read concern + 4 read preference + 4 election + 8 storage-layer + 9 split-brain/topology/targeting) |
| ~~Incorrect~~ Fixed | 7 of 8 (I6 deferred as known limitation) |
| Imprecise | 11 |
| Missing | 12 (M1 partially addressed) |
