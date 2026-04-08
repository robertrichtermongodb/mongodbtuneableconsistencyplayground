# Small Model Usage Considerations

This document describes actions taken to prepare the codebase for productive use with smaller, faster AI models (e.g., Cursor's "fast" model), and lists considerations for getting the best results.

---

## What was done to prepare

### 1. Cursor Rule (`.cursor/rules/tcp-project.mdc`)

An always-on project rule is automatically injected into every Cursor conversation. It covers:

- **File layout and load order** — prevents the model from creating files in wrong locations or breaking script ordering
- **File responsibilities** — one concern per file, so the model knows where to put new logic
- **Key invariants** — the non-obvious rules that cause bugs when violated (e.g., "never store derived state", "use `effectiveWriteTarget()` not raw `primaryKey`", "reads don't change node colors")
- **Testing workflow** — how to run tests, TDD approach
- **Common gotchas** — things that have tripped up even large models in the past

### 2. Contributor Guide (`prompts/contributor-guide.md`)

A "catch up in 60 seconds" document. If a small model seems confused about project structure, paste a reference to this file or tell it to read it. Contains:

- What the project is
- File map with one-line descriptions
- Key patterns (state model, write machine, texts, canvas)
- Pre-submission checklist

### 3. Strategic Code Comments

Added "why" comments to key functions where the logic is non-obvious:

- `effectiveWriteTarget()` — why it exists and that ALL write operations must use it
- `isReachableForWrite()` — reachability is relative to write target, not primary
- `isNodeIsolated()` — computed, not stored
- Write machine guard system — two-level guards and why
- `checkPartitionHealed()` — why no rollback is needed
- `drawReplicationLinks` sec-sec check — role-based, not link-key-based
- `draw()` role computation — dynamic, never stored

### 4. Test Gap Backlog (`prompts/test-gap-backlog.md`)

Prioritized list of untested areas. A smaller model can pick items off this list as standalone tasks — each is self-contained and well-scoped.

### 5. Existing Quality Infrastructure

Already in place from earlier iterations:

- `prompts/quality-standards.md` — 9 rules for code quality
- `prompts/quality-check-prompt.md` — 3-step validation checklist
- `prompts/iteration-log-prompt.md` — how to create iteration logs
- 122 automated tests covering state helpers, write machine, read steps, elections, client targeting

---

## Considerations for working with a smaller model

### What works well

- **Small, focused changes** — "fix this specific bug", "add a tooltip to X", "update the text in Y"
- **Test-first tasks** — "write a test for X, then make it pass" — the test harness is simple and well-documented
- **Text/UI changes** — editing `texts.js`, `css/style.css`, or `index.html`
- **Adding tests from the backlog** — items in `prompts/test-gap-backlog.md` are pre-scoped

### What to be careful with

- **Multi-file refactors** — the state model has invariants that span files. A small model may update `state.js` but forget to update `simulation.js` or `draw.js`. Always run tests after.
- **Canvas drawing code** — `draw.js` is 700+ lines of imperative canvas API calls. Small models may struggle with the coordinate math and layering.
- **Write machine modifications** — `createWriteMachine` is a complex lazy generator with guards, phases, and topology-aware branching. Changes here need careful testing.
- **Election logic** — `buildElectionSteps` has normal and force-partition paths with subtle differences.

### How to prompt effectively

1. **Start with**: "Read `prompts/contributor-guide.md` and `.cursor/rules/tcp-project.mdc` first."
2. **Be specific**: "In `js/texts.js`, update the explain text for `write.clientSend` to mention X" is better than "improve the write explanation."
3. **One task per message**: Don't batch 5 changes. The model does better with sequential, focused requests.
4. **Ask for tests**: "Write a failing test first, then implement" keeps the model on track.
5. **Verify**: After every change, ask the model to run `node --test test/*.test.js` and report results.
6. **Reference docs**: If the model makes a mistake related to MongoDB semantics, point it to `docs/correctness.md`.

### Standard prompt template

Copy and adapt this when framing change requests:

```
Context: Read `prompts/contributor-guide.md` for project overview.

Task: [one sentence describing what to change]

Scope:
- File(s): [list specific files, e.g. js/texts.js, js/simulation.js]
- What to change: [specific function, text, or behavior]
- Expected behavior after change: [what should happen]

Constraints:
- Run `node --test test/*.test.js` after changes — all must pass
- Do NOT modify files outside the listed scope without asking
- All user-facing text goes in js/texts.js
- Follow conventions in .cursor/rules/tcp-project.mdc

[Optional] Test first: Write a failing test in test/[file].test.js, then implement.
```

**Example — bug fix:**
```
Context: Read `prompts/contributor-guide.md` for project overview.

Task: Fix the write client line drawing to the wrong node after election.

Scope:
- File(s): js/draw.js
- What to change: drawWriteClientLine() uses a hardcoded node reference
- Expected behavior: Line always draws to effectiveWriteTarget()

Constraints:
- Run tests after — all must pass
- Don't change state.js or simulation.js
```

**Example — new test from backlog:**
```
Context: Read `prompts/contributor-guide.md` and `prompts/test-gap-backlog.md`.

Task: Implement test gap #2 — read-after-write consistency scenario.

Scope:
- File(s): test/reads.test.js
- What to add: Test that reads rc:local from a secondary before replication returns stale data (v0)
- Setup: Write w:majority, then read from s1 before replication step runs

Constraints:
- Run tests after — all 122+ must still pass
- Add new describe block, don't modify existing tests
```

### When to escalate to a larger model

- Architectural changes (new state fields, new file, new interaction pattern)
- Complex debugging where the model goes in circles
- Multi-step features that touch 4+ files
- Correctness audits against MongoDB documentation
- Creating new iteration logs (requires understanding the full change scope)

---

## File reference

| File | Purpose | Safe for small model? |
|------|---------|----------------------|
| `.cursor/rules/tcp-project.mdc` | Auto-injected project rule | Read-only reference |
| `prompts/contributor-guide.md` | Quick context onboarding | Read-only reference |
| `prompts/quality-standards.md` | Code quality rules | Read-only reference |
| `prompts/quality-check-prompt.md` | Pre-close checklist | Read-only reference |
| `prompts/test-gap-backlog.md` | Untested areas backlog | Source of tasks |
| `prompts/iteration-log-prompt.md` | How to create logs | Reference for log creation |
| `js/texts.js` | All UI strings | Yes — safe for edits |
| `css/style.css` | All styles | Yes — safe for edits |
| `index.html` | Page structure | Yes — safe for small edits |
| `js/state.js` | State + helpers | Moderate — has invariants |
| `js/simulation.js` | Write/read/election machines | Caution — complex logic |
| `js/draw.js` | Canvas rendering | Caution — 700+ lines |
| `js/app.js` | Event handlers | Moderate |
| `js/engine.js` | Step engine + buttons | Moderate |
| `test/*.test.js` | Tests | Yes — safe for additions |
