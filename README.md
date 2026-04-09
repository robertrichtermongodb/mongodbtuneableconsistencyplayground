# MongoDB Read & Write Concerns Playground

An interactive single-page simulator for exploring how MongoDB write concerns, read concerns, read preferences, and elections shape data flow in a 3-node replica set.

## Quick Start

Open `index.html` in a browser. No build step, no dependencies, no server required.

## Architecture

```
css/style.css     — all CSS (variables driven by theme)
js/
  theme.js        — dark/light design tokens, CSS variable injection
  state.js        — shared state, doc helpers, read target resolution
  logger.js       — log() function (separated to break circular dep)
  icons.js        — SVG Path2D constants
  texts.js        — all user-facing strings (step titles, tooltips, explanations)
  draw.js         — canvas rendering, hit testing, layout, consistency overlays
  engine.js       — step engines, button sync, panel display
  simulation.js   — write machine, read steps, election steps
  app.js          — custom tooltips, config badge, event handlers, popup logic, init
test/
  helpers.js      — VM-based test harness with browser stubs
  *.test.js       — ~119 tests across state, writes, reads, elections, topology locking
```

The simulator models a 3-node Primary-Secondary-Secondary replica set in a triangle topology. Each node tracks `memoryVersion` (volatile) and `journalVersion` (crash-safe). Writes flow through a lazy state machine that evaluates live topology on each step, dynamically retargeting when nodes crash or links partition mid-operation.

Key features: split-brain simulation via network partitioning and forced elections, client-to-node targeting (click clients to pick which node they talk to), draggable client circles, primary bounce and data-loss detection, and pedagogical safety notes referencing MongoDB's safe default (`w:majority`).

Dark/light theming via CSS custom properties. No build step. Scripts load via `<script>` tags in dependency order. Deployable as static files.

## Testing

```bash
npm test
```

Uses Node.js built-in `node:test` runner (Node 18+). Zero external dependencies. Tests run the simulation logic headlessly via `node:vm` with browser globals stubbed.

## AI Coding Workflow

When using an AI coding assistant on this project:

1. **Read** the [contributor guide](prompts/contributor-guide.md) for a quick project overview and conventions.
2. **Follow** the quality standards in [`prompts/quality-standards.md`](prompts/quality-standards.md) — modular structure, green tests, non-vanity test coverage.
3. **Create** an iteration log for every major change per [`prompts/iteration-log-prompt.md`](prompts/iteration-log-prompt.md). See [`logs/iterations/`](logs/iterations/) for existing logs and the template.
4. **Verify** the project state after changes using [`prompts/quality-check-prompt.md`](prompts/quality-check-prompt.md).

For smaller/cheaper AI models, see [`prompts/small-model-usage.md`](prompts/small-model-usage.md) for prompt templates and guidance. The [`.cursor/rules/tcp-project.mdc`](.cursor/rules/tcp-project.mdc) rule provides persistent context for Cursor sessions.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — detailed technical architecture, state model, engine mechanics
- [`docs/correctness.md`](docs/correctness.md) — correctness audit against MongoDB 8.0 docs (correct / incorrect / imprecise / missing)
- [`docs/research.md`](docs/research.md) — compressed MongoDB concern reference notes

## Disclaimer

This tool is **not** part of the official MongoDB documentation and is **not** maintained by MongoDB. It is an educational tool that simplifies workflows and omits details for clarity. Always consult the [official MongoDB documentation](https://www.mongodb.com/docs/manual/) before deploying anything to production.

## Author

[Robert Richter](https://www.linkedin.com/in/robert-richter-27b46812b/)
