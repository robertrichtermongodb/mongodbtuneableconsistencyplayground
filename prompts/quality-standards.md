# Quality Standards

1. **Modular structure** — Each `js/` file owns one concern: `state.js` (state + helpers), `simulation.js` (machines + steps), `engine.js` (step engines + UI sync), `draw.js` (canvas rendering), `app.js` (events + init). Shared logic goes in `state.js`. Don't mix concerns.
2. **Tests green** — `npm test` must pass. Fix broken tests in the same change. No skipped or TODO tests.
3. **Meaningful tests** — Every test asserts a state transition, error path, or correctness property. Cover happy path + at least one edge case. Remove tests that only check defaults.
4. **No dead code** — Remove unused functions, commented-out blocks, stale files.
5. **No build step** — Plain HTML, CSS, vanilla JS via `<script src>`. No bundlers, transpilers, or frameworks. Open `index.html` and it works.
6. **Browser support** — Must work on latest Chrome, Safari, Firefox. Mobile is best effort.
7. **Docs accurate** — After behavioral changes, update `docs/architecture.md` and `docs/correctness.md` in the same change.
8. **No secrets** — No access keys, passwords, tokens, or credentials in any file. If found, **stop and alert the user immediately** — do not silently remove or overwrite them.
9. **Iteration logs** — Create a log for every major change per `prompts/iteration-log-prompt.md`.
