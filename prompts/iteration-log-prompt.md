# Iteration Log Prompt

```
After completing a major change:

1. Run quality checks per `prompts/quality-check-prompt.md`:
   a. Run `npm test` — all must pass.
   b. Check `docs/architecture.md` and `docs/correctness.md` for stale content — update if needed.
   c. Scan `js/*.js` for dead code or misplaced functions per `prompts/quality-standards.md`.

2. Create the iteration log:
   a. Read the template at `logs/iterations/TEMPLATE.md`.
   b. Determine the next sequential ID from existing logs in `logs/iterations/`.
   c. Create `logs/iterations/NN-short-kebab-name.md`.
   d. Fill every section with specifics: actual file paths, function names, test counts, design decisions.
   e. Describe what IS implemented, not what could be. Set Status to "Complete" or "In Progress".
```

**Log-worthy:** New user-facing capability, architectural refactor, correctness fix, new test coverage area.
**Skip:** Typo/cosmetic fixes, dependency updates, docs-only changes.

**References:**
- `prompts/quality-standards.md` — modularity, test, docs, and code rules
- `prompts/quality-check-prompt.md` — quick validation checklist to run before closing an iteration
