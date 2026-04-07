# Testing Framework

**ID:** 04
**Date:** 2026-04 (reconstructed)
**Status:** Complete

---

## Description

Added a Node.js-based testing framework using the built-in `node:test` runner and `node:vm` for isolated execution. The test harness loads the browser-targeted source files (`state.js`, `simulation.js`, `engine.js`) into a VM context with all browser globals stubbed, enabling headless testing of the simulation logic without a DOM.

## What Changed

### Files

| File | Change |
|------|--------|
| `test/helpers.js` | VM context creation: loads source files in order, stubs `log`, `draw`, `awaitParticle` (instant resolution), `document`, `localStorage`. Bridges `const`/`let` declarations to context via `this.$state = state`. Exports `createContext`, `resetState`, `runMachineToEnd`, `runMachineSteps`, `runSteps`. |
| `test/state.test.js` | Unit tests for `journalFlush`, `crashNode`, `recoverNode`, `advanceMajorityCommit`, `recomputeMajorityCommit`, `resolveReadTarget`, `getServedVersion`, `isReachableForWrite`. |
| `test/machine.test.js` | Write machine scenarios: w:1/2/3/majority/0, j:true/false, w:0+j:true demotion, writer disconnect, primary down, crash-retarget, unsatisfiable write concern, link partition, sequential writes, phase transitions. |
| `test/reads.test.js` | Read concern scenarios: rc:local (dirty flag), rc:majority (frozen commit), rc:linearizable (blocks), rc:snapshot (session lock), reader disconnect, primary dead fallback. |
| `test/election.test.js` | Election scenarios: winner selection by oplog, quorum failure, rollback of uncommitted writes, majority-committed preservation, version capping, snapshot session invalidation. |
| `package.json` | Added `"test": "node --test test/*.test.js"` script. |

### Key Decisions

- `node:vm` over jsdom or Puppeteer — zero dependencies, fast execution, sufficient for testing logic (not rendering)
- `skipAnimations = true` makes all delays and particles resolve instantly — deterministic tests
- `runMachineSteps(machine, n)` added to run a precise number of steps, essential for testing intermediate states (e.g., w:1 ACK before async replication)

## Tests

- **Before:** 0 tests
- **After:** ~74 tests across 4 files

## Notes

- `const` declarations inside VM scripts needed explicit bridging (`this.$state = state`) because they don't become properties on the context object
- Tests focus on state assertions (node phases, versions, ack counts) rather than visual output
- Zero external dependencies — `package.json` has no `dependencies` or `devDependencies`
