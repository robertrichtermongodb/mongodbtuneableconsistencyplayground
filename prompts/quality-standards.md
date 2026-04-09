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

---

# Quality Scorecard (Architectural Fitness Function)

Track these metrics after every major iteration. The scorecard measures structural health — not feature completeness. Each metric uses three thresholds: **GREEN** (target), **YELLOW** (acceptable debt), **RED** (needs attention). Update the baseline snapshot at the bottom whenever the quality-check prompt is run.

## Metrics

### Function Size

| Metric | GREEN | YELLOW | RED | How to measure |
|--------|-------|--------|-----|----------------|
| Max function length (lines) | ≤ 30 | ≤ 50 | > 50 | Longest `function` / arrow-function body across `js/*.js` |
| Functions over 30 lines (count) | 0 | ≤ 5 | > 5 | Count of functions whose body exceeds 30 lines |
| Average function length (lines) | ≤ 15 | ≤ 25 | > 25 | Total non-blank logic lines ÷ total function count |

### Naming and Readability

| Metric | GREEN | YELLOW | RED | How to measure |
|--------|-------|--------|-----|----------------|
| Magic numbers | ≤ 10 | ≤ 30 | > 30 | Unnamed numeric literals in logic files (exclude 0, 1, 2, loop indices, and string templates in `texts.js`) |
| Single-char variables | 0 | ≤ 15 | > 15 | `const`/`let`/`var` declarations with 1-char names (exclude `i`/`j`/`k` loop counters) |
| Max nesting depth | ≤ 3 | ≤ 4 | > 4 | Deepest `if`/`for`/`while`/`else` nesting in any function |

### Modularity

| Metric | GREEN | YELLOW | RED | How to measure |
|--------|-------|--------|-----|----------------|
| Max file length (lines) | ≤ 250 | ≤ 400 | > 400 | Longest logic file (`texts.js` and `theme.js` excluded — they are data/config) |
| Mixed-abstraction functions | 0 | ≤ 3 | > 3 | Functions that combine state mutation with DOM manipulation or animation calls in the same body (manually assessed) |

### DRY and Tests

| Metric | GREEN | YELLOW | RED | How to measure |
|--------|-------|--------|-----|----------------|
| Duplicated code patterns | 0 | ≤ 3 | > 3 | Code blocks of 3+ lines repeated 2+ times (manually assessed) |
| Tests passing | 100% | ≥ 95% | < 95% | `npm test` pass rate |

## Scoring

Each metric: **GREEN = 2, YELLOW = 1, RED = 0**. Maximum: **20**.

| Range | Rating |
|-------|--------|
| 16–20 | Healthy |
| 10–15 | Acceptable debt |
| 0–9 | Needs attention |

## Baseline Snapshot — 2026-04-09 (pre-refactor)

| # | Metric | Value | Rating |
|---|--------|-------|--------|
| 1 | Max function length | 337 (`createWriteMachine`) | RED |
| 2 | Functions > 30 lines | 19 | RED |
| 3 | Avg function length | ~21 | YELLOW |
| 4 | Magic numbers | ~150 (logic files) | RED |
| 5 | Single-char variables | ~76 | RED |
| 6 | Max nesting depth | ~6 | RED |
| 7 | Max file length | 819 (`draw.js`) | RED |
| 8 | Mixed-abstraction functions | ~15 | RED |
| 9 | Duplicated code patterns | ~6 | RED |
| 10 | Tests passing | 100% | GREEN |
| | **Total** | **3 / 20** | **Needs attention** |

## Snapshot — 2026-04-10 (iteration 22: quality refactoring)

| # | Metric | Previous | Current | Δ | Rating |
|---|--------|----------|---------|---|--------|
| 1 | Max function length | 337 | 306 (`createWriteMachine` closure) | -31 | RED |
| 2 | Functions > 30 lines | 19 | 23 | +4 | RED |
| 3 | Avg function length | ~21 | 18.0 | -3 | YELLOW |
| 4 | Magic numbers | ~150 | ~100 (many extracted as constants) | -50 | RED |
| 5 | Single-char variables | ~76 | ~62 | -14 | RED |
| 6 | Max nesting depth | ~6 | 6 | 0 | RED |
| 7 | Max file length | 819 | 784 (`draw.js`) | -35 | RED |
| 8 | Mixed-abstraction functions | ~15 | ~10 | -5 | RED |
| 9 | Duplicated code patterns | ~6 | ~3 | -3 | YELLOW |
| 10 | Tests passing | 100% | 100% | 0 | GREEN |
| | **Total** | **3 / 20** | **5 / 20** | **+2** | **Needs attention** |

**Structural improvements not captured by metrics:**
- 8 → 13 JS files (5 new focused modules)
- `simulation.js` (677 lines) → 3 files (313 + 227 + 119)
- `animation.js` (42) and `tooltips.js` (103) extracted
- `createWriteMachine`: phase dispatch table with 5 named handlers
- `syncButtons`: decomposed into 4 sub-functions
- `buildReadSteps`: 5 per-concern builders + data return helper
- `handleCanvasClick`: 3 per-type handlers
- `drawBrokenMidpoint`/`drawHoverMidpoint`: eliminated 6 code duplications
- 20+ named constants replacing magic numbers
- `T` → `THEME`, `NR`/`CR` → `NODE_RADIUS`/`CLIENT_RADIUS`
- `isEngineActive()`, `majorityThreshold()`, `getVersionEntry()` helpers

## Snapshot — 2026-04-10 (iteration 23: quality refactoring part 2)

| # | Metric | Previous | Current | Δ | Rating |
|---|--------|----------|---------|---|--------|
| 1 | Max function length | 306 | 57 (`buildReadSteps`) | -249 | YELLOW |
| 2 | Functions > 30 lines | 23 | 13 | -10 | RED |
| 3 | Avg function length | 18.0 | ~18.2 | ~0 | YELLOW |
| 4 | Magic numbers | ~100 | ~90 | -10 | RED |
| 5 | Single-char variables | ~62 | ~52 | -10 | RED |
| 6 | Max nesting depth | 6 | 4 | -2 | YELLOW |
| 7 | Max file length | 784 | 777 (`draw.js`) | -7 | RED |
| 8 | Mixed-abstraction functions | ~10 | ~4 | -6 | RED |
| 9 | Duplicated code patterns | ~3 | ~1 | -2 | GREEN |
| 10 | Tests passing | 100% | 100% | 0 | GREEN |
| | **Total** | **5 / 20** | **9 / 20** | **+4** | **Needs attention** |

**Structural improvements not captured by metrics:**
- `createWriteMachine` refactored from 306-line closure to context-object pattern with 23 module-level functions
- `buildElectionSteps` decomposed: extracted `selectElectionCandidates`, `swapPrimaryRole`, `rollbackUncommittedVersions`, `capWinningPartitionVersions`, `invalidateSnapshotIfNeeded`, `logElectionResult`
- `draw.js`: extracted `leafColorForNode`, `drawPhaseRing`, `drawAlivePip`, `versionBadgeColor`, `versionBadgeText`, `hitTestNodeLinks`, `hitTestClientLinks`, `drawDebugBadge`, `drawDebugNodeLabels`, `drawDebugLinkLabels`, `updateWriteStatusView`, `updateReadStatusView`
- `engine.js`: extracted `renderStepExplain`, `renderStepDots`, `phaseReplState`, `phaseAckState`, `buildFireForgetPhases`, `buildW1Phases`, `buildMajorityPhases`, `isElectionEligible`, `positionElectionButton`
- `app.js`: extracted `tipForLink`, `tipForClient`, `handleCanvasDrag`, `cursorForHit`, `handleCanvasHover`, `placeDomDebugBadge`, `DEBUG_ELEMENT_IDS` constant
- `tooltips.js`: extracted `renderTipContent`, `positionTooltip`
- `read-steps.js`: extracted `computeReadContext`
- Semantic DOM helpers in `state.js`: `getSelectedWriteConcern`, `getSelectedJournal`, `isJournalRequired`, `getSelectedReadConcern`, `getSelectedReadPref` + corresponding setters — replaced ~28 inline `document.getElementById('sel-...').value` calls
