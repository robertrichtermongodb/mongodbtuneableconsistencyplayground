# Contributor Guide — Quick Context

## What is this?

An interactive browser-based simulator for MongoDB read/write concerns and replica set behavior. Users configure `w:`, `j:`, `rc:`, and `readPreference`, then step through write/read operations watching data flow through a 3-node replica set visualized on an HTML canvas.

## How to run

Open `index.html` in a browser. No build step, no server. Plain HTML + CSS + vanilla JS.

## How to test

```bash
node --test test/*.test.js
```

Test harness (`test/helpers.js`) loads JS source files into a Node VM with browser stubs. All animations are instant in tests.

## File map

```
index.html          — Single page, loads all JS/CSS
css/style.css       — All styles, CSS custom properties for theming
js/
  theme.js          — Design tokens, dark/light theme
  state.js          — Central state object + all helper functions
  texts.js          — ALL user-facing strings (titles, explains, tooltips)
  simulation.js     — Write machine, read steps, election steps
  engine.js         — Step engine runner, button sync
  draw.js           — Canvas rendering, hit testing, layout, animation
  app.js            — Event handlers, canvas interaction, init
  icons.js          — SVG path data
  logger.js         — Log panel helper
test/
  helpers.js        — VM-based test harness
  state.test.js     — State helpers and partition logic
  machine.test.js   — Write state machine scenarios
  reads.test.js     — Read concern step generation
  election.test.js  — Election and split-brain scenarios
docs/
  architecture.md   — Full technical architecture
  correctness.md    — Audit against official MongoDB docs
prompts/
  quality-standards.md      — Code quality rules
  quality-check-prompt.md   — Pre-close validation checklist
  iteration-log-prompt.md   — How to create iteration logs
logs/iterations/    — Numbered iteration logs (NN-short-name.md)
```

## Key patterns

### State model (`js/state.js`)

The `state` object is the single source of truth. Key fields:
- `state.nodes` — 3 nodes: `primary`, `s1`, `s2` (slot keys, not role keys)
- `state.primaryKey` — which slot is currently primary (changes on election)
- `state.links` — 5 booleans: `ps1`, `ps2`, `s1s2`, `wp`, `rp`
- `state.writeClient.targetNode` / `state.readClient.targetNode` — manual client targeting (null = auto)

### Write machine (`js/simulation.js`)

`createWriteMachine(w, j)` returns a lazy step generator. Call `.nextStep()` to get the next step, then `step.run()`. The machine re-evaluates live topology on each call — if a node crashes mid-write, it adapts automatically.

### Texts (`js/texts.js`)

Every user-facing string lives here. When changing step titles or explains, edit `texts.js`, not the simulation/engine code.

### Canvas (`js/draw.js`)

The `draw()` function redraws the entire canvas every frame. Layout is computed in `computeLayout()`. Hit testing in `hitTest()` determines what the user clicked/hovered.

## Before submitting changes

1. `node --test test/*.test.js` — all 122+ tests must pass
2. Check `docs/architecture.md` and `docs/correctness.md` for stale content
3. For major changes: create iteration log per `prompts/iteration-log-prompt.md`
4. Update `index.html` footer "Last updated" with date AND time
