# Scenario Coverage Analysis
*How well the current simulator covers the HA scenarios from "High Availability — A Modern Roleplay Challenge"*

---

## Implementation Log

| Date | Change | Impact |
|---|---|---|
| 2026-03-15 | **Gap 1 implemented:** Node/link topology toggles no longer call `resetDoc()`. Document state (versions, `majorityCommitId`, per-node `docVersionId`, last read/written versions) is now preserved through node failures and network partitions. Only the explicit Reset ↺ button clears document state. | Scenarios 1, 2, 3 improved — dirty-read rollback and primary failure stories are now demonstrable step by step. |

---

## Coverage Summary Table

| # | Scenario | Coverage | Change |
|---|----------|----------|--------|
| 1 | Rollback: Weak Write & Read Concerns | 🟡 Partial ↑ | Dirty read + silent rollback (T3–T6) is now demonstrable; election still not simulated |
| 2 | Rollback: Strong Write & Read Concerns (Majority) | 🟡 Partial ↑ | Core insight (T2–T3) + primary failure with preserved state now work; retry chain still not simulated |
| 3 | Minority Node Failure | 🟡 Partial ↑ | Kill a node mid-operation and observe surviving node data; election still not modeled |
| 4 | Majority Node Failure — Partial Cluster Survives | 🟡 Partial | Write blocking and frozen majority reads covered; explicit read-only state and reconfiguration still absent |
| 5 | Total Data-Bearing Node Loss | 🔴 Minimal | All-nodes-dead state reachable; backup/restore out of scope |
| 6 | Chaos Test: 9-Node / 3-Region Replica Set | ❌ Not covered | Requires multi-region topology (architectural gap) |
| 7 | Chaos Test: Multi-Region, Multi-Primary Cluster | ❌ Not covered | Requires multiple independent replica sets (architectural gap) |
| 8 | Serving Global Audiences — Latency Comparison | ❌ Not covered | Requires geographic nodes and latency modeling (architectural gap) |

---

## Detailed Coverage per Scenario

---

### Scenario 1 — Rollback: Weak Write & Read Concerns

**Story summary:** App B writes with `w:1`, App A reads the dirty value with `rc:local`. Primary fails before replication. The write is rolled back silently — App A holds stale data and neither application is notified.

| Story Beat | Simulated? | How |
|---|---|---|
| T1: All nodes have same version | ✅ Yes | Fresh state after Reset |
| T2: Write with `w:1`, ACK returns before replication | ✅ Yes | Select `w:1`, fire write. ACK step completes immediately; secondaries have not received data yet. Writer overlay shows "Rollback risk if primary fails before majority." |
| T3: Read from primary with `rc:local` returns dirty in-flight value | ✅ Yes | While write engine is paused after primary applies (before async replication), issue a read with `rc:local`. Reader overlay shows "Dirty read — uncommitted." |
| T3 alt: Read from secondary with `rc:local` returns old stale value | ✅ Yes | Same timing, switch `readPref` to `secondary`. Secondary hasn't replicated yet, returns old version. |
| T4: Primary fails before replication completes | ✅ Yes | Kill primary via click. Doc state is now preserved. Ledger still shows `v1 in-flight` (latestId=1 > majorityCommitId=0). Primary fades to 22% opacity with its version badge still visible. |
| T5: Election, new primary, write rolled back | ❌ No | No election simulation. Secondaries are alive but the sim does not promote one to primary. Writes will show "no primary" error. |
| T6: Inconsistency is silent — App A unaware | ✅ Yes | Reader overlay still shows "Dirty read — got v1 ⚠" (lastReceivedVersion preserved). Secondary badges show docVersionId=0. A follow-up `rc:local` read from a secondary returns v0/none — confirming the rollback. The contrast between what the reader already received (v1) and what the surviving cluster holds (v0) is now visible side by side. |

**What CAN be shown today (improved):**
- Full T1→T4+T6 story in sequence: write `w:1`, read dirty value, kill primary, observe reader still holds "got v1 ⚠" while secondary badges show v0.
- The "silent inconsistency" moment — reader overlay and a secondary read side by side after the failure.

**What CANNOT be shown:**
- T5: automatic election and role promotion.
- Explicit "App A is unaware" framing (single-client model — the reader overlay is the closest proxy).

---

### Scenario 2 — Rollback: Strong Write & Read Concerns (Majority)

**Story summary:** Same setup but with `w:majority` + `rc:majority` + retryable writes. App A reads the old (safe) value. Primary fails. App B gets an exception and retries. Final state is correct.

| Story Beat | Simulated? | How |
|---|---|---|
| T1: All nodes have same version | ✅ Yes | Fresh state after Reset |
| T2: Write with `w:majority`, ACK withheld — data on primary only | ✅ Yes | Select `w:majority`, fire write, pause engine after "Primary applies" step. Writer overlay shows "In-flight — 1/2 majority." |
| T3: Read with `rc:majority` returns old committed value, NOT dirty value | ✅ Yes | While write engine is paused at this exact moment, fire a concurrent read with `rc:majority`. Reader returns v0 / no data — i.e., the last majority-committed state. This is the **core educational insight** and it works well. |
| T4: Primary fails before replication | ✅ Yes | Kill primary via click. Doc state is now preserved — writer overlay still shows "In-flight — 1/2 majority, rollback risk." Reader's prior result (v0, safe) is also preserved. Secondaries visually show their stale docVersionId=0 badges. |
| T5: Election, new primary | ❌ No | No election simulation. |
| T6: App B gets write exception | 🟡 Partial | Cut the writer connection (click write-client arrow) mid-flight instead. Engine aborts with "Write concern failed" in the overlay. Node failure without connection-cut does not trigger the write exception path, but the write engine resets and the writer overlay shows "In-flight" status retained. |
| T7: Driver retries write automatically | ❌ No | No retryable write simulation. The user must manually fire a new write. |
| T8: Write succeeds on new primary, majority ACK | 🟡 Partial | Doc state is now preserved, so a manual re-write (Update doc) correctly continues from v2 onwards on the surviving topology. Not automated. |

**What CAN be shown today (improved):**
- Full T2–T4 in sequence: write paused mid-replication, concurrent read returns safe v0, primary killed — doc state persists through the failure.
- The protective contrast: reader got v0 before failure, writer never got ACK → no bad data was observed, write can be retried.
- Manual retry of the write on the surviving topology (T8 equivalent).

**What CANNOT be shown:**
- T5: automatic election and role promotion.
- T7: automatic driver-level retry.
- The full 8-step story as a single uninterrupted walkthrough.

---

### Scenario 3 — Minority Node Failure

**Sub-case A: One secondary fails**

| Aspect | Simulated? | How |
|---|---|---|
| Kill one secondary | ✅ Yes | Click S1 or S2 node |
| Writes still succeed (primary + one surviving secondary = majority) | ✅ Yes | After killing S1, write with `w:majority` — replicates to surviving S2, ACK returned. |
| Reads still work from surviving nodes | ✅ Yes | Read with any rc from primary or surviving secondary. |
| Mid-write failure (kill secondary while replication step is in progress) | ✅ Yes | Click S1 or partition the link mid-step. Doc state is now preserved. Committed versions remain on surviving nodes. The write engine aborts but the ledger correctly reflects whatever was majority-committed before the failure. |
| Surviving nodes still have all committed data | ✅ Yes | Document badges reflect correct per-node versions, preserved through the failure. |

**Sub-case B: Primary fails (still a minority failure in 3-node set)**

| Aspect | Simulated? | How |
|---|---|---|
| Kill primary | ✅ Yes | Click Primary node |
| Automatic election of new primary | ❌ No | No election. After killing primary, the two secondaries are alive but the sim does not promote one to primary. Writing shows "no primary" error. |
| Zero downtime / zero data loss claim | ❌ No | Cannot demonstrate — election is required for writes to resume, and election is not modeled. |
| Surviving nodes retain majority-committed data | ✅ Yes | Doc state is now preserved on node toggle. Secondary badges continue to show their correct docVersionId after primary is killed. A read from a surviving secondary returns its version. |

---

### Scenario 4 — Majority of Electable Nodes Failure

**Setup: Kill 2 of 3 nodes, leaving only 1 alive.**

| Aspect | Simulated? | How |
|---|---|---|
| Kill 2 nodes | ✅ Yes | Click two nodes (or one node + one replication link) |
| Write blocked — w:majority unachievable | ✅ Yes | `buildWriteSteps` detects that needed acks exceed reachable nodes. Step panel shows "Write concern cannot be satisfied — w:majority needs 2 node(s), but only 1 reachable. MongoDB blocks until wtimeout fires." |
| The write IS on the primary, NOT rolled back | ✅ Yes | Step explanation explicitly states "the write is NOT rolled back — it is already on the primary." |
| rc:local read from surviving node returns latest local data | ✅ Yes | Secondary with rc:local returns its version. |
| rc:majority read from surviving node returns frozen snapshot | ✅ Yes | `buildReadSteps` detects `!majorityOk` and shows "Majority-commit point is frozen" — the surviving node returns the last known majority-commit value. |
| Cluster enters "read-only state" label/visual | ❌ No | No explicit cluster-level "read-only" indicator. The behavior is correct but there is no summary label on the canvas. |
| Reconfiguration command concept | ❌ No | No simulation of `rs.reconfigForceAsCurrentConfig()` or equivalent. |
| Recovery to fully operational | ❌ No | Bringing nodes back online is possible (click dead node again), but there is no election/catch-up simulation. |

---

### Scenario 5 — Total Data-Bearing Node Loss

| Aspect | Simulated? | How |
|---|---|---|
| Kill all 3 nodes | ✅ Yes | Click all three nodes |
| Writes fail (no primary) | ✅ Yes | Write engine shows error immediately |
| Reads fail (no eligible node) | ✅ Yes | Read engine shows "No eligible node — read fails" |
| Backup restore concept | ❌ No | Entirely out of scope. The simulator has no backup layer, no PITR, no restore flow. |

---

### Scenario 6 — Chaos Test: 9-Node / 3-Region Replica Set

| Aspect | Simulated? |
|---|---|
| 9-node topology | ❌ Fixed at 3 nodes |
| Multi-region / zone-aware distribution | ❌ No geographic concept |
| Datacenter-level failure | ❌ Only individual node / link failures |
| 255 auto-resolvable disaster scenarios | ❌ Not enumerable in this sim |

**Verdict: Not covered.** This scenario is out of scope for the current 3-node, single-region architecture.

---

### Scenario 7 — Chaos Test: Multi-Region, Multi-Primary Cluster

| Aspect | Simulated? |
|---|---|
| Multiple independent replica sets | ❌ Single replica set only |
| Per-replica-set independent failover | ❌ No |
| Fault isolation between replica sets | ❌ No |
| Progressive degradation across sets | ❌ No |

**Verdict: Not covered.** Architecturally out of scope.

---

### Scenario 8 — Serving Global Audiences: Latency Comparison

| Aspect | Simulated? |
|---|---|
| Geographic node placement | ❌ No |
| Latency numbers on connections | ❌ No |
| `readPreference: nearest` behavior | ❌ No nearest option (only primary / primaryPreferred / secondary / secondaryPreferred) |
| Side-by-side relational vs MongoDB comparison | ❌ No |

**Verdict: Not covered.** Requires a fundamentally different UI — a map-based or latency-annotated topology that is out of scope for this concern playground.

---

## Root Cause Analysis of Gaps

Most partial-coverage gaps in Scenarios 1–4 shared the same two structural root causes:

### ~~Root Cause 1 — Node/link toggle resets document state~~ ✅ Fixed

```javascript
// app.js — canvas click handler (before fix)
if (hit.type === 'node') {
  state.nodes[hit.key].alive = !state.nodes[hit.key].alive;
  resetWriteVisual(); resetReadVisual(); resetDoc();   // ← was clearing all doc state
}
// After fix: resetDoc() removed. Only engines reset; doc state is preserved.
```

Node and link toggles no longer call `resetDoc()`. The document version history, `majorityCommitId`, per-node `docVersionId`, and last read/written version are all preserved through topology changes. The explicit Reset ↺ button remains the only way to clear document state.

### Root Cause 2 — No election simulation

The simulator has no concept of leader election (RAFT). When a primary is killed:
- The secondaries remain secondaries in the model.
- No promotion step is shown.
- Write operations to the cluster fail permanently until the user manually resets.

This prevents demonstrating:
- The "automatic failover in seconds" claim.
- The zero-downtime write continuity story.
- The full Scenario 2 timeline where App B's retried write succeeds on the new primary.

### Root Cause 3 — Single application client model

The simulator has one Write Client and one Read Client. The scenarios require two independent application perspectives (App A observing stale/rolled-back data vs. App B managing the write lifecycle).

### Root Cause 4 — No retryable write simulation

The driver's retryable write behavior (automatic retry on transient failure, exactly-once semantics) is not modeled. The user must manually reissue a write.

---

## Gaps and Implementation Effort

| Gap | Required for Scenarios | Implementation Effort | Notes |
|---|---|---|---|
| ~~**Preserve doc state on node/link fault**~~ | 1, 2, 3 | ✅ Done | Removed `resetDoc()` from node/link toggle handlers in `app.js`. |
| **Primary election simulation** | 1, 2, 3 | High | After primary is killed, simulate RAFT election: surviving nodes hold a vote, one secondary is promoted. Requires new engine steps, new node phases (`candidate`, `electing`), promotion animation. |
| **Second client ("App A" + "App B")** | 1, 2 | High | Add a second read client (or second write client) with independent phase state and `lastReceivedVersion`. Requires canvas layout changes (two client circles) and a second read engine instance. |
| **Retryable write simulation** | 2 | Medium | After a write engine aborts, automatically re-run `buildWriteSteps` against the newly elected primary. Add a driver-level "retrying…" visual state on the write client circle. |
| **Explicit "Cluster read-only" indicator** | 4 | Low | When `canAchieve(1)` fails (no primary reachable) but at least one node is alive, show a banner or canvas label: "Cluster is read-only — no electable majority." |
| **Reconfiguration command concept** | 4 | Low–Medium | Add a "Reconfigure" button that appears when the cluster is in a non-electable state. On click, simulate `rs.reconfigForceAsCurrentConfig()`: one surviving node is designated primary, election proceeds, writes resume. |
| **`readPreference: nearest`** | 8 | Medium | Add a `nearest` option to the read preference select. `resolveReadTarget` picks the node with the lowest simulated latency (could be a static constant per node label). |
| **Multi-region topology (3+ nodes with region labels)** | 6, 8 | Very High | Requires new canvas layout (geographic grouping), zone-aware replication logic, and datacenter-level fault injection (kill all nodes in a zone). Essentially a new architectural layer on top of the current sim. |
| **Multiple replica sets / multi-primary** | 7 | Very High | Requires an entirely new page or major canvas rework to show 2–3 independent replica sets side by side with their own primaries, engines, and independent fault states. |
| **Backup / restore layer** | 5 | Very High | Requires a conceptual backup tier (a separate node/store outside the RS), continuous backup animation, and a restore flow. Largely a different educational tool. |

---

## Recommended Priority for Closing Gaps

### High impact, moderate effort (do next)

1. **Decouple node/link fault from doc reset** — single change in `app.js` canvas click handler. Unlocks partial coverage of T4 in both Scenario 1 and 2, and makes Scenario 3 much more demonstrable.

2. **Explicit cluster read-only indicator** — a few lines in `updateConsistencyViews()`. Scenario 4 becomes fully covered visually.

3. **Reconfiguration button** — adds the missing "what do you do when majority is gone" interactive element for Scenario 4.

### High impact, higher effort (next milestone)

4. **Primary election simulation** — the most important missing behavior for the HA narrative. Without it, the defining promise ("automatic failover in seconds") cannot be shown.

5. **Retryable write** — completes the Scenario 2 story. Once election works, this is a relatively contained addition.

### Lower priority / out of current scope

6. `readPreference: nearest` — useful polish, but doesn't tell a new story.
7. Second application client — high canvas complexity for marginal gain given the step-panel format.
8. Multi-region topology, multi-RS, backup layer — represent new tools, not extensions of this one.
