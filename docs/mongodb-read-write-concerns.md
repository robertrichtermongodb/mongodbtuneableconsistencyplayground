# MongoDB Read & Write Concerns — Reference

Structured reference for replica sets and sharded clusters. Defaults: `setDefaultRWConcern`; read default `local`; write default `majority`.

---

## Read concern

**Purpose:** Control consistency/isolation of data read from replica sets and sharded clusters.

**Syntax:** `readConcern: { level: "<level>" }` or `cursor.readConcern("<level>")`. In transactions, set at transaction level only.

### Levels (strongest → weakest)

| Level | Scope | Guarantee | Notes |
|-------|--------|-----------|--------|
| **snapshot** | Transactions; also `find`, `aggregate`, `distinct` (unsharded) | Snapshot of majority-committed data; causal with prior op if in causal session | Requires WiredTiger; no causal sessions/transactions with `available`/`linearizable` |
| **linearizable** | Primary only; single-doc query | All majority-acknowledged writes before read are visible | Use `maxTimeMS`. Query must uniquely identify one doc (e.g. unique index, immutable `_id`). No `$out`/`$merge`. Slower than `majority`/`local`. |
| **majority** | Any | Data from majority-commit point (in-memory view) | Requires WiredTiger. Durable if `writeConcernMajorityJournalDefault` true. In transactions, only with commit write concern majority. |
| **local** | Default for primary/secondaries | Instance’s most recent data | Works with/without causal sessions and transactions. |
| **available** | Sharded / secondaries | Lowest latency | Sharded: may return orphaned docs. Not for causal sessions/transactions. |

### Transactions

- Set read concern at **transaction start**. Allowed: `local`, `majority`, `snapshot`. Explicit collection/DB read concern ignored in transaction.
- Creating collections/indexes explicitly in transaction → must use `local`.
- Causal sessions: use `majority` read concern for causal guarantees.

### Operations supporting read concern

Reads: `aggregate`, `count`, `distinct`, `find`, `listCollections`, `listIndexes`, etc. Write commands in a transaction can use transaction-level read concern. `local` DB: read concern ignored.

### Caveats

- **Read your own writes:** Use causally consistent sessions (with acknowledged writes).
- **Linearizable + majority write:** Real-time order for single-doc read/write.
- **afterClusterTime:** Set by drivers for causal sessions; don’t set manually. Cannot combine with `atClusterTime` for snapshot.

---

## Write concern

**Purpose:** Level of acknowledgment requested for write operations (standalone, replica set, sharded). In transactions, set at transaction level only.

**Syntax:** `{ w: <value>, j: <boolean>, wtimeout: <number> }`

### Fields

| Field | Meaning |
|-------|--------|
| **w** | Number of `mongod` instances (or tag set) that must acknowledge. Values: `"majority"`, integer ≥ 0, or tag set. |
| **j** | If true: acknowledge only after write is on on-disk journal. |
| **wtimeout** | ms limit for `w` to be satisfied; only when w > 1. 0 = no limit (can block indefinitely). |

### `w` values

| w | Behavior |
|---|----------|
| **"majority"** | Default for most deployments. Ack when write has propagated to a majority of data-bearing voting members (oplog durable; journal behavior per `writeConcernMajorityJournalDefault`). |
| **1** | Ack from primary only. Rollback risk if primary steps down before replicate. |
| **0** | No ack (fire-and-forget). May still get socket/network errors. Rollback risk. If `j: true`, ack from primary/standalone. |
| **n > 1** | Primary + (n−1) secondaries. Non-voting secondaries can ack. Rollback risk if only primary required and it steps down. |

### Default write concern

- Default: `{ w: "majority" }`.
- Exception (arbiter edge case): if `#arbiters > 0` and `#non-arbiters ≤ majority(#voting-nodes)` → default `{ w: 1 }`.
- Sharded DDL always uses `"majority"` regardless of provided write concern.

### Majority calculation

- **Calculated majority** = min( majority of all voting members, number of data-bearing voting members ).
- Example P-S-S (3 voting): majority = 2 → primary + 1 secondary.
- Example P-S-A: 2 data-bearing, majority 2 → both must ack; one down → can timeout.

### Journal (`j`)

- `j: true` → ack after journal sync. With `w: "majority"`, `writeConcernMajorityJournalDefault` (default true) implies journal; then majority ack implies durability.
- `writeConcernMajorityJournalDefault: false` → majority writes can roll back on transient loss of majority.

### Reads after `w: "majority"` writes (MongoDB 8.0+)

- Majority ack is when a majority have **durably written the oplog entry**; applying to collections is async.
- Reads on secondaries immediately after ack may not yet see the write. Use **causally consistent session** if you need to read your own writes from secondaries.

### Causal consistency

- Causal sessions need **read concern majority** and **write concern majority** for full causal guarantees.

### Other

- **local** DB: write concern ignored.
- **wtimeout:** Only for w > 1; does not roll back already-applied writes on timeout.

---

## Quick comparison (for playground UI)

**Read concern:** local → available → majority → snapshot → linearizable (roughly latency ↓ / consistency ↑).

**Write concern:** w:0 → w:1 → w:n → w:"majority" (durability/consistency ↑). Use `j: true` when you need journal guarantee with non-majority `w`.

**Pairing:** For “read your own writes” and strong consistency: **read concern majority** + **write concern majority** (and causal session when reading from secondaries).
