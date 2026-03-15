# MongoDB Read/Write Concerns — Research Notes
## Context: 3-node P-S-S replica set, WiredTiger, writeConcernMajorityJournalDefault:true (default)
## Majority = 2 (min of: majority(3 votes)=2, data-bearing members=3)

---

## CORE CONCEPTS

**Write concern `w`**: how many nodes must ack the oplog entry before client gets response.
**Write concern `j`**: whether ack waits for on-disk journal flush (not just in-memory).
**Read concern**: which "snapshot" of data the read draws from.

Write ack in MongoDB 8.0+: `w:majority` acks after majority have the oplog entry durably written — members then apply to collection asynchronously. Secondary may not yet reflect write to queries immediately after ack.

---

## CONCERN VALUES

### Write concern `w`
- `0`: fire-and-forget. No ack. Rollback risk. w:0 + j:true → demotes to w:1.
- `1`: ack from primary only. Rollback risk if primary steps down before replication.
- `2`: primary + 1 secondary in 3-node set.
- `3`: all 3 nodes. Blocks if any node down.
- `"majority"`: primary + 1 secondary (majority=2). Default. Rollback-safe under normal failover.

### Write concern `j`
- `false`: ack after in-memory apply (default when w<majority or writeConcernMajorityJournalDefault:false).
- `true`: ack after journal flush on each counted node.
- With `w:majority` and `writeConcernMajorityJournalDefault:true`: j is implicitly true. Majority ack = durable on disk.

### Read concern levels
- `local`: node's current in-memory state. May include not-yet-replicated or later-rolled-back data. Default.
- `available`: same as local for replica sets; sharded clusters may return orphaned docs.
- `majority`: reads from node's in-memory majority-commit point. Only data ack'd by majority is visible. No dirty reads. Comparable performance to local (in-memory snapshot, no extra I/O).
- `snapshot`: consistent point-in-time snapshot of majority-committed data. Transactions + find/aggregate/distinct (unsharded). Requires commit w:majority for full guarantee in txn.
- `linearizable`: primary only. Confirms primary can complete w:majority writes. Reads reflect all majority-ack'd writes before the read. Requires unique-indexed single-doc query. Always use maxTimeMS.

---

## CONSISTENCY MODELS

### Strong consistency (linearizable ops)
Requirements: `w:majority` + `rc:linearizable` on primary.
- Multiple threads read/write single doc as if serial real-time order.
- Slowest: primary must confirm with secondaries it can still complete w:majority.
- Use maxTimeMS to avoid blocking when majority unavailable.

### Strong consistency (practical default)
Requirements: `w:majority` + `rc:majority`.
- Read never sees data that will roll back.
- Read never goes backward in time (monotonic).
- With causal session: read-your-writes, monotonic reads, monotonic writes, writes-follow-reads — all 4 guaranteed, including across network partition.

### Causal consistency — 4 guarantees
1. **Read own writes**: reads reflect preceding writes in session.
2. **Monotonic reads**: reads never return older state than previous read.
3. **Monotonic writes**: writes execute in session order.
4. **Writes follow reads**: write sees state from preceding read.

Mechanism: session tracks `operationTime` + `clusterTime`. Each op sends `afterClusterTime` forcing node to wait until oplog reaches that time before serving.

### Concern combination → causal guarantee matrix
| wc | rc | RoW | MonR | MonW | WfR | Durable |
|---|---|---|---|---|---|---|
| majority | majority | ✅ | ✅ | ✅ | ✅ | ✅ |
| {w:1} | majority | ✅† | ✅ | ✅† | ✅ | ❌ |
| majority | local | ❌ | ❌ | ✅ | ❌ | ✅ |
| {w:1} | local | ❌ | ❌ | ❌ | ❌ | ❌ |

† w:1 + rc:majority satisfies all 4 only if rolled-back writes are acceptable (causal without durability). If durability required: only MonR + WfR hold.

### Eventual consistency
Not a setting — it's the emergent behavior of weak concerns:
- `w:1` + `rc:local` + `readPreference:secondary`: highest throughput, lowest latency, data loss on failover, stale reads.
- Secondaries lag primary by replication delay (typically ms, can be seconds under load).
- `rc:local` on secondary reads whatever that node has — no majority-commit guarantee.
- `rc:majority` on secondary: reads majority-committed data, may still lag real-time by replication delay, but no dirty reads.

---

## 3-NODE REPLICA SET FAILURE SCENARIOS

### Normal operation
- `w:majority`: write goes to P, waits for 1 secondary ack → returns. Durable.
- `rc:majority`: reads from majority-commit snapshot, always consistent with majority writes.

### Scenario 1: 1 secondary down (P + S1 alive)
- `w:majority`: works, P + S1 = 2 = majority. No degradation.
- `w:3`: blocks until S2 recovers.
- `rc:majority`: unaffected, majority-commit point advances normally.
- `rc:linearizable`: unaffected (queries to primary only).
- **Impact**: zero for default majority/majority setup.

### Scenario 2: 2 secondaries down (P alone)
- `w:majority`: **blocks / wtimeout**. Cannot reach 2 nodes.
- `w:1`: works. Ack from P only. High rollback risk.
- `rc:majority`: majority-commit point stops advancing. Causal session reads with `afterClusterTime` block. Non-causal reads still see last majority-commit snapshot (frozen).
- `rc:local`: reads served immediately from P.
- No election possible (no majority to vote). P eventually steps down → no primary → all writes blocked regardless of `w`.
- **Impact**: full write unavailability with majority concern. Degraded to w:1 or nothing.

### Scenario 3: Primary crashes, clean election
- S1 and S2 detect P failure, elect new primary (requires >50% of votes = 2/3 agree).
- Election takes ~10s typically (configurable heartbeat/election timeouts).
- `w:majority` writes that had replicated to 1+ secondary: **safe**, new primary has them.
- `w:majority` writes that had NOT replicated: **rolled back** when old P rejoins as secondary.
- `w:1` writes on P only: **lost** if not replicated.
- `rc:local` clients may have read rolled-back data → phantom reads.
- `rc:majority` clients: never exposed rolled-back data.
- During election (gap ~10s): no primary → writes fail, reads from secondaries possible if `readPreference:secondary` or `primaryPreferred`.

### Scenario 4: Network partition — P isolated, S1+S2 form majority
- S1+S2 elect new primary (P-new). Old P (P-old) stays up but isolated.
- P-old: `w:1` writes succeed → will roll back at healing. `w:majority` blocks (can't reach 2).
- P-new: `w:majority` writes succeed (S1+S2 = 2).
- `rc:majority` on P-old: majority-commit point cannot advance → reads block or return stale snapshot.
- `rc:majority` on P-new: normal.
- `rc:local` on P-old: serves diverged data that will be rolled back.
- At healing: P-old demotes, finds common oplog point, rolls back diverged writes, resyncs from P-new.
- **Key insight**: `w:majority` + `rc:majority` is partition-safe. `w:1` + `rc:local` is not.

### Scenario 5: wtimeout fires before majority ack
- Write is already applied on primary. Secondaries may or may not have it.
- MongoDB returns write concern error to client.
- **Write is NOT rolled back.** It will eventually replicate.
- Client state: unknown — write may or may not become durable.
- Pattern: client should treat as "uncertain", query to verify or retry idempotently.

### Scenario 6: writeConcernMajorityJournalDefault:false (non-default / in-memory engines)
- `w:majority` acks after majority have write in memory, not on disk.
- If majority crashes and restarts → write lost even though majority-ack'd.
- `rc:majority` may serve data that subsequently disappears after crash+restart of majority.
- Breaks the "majority = durable" contract.

---

## ROLLBACK MECHANICS

- Rollback happens when former primary rejoins and its oplog has entries not in new primary's oplog.
- MongoDB finds common oplog point, reverts all ops after it on the rejoining node.
- Algorithm (default, MongoDB 5.0+): "Recover to a Timestamp" — no data size limit, reverts to consistent timestamp, then applies ops to catch up.
- Rollback data written to `<dbpath>/rollback/<uuid>/removed.<timestamp>.bson` by default.
- Collection drops / document deletions: NOT written to rollback files.
- `w:1` with oplog holes: rollback files may miss some writes if primary restarts mid-write.
- In MongoDB 4.2+: all in-progress user ops killed when member enters ROLLBACK state.

---

## ISOLATION MODEL

Default: **read uncommitted** — writes visible in memory before durable.

| | rc:local | rc:majority | rc:snapshot | rc:linearizable |
|---|---|---|---|---|
| In-memory, not replicated | visible | not visible | not visible | not visible |
| Replicated to majority, not journaled | visible | visible* | visible* | visible* |
| Fully journaled on majority | visible | visible | visible | visible |
| Rolled-back data (was in-memory) | **was visible** | never visible | never visible | never visible |
| Multi-shard partial commit | visible | may see partial† | atomic per txn | N/A |

*With default writeConcernMajorityJournalDefault:true, majority-commit point only advances after journal flush, so "replicated but not journaled" never reaches majority-commit point.
†Sharded: rc:local can see write 1 on shard A before write 2 visible on shard B (cross-shard non-atomic for non-transaction writes).

Single document: always internally atomic (no partial field update visible).
Multi-document: atomic only within explicit transactions.

---

## PRACTICAL CONCERN PAIRINGS

| Use case | wc | rc | Notes |
|---|---|---|---|
| Default / safe | majority | majority | Rollback-safe, partition-safe, durable |
| Max throughput, tolerate loss | 0 or 1 | local | Eventual consistency, data loss risk |
| Read from secondaries safely | majority | majority | + causal session for read-own-writes |
| Low-latency secondary reads, bounded staleness | majority | majority | + readPref:secondaryPreferred |
| Strict real-time single doc | majority | linearizable | maxTimeMS required, slowest |
| Transaction | majority (txn level) | majority or snapshot | rc:snapshot = atomic txn view |
| Best-effort analytics | 1 | local | Acceptable for non-critical reads |
| Causal without durability | 1 | majority | All 4 causal guarantees if rollbacks acceptable |
