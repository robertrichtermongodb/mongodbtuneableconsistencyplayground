# Quality Check Prompt

```
Run a quality check:

1. **Tests** — Run `npm test`. All must pass. Report pass/fail/total.
2. **Docs** — Check `docs/architecture.md` and `docs/correctness.md`: file paths, function names, test counts, bug statuses still accurate? Flag anything stale.
3. **Code** — Scan `js/*.js` for dead code, misplaced functions (per quality-standards.md), leftover `console.log`. Report findings or confirm clean.
4. **Scorecard** — Score each metric from the Quality Scorecard in `prompts/quality-standards.md`. Report in this format:

   | # | Metric | Previous | Current | Delta |
   |---|--------|----------|---------|-------|
   | 1 | Max function length | … | … | … |
   | … | … | … | … | … |
   | | **Total** | **X / 20** | **Y / 20** | **+/-Z** |

   Flag any metric that regressed (moved from GREEN→YELLOW or YELLOW→RED).
   Update the "Baseline Snapshot" table in `prompts/quality-standards.md` with the new values and today's date.
```
