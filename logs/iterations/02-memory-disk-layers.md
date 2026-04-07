# Memory vs Disk Storage Layers

**ID:** 02
**Date:** 2026-03 (reconstructed)
**Status:** Complete

---

## Description

Added a visual and functional split between in-memory data and on-disk journal for each node, modeling WiredTiger's storage engine. This enables accurate simulation of `j:true` vs `j:false` write concerns and crash/recovery behavior where unjournaled data is lost.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/state.js` | Replaced single `docVersionId` per node with `memoryVersion` and `journalVersion`. Added `journalFlush()`, `crashNode()` (wipes memory, preserves journal, retracts memory-only acks), `recoverNode()` (restores memory from journal). Added `recomputeMajorityCommit()` for post-crash ack retraction. |
| `js/simulation.js` | Split write steps into "memory apply" and "journal flush" per node. Ack gating: `j:false` acks on memory apply, `j:true`/`w:majority` acks on journal flush. |
| `js/draw.js` | `drawNodeDocBadge()` renders two-row stacked badge (MEM/DISK) below each node, always visible. Amber for uncommitted memory, green for committed, dim dash for empty. Down-arrow indicator when memory is ahead of disk. |
| `js/app.js` | Node kill triggers `crashNode()` (wipes memory), restart triggers `recoverNode()` with 600ms `recovering` phase before returning to idle. |
| `css/style.css` | No changes — badge rendering is canvas-only. |

### Key Decisions

- Two-step model per node (memory apply then journal flush) rather than a single "replicate" step — makes `j:true` vs `j:false` visually distinct
- `crashNode()` retracts acks for versions above `journalVersion` and recomputes `majorityCommitId` — accurately models data loss on crash
- Badge always visible (even at v0) so users can see the storage state evolve from the start

## Tests

- **Before:** 0 tests
- **After:** 0 tests (testing added in iteration 04)

## Notes

- The `writeConcernMajorityJournalDefault:true` default is hardcoded — toggling it is listed as M8 in correctness.md
- Recovery is simplified: `memoryVersion = journalVersion` instantly, whereas real MongoDB replays the oplog
