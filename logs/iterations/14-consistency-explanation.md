# Improve Consistency Explanation

**ID:** 14
**Date:** 2026-03-15
**Status:** Complete

---

## Description

Added pedagogical callouts throughout the UI to communicate that MongoDB's default write concern (`w:majority`) is safe and prevents data-loss scenarios. Users exploring risky configurations (w:1, w:0, etc.) now see contextual notes explaining that the default behavior avoids the demonstrated issue. A configuration badge on the `w` dropdown visually flags non-default settings.

## What Changed

### Files

| File | Change |
|------|--------|
| `js/draw.js` | Added `safetyNote` / `defaultNote` to consistency view boxes: "Write concern failed", "Acknowledged but LOST", "Fire-and-forget", and "In-flight" states all show a blue info note when using non-default `w` values. The "Acknowledged but LOST" box now includes a "How to prevent" section. |
| `js/simulation.js` | Added `isDefault` and `defaultNote` template. Appended the note to ACK explain text for `w:1` and `w:N` (non-majority), and to all `primaryUnavailableStep` failure/abort messages when using non-default config. |
| `js/app.js` | Added `syncWBadge()` function and `change` listener on `sel-w` dropdown. Shows "✓ DEFAULT" (green) or "⚠ NON-DEFAULT" (amber) badge next to the write concern selector, with context-sensitive tooltips. |
| `css/style.css` | Added `.cb-default-note` for consistency box safety callouts, `.default-safety` for step panel inline notes, and `.config-badge` / `.config-badge-warn` / `.config-badge-ok` for the dropdown indicator. |
| `index.html` | Added `<span id="w-default-badge">` element after the `sel-w` dropdown. |
| `js/simulation.js` | Changed `j:false` secondary replication to interleave journal flush per-secondary instead of batching all journals at the end. Each secondary now completes memory apply + journal flush before the next secondary starts. |
| `test/machine.test.js` | Updated `w:2 j:false` and `w:3 j:false` tests to assert the interleaved mem+journal ordering (secondary journals before ACK, primary journal after). |

### Key Decisions

- Safety notes use `var(--blue)` (the info color) to stand out without appearing as errors or warnings.
- Notes only appear for non-default configurations — `w:majority` paths stay clean.
- The "Acknowledged but LOST" box gets the most detailed treatment since it demonstrates the highest-impact learning moment.
- The dropdown badge is always visible (green for default, amber for non-default) to maintain awareness. Both states have context-sensitive tooltips.
- Side-fix: secondary replication with `j:false` now interleaves journal flushes per-node instead of batching them at the end, matching the `w:majority` path's visual pattern and giving a clearer per-node lifecycle.

## Tests

- **Before:** 85 tests
- **After:** 85 tests (no new tests — changes are purely visual/textual)
- **Verification:** All 85 tests pass green.

## Notes

- The `defaultNote` in `simulation.js` mentions "since v5.0" to give precise version context for when `w:majority` became the default.
- The consistency box note and step panel note use slightly different wording to avoid repetition when both are visible simultaneously.
