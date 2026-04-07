# Iteration Log Prompt

```
After completing a major change, create an iteration log:

1. Read the template at `logs/iterations/TEMPLATE.md`.
2. Determine the next sequential ID from existing logs in `logs/iterations/`.
3. Create `logs/iterations/NN-short-kebab-name.md`.
4. Fill every section with specifics: actual file paths, function names, test counts, design decisions.
5. Describe what IS implemented, not what could be. Set Status to "Complete" or "In Progress".
```

**Log-worthy:** New user-facing capability, architectural refactor, correctness fix, new test coverage area.
**Skip:** Typo/cosmetic fixes, dependency updates, docs-only changes.
