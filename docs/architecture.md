# MongoDB Concerns Playground — Architecture & State Overview

*Last updated 2026-03-15 from a complete review of the live codebase (Iteration 14).*

---

## 1. Purpose

An interactive single-page simulator for exploring how MongoDB **write concerns**, **read concerns**, **read preferences**, and **elections** shape data flow, consistency, and durability in a 3-node replica set (Primary + 2 Secondaries).

**Framing (welcome popup):** MongoDB is fully consistent by default — not eventually consistent. This tool lets users experience the knobs MongoDB exposes to tune consistency properties.

---

## 2. File Structure

```
index.html              — layout, popups, script tags, footer (no inline CSS or JS)
css/style.css           — all CSS (variables driven by theme.js)
js/
  theme.js              — design tokens (dark/light), CSS variable injection, toggle logic
  state.js              — shared state, doc helpers, resolveReadTarget, getLinkBetween
  logger.js             — log() function (separated to break circular dep)
  icons.js              — SVG Path2D constants (ICON_LEAF, ICON_RS)
  draw.js               — canvas rendering, hit testing, consistency overlays, layout
  engine.js             — step engines, runMachine, arrayMachine, syncButtons, showStepPanel, auto-finish
  simulation.js         — createWriteMachine(), buildReadSteps(), buildElectionSteps()
  app.js                — custom tooltips, non-default badge, event handlers, popup logic, init
test/
  helpers.js            — VM-based test harness loading source files with browser stubs
  state.test.js         — unit tests for state.js pure functions
  machine.test.js       — write machine scenario tests (w:1, w:majority, crash-retarget, bounce, etc.)
  reads.test.js         — read concern + preference scenario tests
  election.test.js      — election scenario tests (quorum, rollback, winner selection)
package.json            — npm test script (node --test, zero dependencies)
docs/
  architecture.md       — this file
  correctness.md        — correctness audit: correct / incorrect / imprecise / missing
  research.md           — compressed MongoDB concern reference (still valid)
  mongodb-read-write-concerns.md — structured rc/wc reference (still valid)
  ha-scenarios.md       — HA scenarios extracted from PPTX (still valid)
  DEPRECATED_*.md       — superseded docs kept for history
prompts/
  quality-standards.md  — AI coding quality standards for this project
  iteration-log-prompt.md — prompt template for creating iteration logs
  quality-check-prompt.md — post-change verification checklist
logs/iterations/        — iteration logs (01–14) + TEMPLATE.md
index.v1–v6.html        — legacy HTML snapshots (not used)
```

Script load order: `theme.js` (in `<head>`) → `state.js → logger.js → icons.js → draw.js → engine.js → simulation.js → app.js` (at end of `<body>`). No build step; deployable to GitHub Pages as static files.

Test runner: Node.js built-in `node --test` (Node 18+). Run with `npm test`. Tests use `node:vm` to load source files in an isolated context with browser globals stubbed.

---

## 3. State Model (`js/state.js`)

```javascript
state = {
  nodes: {
    primary: { label, x, y, alive, phase, memoryVersion, journalVersion },
    s1:      { ... },
    s2:      { ... },
  },
  primaryKey: 'primary',  // current primary — changes on election (can become 's1' or 's2')
  writeClient: { x, y, phase, lastWrittenVersion },
  readClient:  {
    x, y, phase,
    lastReceivedVersion: { id, dirty } | null,
    sessionActive: bool,
    sessionSnapshotId: number | null,
  },
  particles:   [],
  links: {
    ps1: bool,  // physical wire 'primary'-slot ↔ 's1'-slot
    ps2: bool,  // physical wire 'primary'-slot ↔ 's2'-slot
    wp:  bool,  // writer → current primary
    rp:  bool,  // reader → target
  },
  doc: {
    versions: [{ id, op, ackedBy: Set<nodeKey> }],
    latestId: number,
    majorityCommitId: number,
  },
}
```

**Node phases:** `idle | active | acked | error | reading | serving | waiting | received | candidate | recovering`

### Storage layer model

Each node has two version fields modeling the WiredTiger storage engine:

- **`memoryVersion`** — data in the WiredTiger in-memory cache. Queryable via `rc:local`. Volatile: lost on crash.
- **`journalVersion`** — data flushed to the on-disk journal (WAL). Crash-safe: survives node restart.

Write flow per node: memory apply → journal flush. The `ackedBy` addition is gated by write concern:
- `j:false` (and not `w:majority`): ack counted on memory apply (fast path)
- `j:true` or `w:majority` (default `writeConcernMajorityJournalDefault:true`): ack counted on journal flush

Crash behavior:
- **Node kill:** `memoryVersion` wiped to 0, `journalVersion` preserved. Acks for versions > `journalVersion` retracted; `majorityCommitId` recomputed.
- **Node restart:** `memoryVersion = journalVersion` (recover from journal). Node enters `recovering` phase (600ms) before returning to `idle`.

### Key helpers

| Function | Location | Purpose |
|---|---|---|
| `resetDoc()` | state.js | Clears all doc/version state AND resets `primaryKey` + node labels to defaults |
| `resetLinks()` | state.js | Sets all 4 links to `true` |
| `getLinkBetween(a, b)` | state.js | Returns the link key (`'ps1'` or `'ps2'`) for two node slot keys, or `null` for s1↔s2 |
| `isReachableForWrite(key)` | state.js | Node alive AND link from current primary to it is connected |
| `getServedVersion(nodeKey, rc)` | state.js | Returns `{ id, dirty }` based on `memoryVersion` (rc:local/available) or `majorityCommitId` (others) |
| `advanceMajorityCommit()` | state.js | Scans versions backward; cumulative: if vN has ≥2 acks, all prior are committed |
| `recomputeMajorityCommit()` | state.js | Full recomputation from scratch (used after crash retracts acks) |
| `journalFlush(nodeKey)` | state.js | Sets `journalVersion = memoryVersion` — models WiredTiger journal write |
| `crashNode(nodeKey)` | state.js | Wipes `memoryVersion` to 0, retracts acks above `journalVersion`, recomputes majority |
| `recoverNode(nodeKey)` | state.js | Sets `memoryVersion = journalVersion` — models journal recovery on restart |
| `resolveReadTarget(rc, readPref)` | state.js | Picks which node serves a read (needed by both draw.js and simulation.js) |

---

## 4. Engines (`js/engine.js`)

Three engine instances, all structurally identical:

```javascript
{ mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false,
  done: false, aborted: false, _autoFinishId: null, _machine: null }
```

- **writeEngine** — drives the write state machine
- **readEngine** — drives read step sequences
- **electionEngine** — drives election steps; **borrows the write panel** (the write step panel switches to "ELECTION" mode via CSS class `.election-mode`)

### `runMachine(machine, eng, panelId)`

Unified engine loop that drives any **machine** (lazy generator or wrapped array). The machine produces steps one at a time via `machine.nextStep()`. Each step is displayed in the panel, waits for user click via `waitForClick()`, then executes. Step 0 runs immediately; subsequent steps wait.

The engine's `steps` array is the machine's growing `history`, so `showStepPanel` and `syncButtons` work unchanged. The step badge shows "Step X of Y+" while the machine isn't done.

If the engine is aborted (via `abortEngine` or `resetEngine`), the `while` loop breaks cleanly — **no remaining steps are executed after abort**.

### `arrayMachine(steps)`

Wraps a pre-built step array (from `buildReadSteps` or `buildElectionSteps`) as a machine with the `{ history, isDone, nextStep() }` interface.

### `resetEngine(eng)`

Centralised field reset: aborts, resolves any pending waitForClick promise, clears all fields including `_machine`, cancels any auto-finish interval. Used by `resetWriteVisual()`, `resetReadVisual()`, `resetElectionVisual()`.

### `_autoFinish(eng, advanceFn)` / `autoFinishWrite|Read|Election()`

Skips animations (`setSkipAnimations(true)`) and drives the engine to completion instantly via a 10ms polling interval that resolves `waitForClick` when the engine is idle. Used by the "Finish" button.

### `syncButtons()`

Called after every state transition. Manages:
- Write start button: disabled during `writeActive || electionActive`; tooltip explains why
- Write panel Next/Finish: routes to election engine if `electionActive`, else write engine (via `handleWritePanelNext()` / `handleWritePanelFinish()`)
- Finish buttons: disabled and greyed out until the engine's first step has started (`idx === -1`)
- Read start button: disabled during `readActive`; tooltip
- Snapshot session buttons: disabled with per-button tooltip reasons
- `sel-w`, `sel-j`: locked during `writeActive` with tooltip
- `sel-rc`, `sel-readpref`: locked during `readActive` with tooltip
- Canvas election button: shown/hidden + positioned below dead primary node; requires `aliveCount >= majorityNeeded` (quorum check)
- Write panel `.election-mode` CSS class toggle

### `showStepPanel(i, eng, panelId)`

Uses `PANEL_EL_IDS` lookup map (not string manipulation). Step explain text rendered inside `<details>` (collapsed by default; open/closed state persisted across step transitions).

---

## 5. Simulation (`js/simulation.js`)

### `createWriteMachine(w, j)` — lazy step generator

Returns a machine `{ history, isDone, nextStep() }` that dynamically evaluates the live topology to decide the next step. When a node crashes or a link partitions mid-replication, the machine re-targets remaining alive secondaries automatically.

**Internal phase progression:** All paths follow the same structure:
- `send` → `primaryMem` → `primaryJournal` → `repl` → `done`
- `w:0` branches: `send` → `primaryMem` → `primaryJournal` → `fireForget` → `done`

The primary always flushes to journal before any replication begins, regardless of `j:true/false`. The `j` flag only affects *when the ack counts* (memory apply for j:false, journal flush for j:true).

**Internal state tracked across steps:**
- `replicated: Set` — secondaries with both memory + journal done
- `memApplied: Set` — secondaries with memory done, awaiting journal
- `pendingJournal: nodeKey|null` — secondary whose journal step is next (j:true/w:majority path)
- `acked: bool` — whether the ACK has been sent to the client

**Step generation logic:**
0. Guard: `w:0 + j:true` → demote to `w:1` (per MongoDB docs, server requires primary ACK after journal flush)
1. Guard: writer disconnected → error step → done
2. Guard: primary dead or bounced (data lost) → error/abort step → done
3. Client sends particle → primary
4. **Primary memory apply** — `memoryVersion = nextId`. If `j:false` and not `w:majority`: ack counted here (fast path).
5. **Primary journal flush** — `journalVersion = nextId`. If `j:true` or `w:majority`: ack counted here. Always runs before replication.
6. `w:0` → fire-and-forget step with parallel async replication → done
7. **Replication loop** (the dynamic heart, evaluated on each `nextStep()` call):
   - **j:false interleave:** if a secondary just finished memory apply (`memApplied` non-empty), flush its journal immediately (one at a time, before picking the next secondary)
   - **j:true / w:majority:** if `pendingJournal` exists and node is reachable → journal flush step; if crashed → skip, retarget
   - If write concern satisfied and not yet acked → ACK step
   - If eligible secondary available → memory apply step (sets `pendingJournal` for j:true, or `memApplied` for j:false)
   - If write concern NOT satisfied and no more secondaries → error step
   - If all replication done → cleanup step (reset nodes to idle)

**Example step sequences:**
- `w:1 j:false`: send → primaryMem → primaryJournal → ACK → S1Mem → S1Journal → S2Mem → S2Journal → done
- `w:1 j:true`: send → primaryMem → primaryJournal → ACK → S1Mem → S1Journal → S2Mem → S2Journal → done
- `w:majority j:false`: send → primaryMem → primaryJournal → S1Mem → S1Journal → ACK → S2Mem → S2Journal → done
- `w:2 j:false`: send → primaryMem → primaryJournal → S1Mem → S1Journal → ACK → S2Mem → S2Journal → done
- `w:3 j:false`: send → primaryMem → primaryJournal → S1Mem → S1Journal → S2Mem → S2Journal → ACK → done

**Primary data integrity invariant:**
- `primaryAlive()` — checks `state.nodes[primaryKey].alive`
- `primaryHasData()` — checks `memoryVersion >= nextId` (data still in memory after a bounce)
- `primaryCanServe()` — both alive AND has data; used by all steps after `primaryMem`
- `primaryUnavailableStep()` — handles dead primary (error) and bounced-but-lost-data primary (abort if acked, error if not)
- `guardRun(fn)` / `guardRunAlive(fn)` — wrappers for step `run()` functions that check invariants before executing

**Pedagogical safety notes:**
- `isDefault` and `defaultNote` — when `w !== 'majority'`, error/ACK explain texts append a blue info note explaining that the MongoDB default (`w:majority` since v5.0) prevents the demonstrated issue.

Run-time liveness guards in step `run()` functions ensure that if a node dies between `nextStep()` (step generation) and `step.run()` (step execution), the step skips gracefully and the machine retargets on the next iteration.

### `buildReadSteps(rc, readPref, snapshotOverrideId?)`

Returns a pre-built step array (wrapped with `arrayMachine` in app.js).

1. Guard: reader disconnected → error
2. Resolve target via `resolveReadTarget()`
3. Client sends particle → target
4. Guard: target dead → error
5. RC-specific steps (local/available, majority, snapshot, linearizable)
6. Return data particle → client

### `buildElectionSteps()`

Returns a pre-built step array (wrapped with `arrayMachine` in app.js).

1. Picks candidates: alive non-primary nodes sorted by `memoryVersion` descending
2. **Quorum check:** requires `totalAlive >= majority` (2 of 3). If not met, returns error step explaining RAFT majority requirement
3. **Step 1 — Campaign:** winner enters `candidate` phase (purple dashed ring), explain text describes RAFT mechanics
4. **Step 2 — Elected:** winner becomes primary, old primary relabeled "Old Primary", uncommitted writes rolled back (both `memoryVersion` and `journalVersion` capped), snapshot sessions invalidated if locked version was rolled back

---

## 6. Canvas Rendering (`js/draw.js`)

Draw cycle order:
1. Dark background fill
2. `drawRSBox()` — dashed boundary with RS icon + "Replica Set · 3-node P-S-S · majority = 2"
3. `drawReplicationLinks()` — uses `getLinkBetween()` for dynamic primary; amber × for partition, red × for dead
4. `drawWriteClientLine()` / `drawReadClientLine()` — to current primary / resolved target
5. `drawNode()` for each node — role determined dynamically by `k === state.primaryKey`; candidate phase shows purple dashed ring; recovering phase shows blue dashed ring
6. `drawWriteClient()` / `drawReadClient()` — session ring + "Session @ vX" label when active
7. `drawDocLedger()` — floating box between clients showing doc #1 state (in-flight vs committed vs durable)
8. `drawParticles()` — eased animation at `PARTICLE_MS=1400ms`
9. `updateConsistencyViews()` — writer/reader HTML overlays (includes "Acknowledged but LOST" state detection and default-safety callout notes)
10. `updateReadActionControls()` — snapshot button visibility

### Node doc badge (two-row storage layers)

`drawNodeDocBadge(node)` renders a **two-row stacked badge** below each node, always visible (even at v0):

```
┌──────────────┐
│ MEM    v3    │  ← memoryVersion (amber if above majorityCommit, green if committed)
├──────────────┤
│ DISK   v3    │  ← journalVersion (green when flushed, dim dash if not yet)
└──────────────┘
```

When memory is ahead of disk (data in cache but not journaled), a down-arrow indicator appears between rows.

`canvasW`/`canvasH` cached in `resizeCanvas()` (not re-read via `getBoundingClientRect()` per frame). `sel-w`/`sel-rc`/`sel-readpref` read once per draw cycle and passed as arguments.

Layout: `computeLayout()` uses fixed absolute `topY = 40` (clients) and `nodeY = 245` (nodes) for consistent spacing regardless of canvas height. Canvas height is `365px`.

### Hit testing

`hitTest(mx, my)` → `{ type: 'node'|'link'|'clientLink', key }`. Node hits use `NR + 5` radius; link hits use `pointToSegDist` with `NR + 8` dead zones around endpoints; client link hits use `CR + 5`.

### Canvas election button

A `<button>` absolutely positioned inside `.stage`, shown/hidden by `syncButtons()`. Positioned at `(14 + pNode.x, 14 + pNode.y + NR + 18)` via inline style when the current primary is dead and candidates exist. Includes RAFT tooltip on hover.

### Animation control

`skipAnimations` flag and `setSkipAnimations()` accessor. When true, `awaitParticle()` and `delay()` resolve instantly — used by the "Finish" button for instant completion.

---

## 7. Theming (`js/theme.js`)

Two complete themes (dark/light) defined as flat token objects in `THEMES`. On load and toggle:
1. All tokens written to `document.documentElement.style` as CSS custom properties (`--pageBg`, `--green`, etc.)
2. Canvas-specific tokens exposed on global `T` object for `draw.js` (which can't use CSS variables in `CanvasRenderingContext2D`)
3. Theme preference persisted to `localStorage` key `tcp-theme`

Toggle button: `btn-theme-toggle` in the topo bar.

---

## 8. App Logic (`js/app.js`)

### Custom tooltip system

A delegated tooltip component using `mouseenter`/`mouseleave` on `document` (capturing phase). Any element with `data-tip` gets a styled tooltip after a 420ms hover delay. Tooltip supports title + body (split on `\n\n`). Positioned above the target with an arrow, auto-repositioned to stay within viewport.

### Tooltip definitions

- `DROPDOWN_TIPS` — per-value tooltip maps for `sel-w`, `sel-j`, `sel-rc`, `sel-readpref` dropdowns; updated via `syncTooltips()` on change
- `BUTTON_TIPS` — static tooltips for all action buttons

### Non-default config badge

`syncWBadge()` updates the `#w-default-badge` element next to the `w` dropdown:
- `w:majority` → green "✓ DEFAULT" with tooltip explaining safety
- Any other value → amber "⚠ NON-DEFAULT" with tooltip explaining rollback risk

### Event binding

All via `addEventListener` (no inline `onclick`). Button IDs: `btn-reset`, `btn-write-start`, `btn-write-next`, `btn-write-finish`, `btn-read-start`, `btn-read-session-start`, `btn-read-session-again`, `btn-read-session-end`, `btn-read-next`, `btn-read-finish`, `btn-canvas-election`, `btn-dismiss-welcome`, `btn-dismiss-wip`, `btn-theme-toggle`.

### Write/Read/Election handlers

- `handleWrite()` → `runMachine(createWriteMachine(w, j), writeEngine, 'write-step-panel')`
- `handleRead()` → `runMachine(arrayMachine(buildReadSteps(rc, readPref)), readEngine, 'read-step-panel')`
- `handleElection()` → `runMachine(arrayMachine(buildElectionSteps()), electionEngine, 'write-step-panel')`

### Canvas interaction

- **Node click:** toggle alive/dead. On kill: `crashNode()` wipes memory, preserves journal, retracts memory-only acks, recomputes majority. On restart: `recoverNode()` restores memory from journal, enters `recovering` phase for 600ms. **If a write is in progress, the write engine is NOT reset** — the write machine adapts dynamically on its next `nextStep()` call. Read and election engines are reset.
- **Link click:** toggle partition via `getLinkBetween()`; same behavior — write engine preserved if active, read/election reset
- **Client link click:** toggle wp/rp; if mid-engine, aborts that engine and marks client as error

### Popups

Welcome popup shown once per browser (uses `localStorage` key `tcp-welcome-seen`). WIP popup always follows welcome dismissal.

### Election flow

`handleElection()` → resets all three engines → runs `buildElectionSteps()` through the `electionEngine` into `'write-step-panel'`. The write panel gains `.election-mode` class which hides the start button and changes the label/border to purple.

---

## 8. Page Layout

```
┌───────────────────────────────────────────────────────────┐
│ Welcome popup (first visit only via localStorage)          │
│ WIP popup (always follows welcome)                         │
├───────────────────────────────────────────────────────────┤
│ Header + topo hint bar + Reset ↺                           │
├────────────┬──────────────────────────┬───────────────────┤
│ Write      │  Step panels (2-col)     │  Read             │
│ config     │  ┌──────────┬──────────┐ │  config           │
│ (w, j)     │  │ WRITE    │ READ     │ │  (rc, readPref)   │
│            │  │ or       │          │ │                   │
│            │  │ ELECTION │          │ │                   │
│            │  └──────────┴──────────┘ │                   │
├────────────┴──────────────────────────┴───────────────────┤
│ Canvas stage (position:relative, height:365px)             │
│  [writer overlay]    [animation area]   [reader overlay]   │
│  [Write Client]      [doc ledger]       [Read Client]      │
│       │                                      │             │
│       └──────[Primary/Old Primary]───────────┘             │
│                /              \                             │
│       [Secondary 1]    [Secondary 2]                       │
│                                                            │
│  [⚡ Trigger Election] ← appears below dead primary        │
├───────────────────────────────────────────────────────────┤
│ Event log (monospace, max-height:120px, scrollable)         │
├───────────────────────────────────────────────────────────┤
│ Footer (docs links, GitHub, disclaimer)                     │
└───────────────────────────────────────────────────────────┘
```

---

## 10. Testing (`test/`)

85 tests across 4 files, zero external dependencies. Uses Node's built-in `node:test` runner.

### Test harness (`test/helpers.js`)

Uses `node:vm` to load `state.js`, `simulation.js`, and `engine.js` into an isolated V8 context with browser globals stubbed:
- `log`, `draw`, `startAnimLoop` → no-ops
- `awaitParticle` → immediately calls `onArrive` callback and resolves
- `skipAnimations = true` → `delay()` resolves instantly
- Minimal DOM stubs for `syncButtons` compatibility

### Test coverage

| File | Tests | Covers |
|---|---|---|
| `state.test.js` | 24 | `journalFlush`, `crashNode` (ack retraction, majority recompute), `recoverNode`, `advanceMajorityCommit`, `recomputeMajorityCommit`, `resolveReadTarget`, `getServedVersion`, `isReachableForWrite` |
| `machine.test.js` | 35 | Write machine: w:1/2/3/majority/0, j:true/false, w:0+j:true demotion, writer disconnect, primary down, crash-retarget, unsatisfiable wc, link partition, sequential writes, node phase transitions, **interleaved journal ordering** (j:false), **primary bounce scenarios** (data lost pre/post-ACK) |
| `reads.test.js` | 16 | Read steps: rc:local (dirty flag), rc:majority (frozen), rc:linearizable (blocks, runtime topology, fresh served value), rc:snapshot (session lock), reader disconnect, primary dead fallback |
| `election.test.js` | 10 | Election: winner selection (highest oplog), quorum failure, rollback of uncommitted writes, majority-committed preserved, version capping, snapshot session invalidation |

---

## 11. Known Bugs & Limitations

> For a full correctness audit (correct / incorrect / imprecise / missing), see `docs/correctness.md`.

### Bugs

| # | Description | Severity | Status |
|---|---|---|---|
| ~~B1~~ | ~~**`w:0 + j:true` not demoted to `w:1`** — simulator showed fire-and-forget; MongoDB demotes to w:1.~~ | High | ✅ Fixed |
| ~~B2~~ | ~~**`w:majority + j:false` explain text wrong** — implied fragility on default config where `writeConcernMajorityJournalDefault:true` overrides j.~~ | Medium | ✅ Fixed |
| ~~B3~~ | ~~**Election succeeded with 1 alive node** — RAFT requires majority (2 of 3). Simulator allowed election with 1 secondary.~~ | High | ✅ Fixed |
| ~~B4~~ | ~~**Static step array didn't adapt to topology changes** — crashing a node mid-replication still produced ACK from retracted acks.~~ | High | ✅ Fixed (write state machine) |
| B5 | **`getLinkBetween` only knows primary↔s1 and primary↔s2 slot pairs** — after election where s1 becomes primary, the s1↔s2 link returns `null`. Partition toggling between the new primary and remaining secondary doesn't work. | Medium | Open |
| B6 | **`resolveReadTarget` ignores reader network reachability** — checks `node.alive` but not per-node reader connectivity. Single `rp` boolean is a model simplification. | Low | Known limitation |
| B7 | **Old primary toggled back online after election** — comes alive with "Old Primary" label but doesn't trigger rollback/sync. After election, if the NEW primary is killed for a second election, `getLinkBetween` returns `null` for the new topology. | Medium | Open (depends on B5) |

### Design Limitations

| # | Description |
|---|---|
| L1 | **Single write client, single read client** — HA scenarios 1 & 2 require two independent app perspectives (App A / App B) |
| L2 | **No retryable write simulation** — the driver's automatic retry-on-failure is a key part of the HA story but is not modeled |
| L3 | **Fixed 3-node topology** — scenarios 6–8 (9-node, multi-region, global latency) are architecturally out of scope |
| L4 | **`w:2` and `w:majority` are functionally identical** on a 3-node set but both are offered without explaining the distinction |
| L5 | **`rc:available` is indistinguishable from `rc:local`** in this replica-set-only context |
| L6 | **Canvas text uses hardcoded px sizes** — doesn't scale with viewport or user font preferences |

---

## 12. Codebase Health

### Resolved (from prior reviews)

- CSS extracted to `css/style.css`
- Inline `onclick` replaced with `addEventListener`
- Engine reset centralised in `resetEngine()`
- Auto-finish merged into shared `_autoFinish()`
- `PANEL_EL_IDS` lookup replaces string manipulation
- `getBoundingClientRect` cached per resize
- DOM reads (`sel-w`, `sel-rc`, `sel-readpref`) done once per draw frame
- `resolveReadTarget` moved to `state.js` to break circular dep
- `hoverTarget` encapsulated via `getHoverTarget()`/`setHoverTarget()` accessors
- `aria-label` on canvas, `for` on all `<label>` elements
- Welcome popup shown once via `localStorage`
- `rp`/`wp` link reset on concern/preference change
- `w:0 + j:true` demoted to `w:1` — guard at top of `createWriteMachine`
- Write flow refactored from static step array to **lazy state machine** with dynamic topology adaptation
- **Primary data integrity invariant** centralised in `primaryCanServe()` / `primaryHasData()` — covers crash, bounce, and data-loss scenarios
- **Interleaved journal ordering** for j:false — each secondary flushes journal before next secondary starts replication
- **Pedagogical safety notes** — non-default write concern states show info notes explaining MongoDB's safe default
- **Dark/light theming** via CSS custom properties driven by `js/theme.js`
- **Custom tooltip system** with delegated event handling and per-dropdown/per-button definitions
- **Non-default config badge** on `w` dropdown
- Test suite (85 tests) covering state helpers, write machine (including bounce/journal ordering), read steps, and elections

### Open

| Item | Notes |
|---|---|
| **Everything is still global scope** — `<script src>` loading, no ES modules | All functions are global; works but limits tooling and tree-shaking. |
| **`updateConsistencyViews` called from inside `draw()`** | Re-renders DOM 60×/sec during animation. Should be moved to step transitions only. |
