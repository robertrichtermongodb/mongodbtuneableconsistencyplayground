# Quality Check Prompt

```
Run a quick quality check:

1. **Tests** — Run `npm test`. All must pass. Report pass/fail/total.
2. **Docs** — Check `docs/architecture.md` and `docs/correctness.md`: file paths, function names, test counts, bug statuses still accurate? Flag anything stale.
3. **Code** — Scan `js/*.js` for dead code, misplaced functions (per quality-standards.md), leftover `console.log`. Report findings or confirm clean.
```
