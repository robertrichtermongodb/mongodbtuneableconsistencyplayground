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
   f. Update the "Last updated" line in the `index.html` footer to today's date AND time (e.g. "April 7, 2026 22:00 CEST"). Always include both date and time — never drop the time component.
   g. Bump the version number everywhere it appears:
      - `index.html`: footer `v__` link, header version badge text, and the `data-tip` tooltip in `app.js` (update summary + test count).
      - `README.md`: shields.io badge in the `#` header, "Current score" line, and add a new row at the top of the Version History table.
      - **Badge tooltip format:** title line "Good things happened in vNN", then 2–4 checkmark bullet points summarizing key changes, then a closing line with "All NNN tests passing ✔". Do NOT include the quality score in the badge tooltip.
```

**Log-worthy:** New user-facing capability, architectural refactor, correctness fix, new test coverage area.
**Skip:** Typo/cosmetic fixes, dependency updates, docs-only changes.

**References:**
- `prompts/quality-standards.md` — modularity, test, docs, and code rules
- `prompts/quality-check-prompt.md` — quick validation checklist to run before closing an iteration
