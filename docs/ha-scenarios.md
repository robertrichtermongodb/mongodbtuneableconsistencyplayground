# High Availability Scenarios
*Extracted from "High Availability — A Modern Roleplay Challenge" (MongoDB presentation)*

---

## Table of Contents

1. [Rollback Scenario: Weak Write & Read Concerns](#1-rollback-scenario-weak-write--read-concerns)
2. [Rollback Scenario: Strong Write & Read Concerns (Majority)](#2-rollback-scenario-strong-write--read-concerns-majority)
3. [Minority Node Failure](#3-minority-node-failure)
4. [Majority of Electable Nodes Failure](#4-majority-of-electable-nodes-failure)
5. [Total Data-Bearing Node Loss](#5-total-data-bearing-node-loss)
6. [Chaos Test: 9-Node Replica Set Across 3 Regions](#6-chaos-test-9-node-replica-set-across-3-regions)
7. [Chaos Test: Multi-Region, Multi-Primary Cluster](#7-chaos-test-multi-region-multi-primary-cluster)
8. [Serving Global Audiences: Latency Comparison](#8-serving-global-audiences-latency-comparison)

---

## 1. Rollback Scenario: Weak Write & Read Concerns

**Context:** Two applications (A and B) interact with a 3-node replica set (Node 1 = Primary, Node 2 & 3 = Secondaries). Both applications use *weak* write and read concerns (e.g. `w:1`, `rc:local`).

**Initial state:** `X = 100` on all three nodes.

| Time | Event | State |
|------|-------|-------|
| T1 | `X = 100` on all three nodes | All nodes: `{X: 100}` |
| T2 | App B writes `X = 101` to Primary. Primary accepts and **immediately acknowledges** (`w:1` — no replication required). | Node 1: `{X: 101}` · Node 2: `{X: 100}` · Node 3: `{X: 100}` |
| T3 | App A reads `X` from Node 1 (`rc:local`). Reads **`X = 101`** — the uncommitted in-flight value. | App A holds `{X: 101}` |
| T4 | **Node 1 (Primary) fails** before `X = 101` has been replicated to either secondary. | Node 1: 🔥 (dead) · Node 2: `{X: 100}` · Node 3: `{X: 100}` |
| T5 | Election held. Node 2 becomes the new primary. `X = 101` is **permanently lost** — effectively rolled back. | New primary (Node 2): `{X: 100}` · Node 3: `{X: 100}` |
| T6 | App A still holds `{X: 101}` but the cluster has `{X: 100}`. **Applications have no awareness of the rollback.** | App A: `{X: 101}` (stale) · Cluster: `{X: 100}` |

**Problem:** App A performed a dirty read — it read data that was subsequently rolled back. Neither application is notified. The application state is now inconsistent with the database.

**Root cause:** `w:1` did not require replication before ACK; `rc:local` did not filter for majority-committed data.

---

## 2. Rollback Scenario: Strong Write & Read Concerns (Majority)

**Context:** Same two-application, 3-node setup. Both applications now use **`w:majority`** and **`rc:majority`**. Retryable writes are enabled (default since MongoDB Driver 4.2).

**Initial state:** `X = 100` on all three nodes.

| Time | Event | State |
|------|-------|-------|
| T1 | `X = 100` on all three nodes | All nodes: `{X: 100}` |
| T2 | App B writes `X = 101` to Primary. Write is applied to Node 1 but **not yet replicated** — ACK is **withheld** (`w:majority` requires majority confirmation first). | Node 1: `{X: 101}` · Node 2: `{X: 100}` · Node 3: `{X: 100}` |
| T3 | App A reads `X` from Node 1 using `rc:majority`. The driver returns **`X = 100`** — the last majority-committed value — because `X = 101` has not yet been replicated to a majority. | App A reads `{X: 100}` |
| T4 | **Node 1 (Primary) fails** before `X = 101` is replicated or acknowledged. | Node 1: 🔥 (dead) · Node 2: `{X: 100}` · Node 3: `{X: 100}` |
| T5 | Election held. Node 2 becomes the new primary. `X = 101` is rolled back (it was never majority-committed). | New primary (Node 2): `{X: 100}` · Node 3: `{X: 100}` |
| T6 | App B receives a **write exception** (the `w:majority` ACK was never delivered). App A's read of `{X: 100}` remains **correct** — no stale data was observed. | App B: exception · App A: `{X: 100}` ✓ |
| T7 | The driver **automatically retries** App B's write (`X = 101`) against the new primary (retryable writes). | Node 2: `{X: 101}` · Node 3: `{X: 100}` |
| T8 | Write replicates to Node 3, reaching majority. **`w:majority` ACK delivered to App B.** | Node 2: `{X: 101}` · Node 3: `{X: 101}` |

**Outcome:**
- App A never observed rolled-back data.
- App B received an exception and the write was safely retried without duplicate application.
- Final cluster state is consistent and correct.
- Zero data loss. Zero missed operations.

**Key mechanisms:** `rc:majority` prevents dirty reads. `w:majority` prevents ACK before durability. Retryable writes automate recovery from transient failures.

---

## 3. Minority Node Failure

**Scenario:** One or more nodes in a replica set fail, but fewer than a majority of electable nodes are affected.

**Conditions:** Any minority subset of nodes goes down (e.g. 1 node in a 3-node set, or up to 2 nodes in a 5-node set).

**Resolution:** Automatic, no operator action required.

**Outcome:**
- **Zero data loss**
- **Zero downtime**
- **Zero missed operations**

**Mechanism:** The surviving majority elects a new primary (if the failed node was primary) and continues serving reads and writes without interruption. MongoDB Atlas retries reads and writes automatically on transient network errors or primary unavailability.

---

## 4. Majority of Electable Nodes Failure

**Scenario:** A majority of electable nodes in a replica set fail simultaneously, but at least one data-bearing node survives.

**Conditions:** e.g. 2 out of 3 nodes fail, or 3 out of 5.

**Resolution:** Requires a reconfiguration command (can be automated and issued within seconds). No application code changes required.

**Outcome:**
- **Zero data loss**
- Cluster enters a **temporary read-only state** (seconds)
- Returns to **fully operational** almost immediately after reconfiguration
- **Zero missed operations**
- **Zero application code changes required**

**Mechanism:** Without a majority of electable nodes, no primary can be elected (RAFT protocol safety). A reconfiguration adjusts the voting membership of the replica set, allowing a new election to proceed.

---

## 5. Total Data-Bearing Node Loss

**Scenario:** All data-bearing nodes in a replica set fail or are destroyed.

**Resolution:** Requires restore from backup.

**Recovery source:** Physically and logically separate, continuous read-only backups (e.g. MongoDB Ops Manager / Atlas Backup). Backup is:
- Hosted in separate regions from production
- Maintained as consistent snapshots (supports queryable backups and point-in-time restore)
- Compatible with all MongoDB architectures (standalone, replica set, sharded, zoned)

**Outcome:** Recovery path is available. Data is protected up to the last backup snapshot or point-in-time restore point (lowest possible RPO).

---

## 6. Chaos Test: 9-Node Replica Set Across 3 Regions

**Setup:** 9-node replica set, nodes distributed across 3 geographic regions (3 nodes per region).

**Testing method:** Chaos testing — simultaneous permanent fault injection on 1 or more entire datacenters.

**Results observed across 7 live demonstrations:**
- Either **no failover was needed**, or **automatic failover occurred with zero downtime, zero missed operations, and zero data loss**.

**Enumerated disaster scenarios:**

| Category | Count | Resolution |
|---|---|---|
| Simultaneous permanent failure of 1 or more datacenters | 255 | Fully automatic — zero business interruption |
| Additional scenarios resolvable with reconfiguration command | 255 | Seconds to resolve, no app code changes |

**Key finding:** All 255 scenarios involving the loss of one or more complete datacenters resolved automatically and gracefully.

---

## 7. Chaos Test: Multi-Region, Multi-Primary Cluster

**Setup:** Multi-region, multi-primary replica set cluster spanning 3 regions, with 3 independent replica sets (one primary per region). Each replica set maintained independent resiliency configurations and recovery states.

**Testing method:** Progressively degraded system with increasingly severe fault injection.

**Observed fault progression and outcomes:**

| Stage | Fault Applied | Outcome |
|---|---|---|
| 1 | One replica set lost its primary | Automatic election. The other two replica sets had **no need for failover** and continued normally. |
| 2 | One replica set forced into read-only state | Recovered to fully operational almost immediately. The other two replica sets **continued uninterrupted**. |
| 3 | One replica set completely wiped out | The other two replica sets **recovered almost immediately**. Data protected by continuous backups. |

**Key finding:** Each replica set in a multi-primary cluster exhibits independent resilience. Failure of one set does not cascade to others.

---

## 8. Serving Global Audiences: Latency Comparison

**Scenario:** An application serves users across multiple geographic regions. Comparison between a single-primary relational database architecture and MongoDB's distributed replica set.

### Relational Database (Single Primary)

All reads and writes are routed to a single primary node regardless of where the application user is located.

| User Region | Local Network Latency | Round-trip to Primary |
|---|---|---|
| Local (same region) | 69 ms | 30 ms |
| Region 2 | 69 ms | 100 ms |
| Region 3 | 69 ms | 200 ms |
| Region 4 | 69 ms | 175 ms |
| Region 5 | 69 ms | 250 ms |

**Problem:** Users geographically distant from the primary experience high read latency regardless of data access patterns.

### MongoDB Replica Set (Distributed Reads)

Reads can be served from the geographically nearest replica (via `readPreference: nearest` or regional routing). Replication propagates writes to all nodes.

| User Region | Local Network Latency | Round-trip to nearest node |
|---|---|---|
| Region 1 | 69 ms | **5 ms** |
| Region 2 | 69 ms | 30 ms |
| Region 3 | 69 ms | **5 ms** |
| Region 4 | 69 ms | 40 ms |
| Region 5 | 69 ms | 40 ms |
| Region 6 | 69 ms | 40 ms |
| Region 7 | 69 ms | 60 ms |
| Region 8 | 69 ms | **5 ms** |

**Benefit:** Users are served from a local or nearby replica, dramatically reducing read latency for globally distributed applications.

**Trade-off:** Reads from secondaries may be slightly stale unless `rc:majority` or `rc:linearizable` is used (see [Rollback Scenario: Weak Concerns](#1-rollback-scenario-weak-write--read-concerns) for why this matters in consistency-sensitive applications).

---

## Reference: Read Concern Isolation Levels

*From slide 17 — theoretical grounding for the scenarios above.*

| Read Concern | Description | Isolation Level | Node Failure Risk |
|---|---|---|---|
| `local` | Read latest value from primary | Read Uncommitted | **Dirty Reads** — may read updated data subsequently rolled back |
| `majority` | Read latest value committed to majority of nodes | Read Committed | **Stale Reads** — may read slightly older data during failover; eliminates dirty read risk |
| `snapshot` | (Transactions) Read from snapshot of majority-committed data | Snapshot Isolation | n/a |
| `linearizable` | Read latest value after all majority-acknowledged writes prior to the read | Read Committed (strongest) | n/a — eliminates stale read risk |

**Key recommendation:** Setting read concern to `majority` is the minimum required to avoid reading data that could subsequently be rolled back during a primary failover.

---

## Reference: Write Concern

*From slide 16.*

Write concern controls when the client application receives an acknowledgment from MongoDB.

| w value | Meaning |
|---|---|
| `1` | Written and applied to primary only |
| `2` | Written to primary and at least one secondary |
| `majority` | Written to a majority of nodes |

**Use case:** `w:majority` ensures synchronous acknowledgment confirming that the write has durably replicated to another datacenter or region before the client proceeds.
