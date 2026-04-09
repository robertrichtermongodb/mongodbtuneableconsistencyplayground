# Quality Scorecard — Architectural Fitness Function

**ID:** 21
**Date:** 2026-04-09
**Status:** Complete

---

## Description

Added a measurable quality scorecard to the project's quality standards, serving as an architectural fitness function. Defines 10 code metrics across 4 categories (function size, naming/readability, modularity, DRY/tests) with green/yellow/red thresholds. Establishes a pre-refactor baseline of 3/20 and embeds scoring into the quality-check workflow so every future iteration tracks the trend.

## What Changed

### Files

| File | Change |
|------|--------|
| `prompts/quality-standards.md` | Added "Quality Scorecard (Architectural Fitness Function)" section: 10 metrics with thresholds across 4 categories, scoring rules (GREEN=2/YELLOW=1/RED=0, max 20), aggregate rating bands (Healthy/Acceptable/Needs attention), and a baseline snapshot dated 2026-04-09 showing 3/20. |
| `prompts/quality-check-prompt.md` | Added step 4 ("Scorecard") requiring every quality check to score all 10 metrics, report deltas against the previous baseline in a comparison table, flag regressions, and update the baseline snapshot in `quality-standards.md`. |

### Key Decisions

- **10 metrics, not more:** Kept the scorecard to metrics that are manually assessable without build tooling. Automated counting scripts can be added later but are not required — the scorecard works with manual assessment during quality checks.
- **Ambitious thresholds (most RED today):** The thresholds represent the target state, not the current state. Starting at 3/20 gives a clear baseline and every refactoring iteration should visibly move the number up. A score of 16+ means the codebase is structurally healthy.
- **`texts.js` and `theme.js` excluded from file-length metric:** These are data/config files (string catalogs and design tokens), not logic. Measuring their length would penalize content richness, not structural debt.
- **Mixed-abstraction metric is manually assessed:** There is no automated way to detect "state mutation + DOM/animation in the same function body" in vanilla JS. This metric relies on reviewer judgment during quality checks. It captures the most impactful modularity issue in this codebase (step `run()` functions mixing concerns).
- **Majority quorum hardcoding counted under "magic numbers":** The `2` in `ackedBy.size >= 2` is included as a magic number even though it's semantically "majority of 3." The proper fix is a named constant or computed value, same as all other magic numbers.

## Tests

- **Before:** 130 tests
- **After:** 130 tests (no test changes — this iteration is prompts/docs only)

## Notes

- The baseline snapshot (3/20) establishes the starting point for the planned code restructuring. The single GREEN metric is "Tests passing" at 100%.
- The scorecard is designed to be updated in-place: each quality check overwrites the baseline snapshot with new values and the current date. Historical values can be tracked via git history or iteration logs.
- Future consideration: a small Node script could automate counting magic numbers, single-char variables, function lengths, and nesting depth. Not needed now — manual assessment is sufficient for the iteration cadence.
