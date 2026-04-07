# Write Rollback on Failure

**ID:** 08
**Date:** 2026-04-15
**Status:** Complete

---

## Description

Fixed a bug where the send step optimistically set `state.doc.latestId` and pushed a version entry, but a subsequent write failure (primary crash) never rolled these back. This caused the UI to show "Update doc" instead of "New doc" after a failed first write, and left orphan entries in the versions array.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/simulation.js` | Added rollback logic to `failWrite()`: removes the version entry matching `nextId` from `state.doc.versions` and reverts `state.doc.latestId` to `nextId - 1`. Same rollback added to `guardRun()` for the race condition where primary dies during step execution. |
| `test/machine.test.js` | Added 1 test: "rolls back latestId and versions on failure" — sends write, kills primary, verifies `latestId` returns to 0 and versions array is empty. |
| `docs/correctness.md` | Added I7 (failed write rollback). Updated fix count. |

### Key Decisions

- Rollback in both `failWrite()` (step-generation path) and `guardRun()` (step-execution path) to cover both timing windows
- Uses `findIndex` + `splice` rather than filtering the entire array — precise removal of the single entry

## Tests

- **Before:** 75 tests
- **After:** 77 tests (+1 rollback test, +1 from concurrent linearizable work)

## Notes

- Documented as I7 in `docs/correctness.md`
- The rollback is safe because the version entry is always the last one in the array (it was just pushed during send)
- `syncButtons()` in `engine.js` already reads `state.doc.latestId` to determine the button label, so the rollback automatically fixes the UI
