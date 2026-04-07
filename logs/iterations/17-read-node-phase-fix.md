# Reads Don't Mutate Node Write-State

**ID:** 17
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Read operations no longer change server node phases (`reading`, `serving`). Previously, reads would color nodes blue/green during the read flow, overwriting the write-concern phase colors (`active`, `acked`, `idle`). This was confusing because node colors are meant to reflect write durability state. Read progress is still visible through particle animations and the read client phase.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Removed all `target.phase = 'reading'`, `target.phase = 'serving'`, `state.nodes[k].phase = 'reading'`, `state.nodes[k].phase = 'serving'`, and `target.phase = 'error'` assignments from `buildReadSteps`. Client phases (`readClient.phase`) unchanged. |
| `docs/correctness.md` | Updated to Iteration 17. Fixed stale entry about j:false deferred journal (now primary always journals before replication). Updated rc:majority entry to note node-capped serving. Added "reads don't change node colors" and "texts centralized" entries. |
| `docs/architecture.md` | Split node phases from client phases. Added note that `reading`/`serving` phase colors exist in `draw.js` but are no longer assigned to server nodes. |
| `prompts/iteration-log-prompt.md` | Updated to include quality check steps (run tests, check docs, scan for dead code) before creating the log. Added references to `quality-standards.md` and `quality-check-prompt.md`. |

### Key Decisions

- **Keep `reading`/`serving` color mappings in `draw.js`.** They still exist for backward compatibility but are never reached by server nodes. Removing them would require verifying no other code path sets these phases.
- **Don't set error phase on nodes for linearizable failure.** The read client phase shows the error state. Nodes retain their write-concern phase.
- **Updated iteration-log-prompt to enforce quality gates.** Every iteration now requires tests green + docs check + dead code scan before the log is written.

## Tests

- **Before:** 85 tests
- **After:** 85 tests (all green)
- **Modified tests:** None — no test relied on read-side node phase changes.

## Notes

- The `reading`/`serving` phase colors in `draw.js` (`phaseFill`, `phaseStroke`, `nodeLabelColor`) are now dead code for server nodes. Could be cleaned up in a future iteration.
- Read flow is still clearly visible: particle animations show data flowing, and the read client's phase changes (`waiting` → `received` or `error`) indicate progress.
