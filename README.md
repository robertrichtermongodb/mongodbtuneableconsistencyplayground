# MongoDB Read & Write Concerns Playground ![v29](https://img.shields.io/badge/version-v29-brightgreen)

An interactive single-page simulator for exploring how MongoDB write concerns, read concerns, read preferences, and elections shape data flow in a 3-node replica set.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Testing](#testing)
- [AI Coding Workflow](#ai-coding-workflow)
- [Documentation](#documentation)
- [Quality Score](#quality-score)
- [Disclaimer](#disclaimer)
- [Version History](#version-history)
- [Author](#author)

## Quick Start

Open `index.html` in a browser. No build step, no dependencies, no server required.

## Architecture

```
css/style.css           — all CSS (variables driven by theme)
js/
  theme.js              — dark/light design tokens, CSS variable injection
  state.js              — shared state, doc helpers, read target resolution
  logger.js             — log() function (separated to break circular dep)
  icons.js              — SVG Path2D constants
  texts.js              — all user-facing strings (step titles, tooltips, explanations)
  animation.js          — particle animation loop, easing, skipAnimations control
  draw.js               — canvas rendering, hit testing, layout
  status-views.js       — consistency overlay views, read action controls
  engine.js             — step engines, button sync, panel display
  write-machine.js      — lazy write step generator (state machine)
  read-steps.js         — pre-built read step arrays
  election-steps.js     — pre-built election step arrays
  tooltips.js           — custom tooltip component (delegated mouseenter/mouseleave)
  app.js                — config badge, event handlers, client targeting, popup logic, init
test/
  helpers.js            — VM-based test harness with browser stubs; scenarioMode for engine pipeline
  scenario-helpers.js   — orchestration helpers for multi-operation integration tests
  *.test.js             — 153 tests across state, writes, reads, elections, topology, scenarios, client targeting
```

The simulator models a 3-node Primary-Secondary-Secondary replica set in a triangle topology. Each node tracks `memoryVersion` (volatile) and `journalVersion` (crash-safe). Writes flow through a lazy state machine that evaluates live topology on each step, dynamically retargeting when nodes crash or links partition mid-operation.

Key features: split-brain simulation via network partitioning and forced elections, client-to-node targeting (click clients to pick which node they talk to), draggable client circles, primary bounce and data-loss detection, and pedagogical safety notes referencing MongoDB's safe default (`w:majority`).

Dark/light theming via CSS custom properties. No build step. Scripts load via `<script>` tags in dependency order. Deployable as static files.

See [`docs/architecture.md`](docs/architecture.md) for a detailed module dependency diagram and technical deep-dive.

## Testing

```bash
npm test
```

Uses Node.js built-in `node:test` runner (Node 18+). Zero external dependencies. Tests run the simulation logic headlessly via `node:vm` with browser globals stubbed. Two test modes: basic (`createContext()`) for unit/integration tests, and `scenarioMode` for full engine pipeline tests.

## AI Coding Workflow

When using an AI coding assistant on this project:

1. **Read** the [contributor guide](prompts/contributor-guide.md) for a quick project overview and conventions.
2. **Follow** the quality standards in [`prompts/quality-standards.md`](prompts/quality-standards.md) — modular structure, green tests, non-vanity test coverage.
3. **Create** an iteration log for every major change per [`prompts/iteration-log-prompt.md`](prompts/iteration-log-prompt.md). See [`logs/iterations/`](logs/iterations/) for existing logs and the template.
4. **Verify** the project state after changes using [`prompts/quality-check-prompt.md`](prompts/quality-check-prompt.md).

For smaller/cheaper AI models, see [`prompts/small-model-usage.md`](prompts/small-model-usage.md) for prompt templates and guidance. The [`.cursor/rules/tcp-project.mdc`](.cursor/rules/tcp-project.mdc) rule provides persistent context for Cursor sessions.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — detailed technical architecture, module dependency diagram, state model, engine mechanics
- [`docs/correctness.md`](docs/correctness.md) — correctness audit against MongoDB 8.0 docs (correct / incorrect / imprecise / missing)
- [`docs/research.md`](docs/research.md) — compressed MongoDB concern reference notes

## Quality Score

The codebase tracks an architectural fitness function (11 metrics, max 22 points) defined in [`prompts/quality-standards.md`](prompts/quality-standards.md). The quality score must not decrease between code iterations — every change should leave the codebase at least as healthy as before.

**Current score: 19 / 22** (iteration 29, 2026-04-10)

## Disclaimer

This tool is **not** part of the official MongoDB documentation and is **not** maintained by MongoDB. It is an educational tool that simplifies workflows and omits details for clarity. Always consult the [official MongoDB documentation](https://www.mongodb.com/docs/manual/) before deploying anything to production.

## Version History

| Version | Iteration | Theme |
|---------|-----------|-------|
| v29 | [29 — draw.js split, client-targeting tests, docs refresh](logs/iterations/29-quality-docs-refresh.md) | Module extraction, test coverage for client targeting, documentation overhaul |
| v28 | [28 — Scenario integration tests](logs/iterations/28-scenario-integration-tests.md) | Multi-operation integration tests for all 7 UI scenarios |
| v27 | [27 — GPT-5.3 assessment remediation](logs/iterations/27-assessment-remediation.md) | Function splitting, nesting reduction, linearizable-to-secondary error |
| v26 | [26 — Quality refactoring part 5](logs/iterations/26-quality-refactoring-5.md) | Systematic function splitting (13 functions), deterministic measurement script |
| v25 | [25 — Quality refactoring part 4](logs/iterations/25-quality-refactoring-4.md) | CSS quality, test infrastructure, dead code removal |
| v24 | [24 — Quality refactoring part 3](logs/iterations/24-quality-refactoring-3.md) | Continued code quality improvements |
| v23 | [23 — Quality refactoring part 2](logs/iterations/23-quality-refactoring-2.md) | Continued code quality improvements |
| v22 | [22 — Quality refactoring](logs/iterations/22-quality-refactoring.md) | First quality-focused refactoring pass |
| v21 | [21 — Quality scorecard](logs/iterations/21-quality-scorecard.md) | Introduced architectural fitness function (11 metrics) |
| v20 | [20 — Bug fixes](logs/iterations/20-bug-fixes.md) | Rejoining node sync and deferred election rollback fixes |
| v19 | [19 — Topology locking & scenarios](logs/iterations/19-topology-locking-scenarios-topo-messaging.md) | UI locking during operations, scenarios panel, topology-aware messaging |
| v18 | [18 — Split-brain simulation](logs/iterations/18-split-brain-scenario.md) | Network partitioning and forced election scenarios |
| v17 | [17 — Read node phase fix](logs/iterations/17-read-node-phase-fix.md) | Reads no longer mutate node write-state |
| v16 | [16 — Centralize texts](logs/iterations/16-centralize-and-rewrite-texts.md) | All user-facing strings moved to `texts.js` |
| v15 | [15 — Primary journal before replication](logs/iterations/15-primary-journal-before-replication.md) | Corrected write ordering for pedagogical clarity |
| v14 | [14 — Consistency explanation](logs/iterations/14-consistency-explanation.md) | Improved consistency overlay explanations |
| v13 | [13 — Primary bounce & rollback risk](logs/iterations/13-primary-bounce-and-rollback-risk.md) | Data-loss detection and rollback risk visibility |
| v12 | [12 — Journal ordering fix](logs/iterations/12-journal-ordering-fix.md) | j:false deferred journal flush correction |
| v11 | [11 — Custom tooltips](logs/iterations/11-custom-tooltips.md) | Delegated tooltip component replacing native titles |
| v10 | [10 — Dropdown tooltips](logs/iterations/10-dropdown-tooltips.md) | Info tooltips on dropdown controls |
| v9 | [9 — Design tokens & theming](logs/iterations/09-design-token-theming.md) | Dark/light theme via CSS custom properties |
| v8 | [8 — Write rollback on failure](logs/iterations/08-write-rollback-on-failure.md) | Write failure paths with node state rollback |
| v7 | [7 — Linearizable runtime fix](logs/iterations/07-linearizable-runtime-fix.md) | Linearizable read topology checking at runtime |
| v6 | [6 — Primary liveness invariant](logs/iterations/06-primary-liveness-invariant.md) | Primary must be alive for writes to proceed |
| v5 | [5 — Phase progress trail](logs/iterations/05-phase-progress-trail.md) | Visual step-by-step phase indicators |
| v4 | [4 — Testing framework](logs/iterations/04-testing-framework.md) | Node VM-based test harness, initial test suite |
| v3 | [3 — Write state machine](logs/iterations/03-write-state-machine.md) | Lazy write step generator replacing static arrays |
| v2 | [2 — Memory vs disk layers](logs/iterations/02-memory-disk-layers.md) | Separate memory and journal version tracking |
| v1 | [1 — Initial simulator](logs/iterations/01-initial-simulator.md) | First working prototype |

## Author

[Robert Richter](https://www.linkedin.com/in/robert-richter-27b46812b/)
