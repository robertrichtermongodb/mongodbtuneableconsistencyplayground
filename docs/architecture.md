# MongoDB Concerns Playground — Architecture & State Overview

*Last updated 2026-04-09 (Iteration 22: deferred rollback — partition election only caps winning-partition nodes; isolated old primary retains stale data until reconnection).*

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
  texts.js              — all user-facing strings (step titles, tooltips, explanations, canvas tips)
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
  topology-lock.test.js — topology locking tests
package.json            — npm test script (node --test, zero dependencies)
docs/
  architecture.md       — this file
  correctness.md        — correctness audit: correct / incorrect / imprecise / missing
  research.md           — compressed MongoDB concern reference (still valid)
  mongodb-read-write-concerns.md — structured rc/wc reference (still valid)
  ha-scenarios.md       — HA scenarios extracted from PPTX (still valid)
  DEPRECATED_*.md       — superseded docs kept for history
prompts/
  quality-standards.md    — AI coding quality standards for this project
  iteration-log-prompt.md — prompt template for creating iteration logs
  quality-check-prompt.md — post-change verification checklist
  contributor-guide.md    — quick-start context for new contributors or AI sessions
  small-model-usage.md    — guidance and prompt templates for cheaper AI models
  test-gap-backlog.md     — prioritized untested/under-tested areas
logs/iterations/          — iteration logs (01–20) + TEMPLATE.md
index.v1–v6.html        — legacy HTML snapshots (not used)
```

Script load order: `theme.js` (in `<head>`) → `state.js → logger.js → icons.js → texts.js → draw.js → engine.js → simulation.js → app.js` (at end of `<body>`). No build step; deployable to GitHub Pages as static files.

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
  writeClient: { x, y, phase, lastWrittenVersion, targetNode: nodeKey | null },
  readClient:  {
    x, y, phase,
    lastReceivedVersion: { id, dirty } | null,
    sessionActive: bool,
    sessionSnapshotId: number | null,
    targetNode: nodeKey | null,
  },
  particles:   [],
  links: {
    ps1:  bool,  // physical wire 'primary'-slot ↔ 's1'-slot
    ps2:  bool,  // physical wire 'primary'-slot ↔ 's2'-slot
    s1s2: bool,  // physical wire 's1'-slot ↔ 's2'-slot (triangle topology)
    wp:   bool,  // writer → write target (stale primary in split-brain)
    rp:   bool,  // reader → target
  },
  doc: {
    versions: [{ id, op, ackedBy: Set<nodeKey> }],
    latestId: number,
    majorityCommitId: number,
  },
}
```

**Node phases:** `idle | active | acked | error | candidate | recovering`
**Client phases:** `idle | waiting | received | error`

*Note:* `reading` and `serving` phase colors still exist in `draw.js` for legacy compatibility but are no longer assigned to server nodes — reads don't mutate node phase. Node colors exclusively reflect write-concern state.

### Storage layer model

Each node has two version fields modeling the WiredTiger storage engine:

- **`memoryVersion`** — data in the WiredTiger in-memory cache. Queryable via `rc:local`. Volatile: lost on crash.
- **`journalVersion`** — data flushed to the on-disk journal (WAL). Crash-safe: survives node restart.

Write flow per node: memory apply → journal flush. The `ackedBy` addition is gated by write concern:
- `j:false` (and not `w:majority`): ack counted on memory apply (fast path)
- `j:true` or `w:majority` (default `writeConcernMajorityJournalDefault:true`): ack counted on journal flush

Crash behavior:
- **Node kill:** `memoryVersion` wiped to 0, `journalVersion` preserved. Acks for versions > `journalVersion` retracted; `majorityCommitId` recomputed.
- **Node restart:** `memoryVersion = journalVersion` (recover from journal), then `syncRejoiningNode()` catches up to `majorityCommitId` if the node can reach the primary. Node enters `recovering` phase (600ms) before returning to `idle`.

### Key helpers

| Function | Location | Purpose |
|---|---|---|
| `resetDoc()` | state.js | Clears all doc/version state AND resets `primaryKey` + node labels to defaults |
| `resetLinks()` | state.js | Sets all 5 links to `true` |
| `getLinkBetween(a, b)` | state.js | Returns the link key (`'ps1'`, `'ps2'`, or `'s1s2'`) for two node slot keys |
| `effectiveWriteTarget()` | state.js | Returns `writeClient.targetNode \|\| primaryKey` — the node the write client writes to |
| `isReachableForWrite(key)` | state.js | Node alive AND link from `effectiveWriteTarget()` to it is connected |
| `isReachableFromPrimary(key)` | state.js | Node alive AND link from `primaryKey` to it is connected (used by linearizable reads) |
| `getPartition(nodeKey)` | state.js | BFS over alive nodes following up links; returns Set of reachable node keys |
| `isPrimaryPartitioned()` | state.js | True when current primary is alive but its partition is smaller than majority |
| `isNodeIsolated(nodeKey)` | state.js | True when a non-primary node is alive but cannot reach the current primary |
| `getServedVersion(nodeKey, rc)` | state.js | Returns `{ id, dirty }` based on `memoryVersion` (rc:local/available) or `majorityCommitId` (others) |
| `advanceMajorityCommit()` | state.js | Scans versions backward; cumulative: if vN has ≥2 acks, all prior are committed |
| `recomputeMajorityCommit()` | state.js | Full recomputation from scratch (used after crash retracts acks) |
| `journalFlush(nodeKey)` | state.js | Sets `journalVersion = memoryVersion` — models WiredTiger journal write |
| `crashNode(nodeKey)` | state.js | Wipes `memoryVersion` to 0, retracts acks above `journalVersion`, recomputes majority |
| `recoverNode(nodeKey)` | state.js | Sets `memoryVersion = journalVersion` — models journal recovery on restart |
| `syncRejoiningNode(nodeKey)` | state.js | Oplog catch-up / rollback on rejoin. Syncs secondary to the primary's current `memoryVersion` (catches UP if behind, caps DOWN if stale post-election). Adds acks and advances `majorityCommitId`. Returns `true` if synced. |
| `resolveReadTarget(rc, readPref)` | state.js | Returns `readClient.targetNode` if set, else picks via rc/readPref logic |

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

Returns a machine `{ history, isDone, nextStep() }` that evaluates the topology at each step to decide the next action. Topology is locked during execution (the UI blocks node/link/client-link clicks while any engine is active), so the machine assumes stable topology throughout — no mid-operation guards needed.

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
2. Guard: target not primary or target down → error step → done
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

All write machine references use `effectiveWriteTarget()` instead of `state.primaryKey` directly, enabling writes to a stale primary during split-brain scenarios.

**Topology locking:** `isTopologyLocked()` in `engine.js` combines `isAnyEngineActive()` with an open snapshot session (`readClient.sessionActive`). The UI (`handleCanvasClick` in `app.js`) blocks node, link, and client-link clicks while the topology is locked so mid-step state stays explainable. An open snapshot session keeps the lock between read request/response cycles; writes remain allowed (pinned snapshot ID). Read concern/preference dropdowns and canvas election triggers are disabled during a session. This eliminates the need for mid-operation liveness guards (`guardRun`, `guardRunAlive`, `primaryUnavailableStep` — all removed in Iteration 19). The cursor shows `not-allowed` when hovering over locked elements. `drawLockHint()` in `draw.js` shows either an in-flight operation banner or a session-specific banner, with a hover tooltip on the banner describing the rationale.

**Topology-aware messaging:** `createWriteMachine` computes a `topo` context object (reachable count, primaryPartitioned, allHealthy) once at creation. A `topoNote` string is derived from it and appended to key step texts (ACK, replComplete, fireForget) via `TEXTS.topoNote(topo)`. This ensures step explanations reflect the actual topology without adding branching to the state machine.

**Scenarios panel:** `TEXTS.scenarios` defines two groups: "Consistent by default" (4 resilience scenarios) and "Trading safety for speed" (3 risk scenarios). `initScenarios()` in `app.js` renders them as a collapsible card grid with group headers. `applyScenario()` resets state, sets config dropdowns and link topology, then logs the scenario name and next-step hint.

**Debug overlay:** A "Debug" button in the footer toggles `debugLabelsActive`. DOM elements get hot-pink ID badges positioned via `getBoundingClientRect()` in a `#dbg-overlay` container. Canvas regions (nodes, clients, links, MEM/DISK badges, doc ledger, RS box, lock banner) are labeled by `drawDebugLabels()` in `draw.js`. Zero visual footprint when off.

**CAP trade-off messaging:** Write concern error (`wcUnsatisfied`) explains the CP trade-off for w:majority and the PA trade-off for lower write concerns. w:1 ACK text explains the PA trade-off. Both include a note about primary step-down timing. Linearizable read blocked gets a specific error in both the step panel (dynamic getter on the return step) and the `read-status` box (`readClient.errorReason = 'linearizable'`).

**Pedagogical safety notes:**
- `isDefault` and `defaultNote` — when `w !== 'majority'`, error/ACK explain texts append a blue info note explaining that the MongoDB default (`w:majority` since v5.0) prevents the demonstrated issue.

### `buildReadSteps(rc, readPref, snapshotOverrideId?)`

Returns a pre-built step array (wrapped with `arrayMachine` in app.js).

1. Guard: reader disconnected → error
2. Resolve target via `resolveReadTarget()`
3. Client sends particle → target
4. Guard: target dead → error
5. RC-specific steps (local/available, majority, snapshot, linearizable)
6. Return data particle → client

### `buildElectionSteps(opts?)`

Returns a pre-built step array (wrapped with `arrayMachine` in app.js). Accepts optional `{ forcePartition: true }` for split-brain elections.

**Normal election (primary dead):**
1. Picks candidates: alive non-primary nodes sorted by `memoryVersion` descending
2. **Quorum check:** requires `totalAlive >= majority` (2 of 3). If not met, returns error step explaining Raft majority requirement
3. **Step 1 — Campaign:** winner enters `candidate` phase (purple dashed ring), explain text describes Raft mechanics
4. **Step 2 — Elected:** winner becomes primary, old primary relabeled as secondary, uncommitted writes rolled back

**Split-brain election (`forcePartition: true`):**
1. Finds the largest partition that excludes the current primary using `getPartition()`
2. **Quorum check:** partition must form a majority (≥2 nodes). Otherwise returns error step
3. Same campaign + elected steps, but additionally:
   - Old primary **steps down** and becomes a secondary (e.g. "Secondary 1")
   - Old primary is now isolated — detected dynamically by `isNodeIsolated()` (amber dashed ring)
   - Old primary **retains its stale data** (deferred rollback) — visible via amber MEM/DISK badge
   - Rollback occurs on reconnection when `syncRejoiningNode()` syncs to the new primary's level
   - Writes route to the new primary in the majority partition

---

## 6. Canvas Rendering (`js/draw.js`)

Draw cycle order:
1. Dark background fill
2. `drawRSBox()` — dashed boundary with RS icon + "Replica Set · 3-node P-S-S · majority = 2"
3. `drawReplicationLinks()` — uses `getLinkBetween()` for dynamic primary; amber × for partition, red × for dead
4. `drawWriteClientLine()` / `drawReadClientLine()` — to current primary / resolved target
5. `drawNode()` for each node — role determined dynamically: `primary`, `isolated` (via `isNodeIsolated()`), or `secondary`. Isolated nodes get amber dashed ring + "(isolated)" label suffix. Candidate phase → purple dashed ring; recovering → blue dashed ring
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

Layout: `computeLayout()` places nodes in a **triangle topology**: clients at `topY = 40`, primary at `priY = 185`, secondaries at `secY = 310`. Canvas height is `460px`. The S1↔S2 link at the bottom enables partition scenarios where the primary is isolated from both secondaries.

### Hit testing

`hitTest(mx, my)` → `{ type: 'node'|'link'|'client'|'clientLink', key }`. Client circles checked first (above everything visually). Node hits use `NR + 5` radius; link hits use `pointToSegDist` with `NR + 8` dead zones around endpoints; client link hits use `CR + 5`. Hover target drives native `canvas.title` tooltip via `canvasTipFor()` in `app.js`, with all tooltip strings centralized in `TEXTS.canvasTips`.

### Canvas election button

Two `<button>` elements absolutely positioned inside `.stage`, shown/hidden by `syncButtons()`:
- **Trigger Election** — positioned below dead primary node when primary is down and quorum exists. Includes Raft tooltip.
- **Force Election (partition)** — positioned at the midpoint of S1 and S2 when primary is alive but partitioned (`isPrimaryPartitioned()` returns true) and no split-brain is already active.

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

`syncWBadge()` updates the `#w-default-pill` element next to the `w` dropdown:
- `w:majority` → green "✓ DEFAULT" with tooltip explaining safety
- Any other value → amber "⚠ NON-DEFAULT" with tooltip explaining rollback risk

### Event binding

All via `addEventListener` (no inline `onclick`). Button IDs: `btn-reset`, `btn-write-start`, `btn-write-next`, `btn-write-finish`, `btn-read-start`, `btn-read-session-start`, `btn-read-session-again`, `btn-read-session-end`, `btn-read-next`, `btn-read-finish`, `btn-canvas-election`, `btn-dismiss-welcome`, `btn-dismiss-mobile`, `btn-theme-toggle`.

### Write/Read/Election handlers

- `handleWrite()` → `runMachine(createWriteMachine(w, j), writeEngine, 'write-step-panel')`
- `handleRead()` → `runMachine(arrayMachine(buildReadSteps(rc, readPref)), readEngine, 'read-step-panel')`
- `handleElection()` → `runMachine(arrayMachine(buildElectionSteps()), electionEngine, 'write-step-panel')`
- `handleForceElection()` → `runMachine(arrayMachine(buildElectionSteps({ forcePartition: true })), electionEngine, 'write-step-panel')`
- `checkPartitionHealed()` → called when a partitioned link is restored; calls `syncRejoiningNode()` to catch up or cap reconnected node versions to majority-committed level, logs healing

### Canvas interaction

- **Topology locking:** All node, link, and client-link clicks are blocked (`isTopologyLocked()` guard in `handleCanvasClick`) while any engine is in-flight or a snapshot session is open. Cursor shows `not-allowed` on hover. Client targeting (`cycleClientTarget`) is also locked. Client dragging (repositioning) remains allowed since it doesn't affect topology.
- **Node click (when unlocked):** toggle alive/dead. On kill: `crashNode()` wipes memory, preserves journal, retracts memory-only acks, recomputes majority. On restart: `recoverNode()` restores memory from journal, then `syncRejoiningNode()` catches up to committed level if the node can reach the primary; enters `recovering` phase for 600ms. Resets all engine visuals.
- **Link click (when unlocked):** toggle partition via link key from hitTest (ps1, ps2, or s1s2). If restoring a link, triggers `checkPartitionHealed()` which syncs reconnected nodes to committed level and logs healing. Resets all engine visuals.
- **Client link click (when unlocked):** toggle wp/rp connection
- **Client circle click (no drag):** cycles `targetNode` through `null → primary → s1 → s2 → null`. Target label shown below client circle. Writing to a non-primary target produces `NotWritablePrimary` error. Reading from a targeted node bypasses readPreference logic.
- **Client circle drag:** repositions the client on the canvas; connection lines follow. `clientDragged` flags track whether positions have been user-modified. A "Reset UI" button appears when clients have been dragged or targeted.

### Canvas tooltips

`canvasTipFor(hit)` maps the current hover target to a native `canvas.title` string. All tooltip texts are centralized in `TEXTS.canvasTips` (`js/texts.js`). Covers nodes, links (including S1↔S2 "heartbeat only" distinction), client circles (showing current/next target), and client connection lines.

### Popups

Welcome popup shown once per browser (uses `localStorage` key `tcp-welcome-dismissed`). Mobile hint popup shown on mobile devices.

### Election flow

`handleElection()` → resets all three engines → runs `buildElectionSteps()` through the `electionEngine` into `'write-step-panel'`. The write panel gains `.election-mode` class which hides the start button and changes the label/border to purple.

---

## 9. Page Layout

```
┌───────────────────────────────────────────────────────────┐
│ Welcome popup (first visit only via localStorage)          │
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
│ Canvas stage (position:relative, height:460px)             │
│  [writer overlay]    [animation area]   [reader overlay]   │
│  [Write Client]      [doc ledger]       [Read Client]      │
│       │                                      │             │
│       └────────────[Primary]─────────────────┘             │
│                   /          \                              │
│          [Secondary 1] ── [Secondary 2]  (triangle)        │
│                                                            │
│  [⚡ Trigger Election] ← below dead primary                │
│  [⚡ Force Election]   ← between S1/S2 when partitioned    │
├───────────────────────────────────────────────────────────┤
│ 💡 Suggested scenarios (collapsible)                        │
├───────────────────────────────────────────────────────────┤
│ Event log (monospace, max-height:120px, scrollable)         │
├───────────────────────────────────────────────────────────┤
│ Footer (docs links, GitHub, disclaimer)                     │
└───────────────────────────────────────────────────────────┘
```

---

## 10. Testing (`test/`)

~130 tests across 5 files, zero external dependencies. Uses Node's built-in `node:test` runner.

### Test harness (`test/helpers.js`)

Uses `node:vm` to load `theme.js`, `state.js`, `texts.js`, `simulation.js`, and `engine.js` into an isolated V8 context with browser globals stubbed:
- `log`, `draw`, `startAnimLoop` → no-ops
- `awaitParticle` → immediately calls `onArrive` callback and resolves
- `skipAnimations = true` → `delay()` resolves instantly
- Minimal DOM stubs for `syncButtons` compatibility

### Test coverage

| File | Tests | Covers |
|---|---|---|
| `state.test.js` | ~56 | `journalFlush`, `crashNode`, `recoverNode`, `advanceMajorityCommit`, `recomputeMajorityCommit`, `resolveReadTarget` (incl. manual targeting), `getServedVersion`, `isReachableForWrite`, `getLinkBetween` (s1↔s2), `getPartition`, `isPrimaryPartitioned`, `effectiveWriteTarget` (incl. targetNode override), `isNodeIsolated`, `syncRejoiningNode` (catch-up, rollback, isolation guard, idempotency, post-election) |
| `machine.test.js` | ~35 | Write machine: w:1/2/3/majority/0, j:true/false, pre-existing topology (secondaries down, link partitioned), partitioned primary w:1/majority, post-force-election writes, client targeting (write-to-secondary error, target-down error) |
| `reads.test.js` | ~17 | Read steps: rc:local, rc:majority, rc:linearizable, rc:snapshot, reader disconnect, fallback |
| `election.test.js` | ~18 | Election: happy path, quorum failure, rollback, deferred rollback on partition (stale retention, reconnection sync, partition-scoped capping), snapshot invalidation, split-brain election (partition-aware, winner selection, old primary becomes secondary, isolated detection) |
| `topology-lock.test.js` | ~3 | Topology locking during engine activity |

---

## 11. Known Bugs & Limitations

> For a full correctness audit (correct / incorrect / imprecise / missing), see `docs/correctness.md`.

### Bugs

| # | Description | Severity | Status |
|---|---|---|---|
| ~~B1~~ | ~~**`w:0 + j:true` not demoted to `w:1`** — simulator showed fire-and-forget; MongoDB demotes to w:1.~~ | High | ✅ Fixed |
| ~~B2~~ | ~~**`w:majority + j:false` explain text wrong** — implied fragility on default config where `writeConcernMajorityJournalDefault:true` overrides j.~~ | Medium | ✅ Fixed |
| ~~B3~~ | ~~**Election succeeded with 1 alive node** — Raft requires majority (2 of 3). Simulator allowed election with 1 secondary.~~ | High | ✅ Fixed |
| ~~B4~~ | ~~**Static step array didn't adapt to topology changes**~~ — topology is now locked during in-flight operations; mid-operation changes are blocked by the UI. | High | ✅ Superseded (topology locking) |
| ~~B5~~ | ~~**`getLinkBetween` only knows primary↔s1 and primary↔s2 slot pairs**~~ — now returns `'s1s2'` for the s1↔s2 pair. Triangle topology with 3 inter-node links. | Medium | ✅ Fixed |
| B6 | **`resolveReadTarget` ignores reader network reachability** — checks `node.alive` but not per-node reader connectivity. Single `rp` boolean is a model simplification. | Low | Known limitation |
| ~~B7~~ | ~~**Old primary toggled back online after election**~~ — `syncRejoiningNode()` catches up (or caps) reconnected node data on both node revival and link restoration. | Medium | ✅ Fixed |

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
- **Primary data integrity** — crash, bounce, and data-loss scenarios handled by topology locking and `failWrite()` error paths
- **Interleaved journal ordering** for j:false — each secondary flushes journal before next secondary starts replication
- **Pedagogical safety notes** — non-default write concern states show info notes explaining MongoDB's safe default
- **Dark/light theming** via CSS custom properties driven by `js/theme.js`
- **Custom tooltip system** with delegated event handling and per-dropdown/per-button definitions
- **Non-default config badge** on `w` dropdown
- Test suite (~130 tests) covering state helpers, write machine, read steps, elections, deferred rollback, split-brain scenarios, client targeting, topology locking, and rejoining node sync
- **Topology locking** — UI blocks all node/link/client-link clicks while any engine is active. Eliminates mid-operation topology change complexity (removed `guardRun`, `guardRunAlive`, `primaryUnavailableStep`, `_guardAbort`, `endAsyncWork` — ~80 lines of guard code). Cursor shows `not-allowed` on locked elements.

### Open

| Item | Notes |
|---|---|
| **Everything is still global scope** — `<script src>` loading, no ES modules | All functions are global; works but limits tooling and tree-shaking. |
| **`updateConsistencyViews` called from inside `draw()`** | Re-renders DOM 60×/sec during animation. Should be moved to step transitions only. |
