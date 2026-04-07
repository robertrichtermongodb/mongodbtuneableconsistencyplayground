# MongoDB Concerns Playground — Architecture & State Overview

*Generated 2026-03-15 from a complete review of the live codebase.*

---

## 1. Purpose

An interactive single-page simulator for exploring how MongoDB **write concerns**, **read concerns**, **read preferences**, and **elections** shape data flow, consistency, and durability in a 3-node replica set (Primary + 2 Secondaries).

**Framing (welcome popup):** MongoDB is fully consistent by default — not eventually consistent. This tool lets users experience the knobs MongoDB exposes to tune consistency properties.

---

## 2. File Structure

```
index.html              — layout, popups, script tags, footer (no inline CSS or JS)
css/style.css           — all CSS (extracted from old inline <style>)
js/
  state.js              — shared state, doc helpers, resolveReadTarget, getLinkBetween
  logger.js             — log() function (separated to break circular dep)
  icons.js              — SVG Path2D constants (ICON_LEAF, ICON_RS)
  draw.js               — canvas rendering, hit testing, consistency overlays, layout
  engine.js             — step engines, syncButtons, showStepPanel, auto-finish
  simulation.js         — buildWriteSteps(), buildReadSteps(), buildElectionSteps()
  app.js                — event handlers, popup logic, init
docs/
  architecture.md       — this file
  correctness.md        — correctness audit: correct / incorrect / imprecise / missing
  research.md           — compressed MongoDB concern reference (still valid)
  mongodb-read-write-concerns.md — structured rc/wc reference (still valid)
  ha-scenarios.md       — HA scenarios extracted from PPTX (still valid)
  DEPRECATED_*.md       — superseded docs kept for history
index.v1–v6.html        — legacy HTML snapshots (not used)
```

Script load order: `state.js → logger.js → icons.js → draw.js → engine.js → simulation.js → app.js`. No build step; deployable to GitHub Pages as static files.

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
  done: false, aborted: false, _autoFinishId: null }
```

- **writeEngine** — drives write step sequences
- **readEngine** — drives read step sequences
- **electionEngine** — drives election steps; **borrows the write panel** (the write step panel switches to "ELECTION" mode via CSS class `.election-mode`)

### `runEngine(steps, eng, panelId)`

Iterates through step array. Step 0 runs immediately; subsequent steps wait for user click via `waitForClick()`. If engine is aborted mid-run, remaining `serverSide: true` steps execute in the background. On completion, `eng.done = true` and `syncButtons()` is called.

### `resetEngine(eng)`

Centralised field reset: aborts, resolves any pending waitForClick promise, clears all fields, cancels any auto-finish interval. Used by `resetWriteVisual()`, `resetReadVisual()`, `resetElectionVisual()`.

### `syncButtons()`

Called after every state transition. Manages:
- Write start button: disabled during `writeActive || electionActive`; tooltip explains why
- Write panel Next/Finish: routes to election engine if `electionActive`, else write engine (via `handleWritePanelNext()` / `handleWritePanelFinish()`)
- Read start button: disabled during `readActive`; tooltip
- Snapshot session buttons: disabled with per-button tooltip reasons
- `sel-w`, `sel-j`: locked during `writeActive` with tooltip
- `sel-rc`, `sel-readpref`: locked during `readActive` with tooltip
- Canvas election button: shown/hidden + positioned below dead primary node; requires `aliveCount >= majorityNeeded` (quorum check)
- Write panel `.election-mode` CSS class toggle

### `showStepPanel(i, eng, panelId)`

Uses `PANEL_EL_IDS` lookup map (not string manipulation). Step explain text rendered inside `<details open>` (collapsible by user, expanded by default).

---

## 5. Simulation Step Builders (`js/simulation.js`)

### `buildWriteSteps(w, j)`

0. Guard: `w:0 + j:true` → demote to `w:1` (per MongoDB docs, server requires primary ACK after journal flush)
1. Guard: writer disconnected → error
2. Guard: primary dead → error (explains "Use Trigger Election button")
3. Client sends particle → primary
4. **Primary memory apply** (serverSide) — `memoryVersion = nextId`. If `j:false` and not w:majority: ack counted here.
5. **Primary journal flush** (serverSide) — `journalVersion = nextId`. If `j:true` or w:majority: ack counted here. Shows whether ack is gated on journal or async.
6. `w:0` → fire-and-forget with parallel async replication (each secondary: memory apply → delayed journal flush)
7. If unachievable → replication + write concern error
8. Required secondaries: **memory apply** step + **journal flush** step each → ACK → async secondaries same pattern
9. ACK text for `w:majority` always says "Fully durable" (notes that default `writeConcernMajorityJournalDefault:true` overrides client j:false)
10. Final step resets all alive nodes to idle

### `buildReadSteps(rc, readPref, snapshotOverrideId?)`

1. Guard: reader disconnected → error
2. Resolve target via `resolveReadTarget()`
3. Client sends particle → target
4. Guard: target dead → error
5. RC-specific steps (local/available, majority, snapshot, linearizable)
6. Return data particle → client

### `buildElectionSteps()`

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
7. `drawDocLedger()` — floating box showing doc #1 state (in-flight vs committed vs durable)
8. `drawParticles()` — eased animation at `PARTICLE_MS=1400ms`
9. `updateConsistencyViews()` — writer/reader HTML overlays
10. `updateReadActionControls()` — snapshot button visibility

### Node doc badge (two-row storage layers)

`drawNodeDocBadge(node)` renders a **two-row stacked badge** below each node:

```
┌──────────────┐
│ MEM    v3    │  ← memoryVersion (amber if above majorityCommit, green if committed)
├──────────────┤
│ DISK   v3    │  ← journalVersion (green when flushed, dim dash if not yet)
└──────────────┘
```

When memory is ahead of disk (data in cache but not journaled), a down-arrow indicator appears between rows. When both are 0 (no data), a single dim dash is shown.

`canvasW`/`canvasH` cached in `resizeCanvas()` (not re-read via `getBoundingClientRect()` per frame). `sel-w`/`sel-rc`/`sel-readpref` read once per draw cycle and passed as arguments.

### Hit testing

`hitTest(mx, my)` → `{ type: 'node'|'link'|'clientLink', key }`. Uses `pointToSegDist` for line click detection with `NR+8`/`CR+5` dead zones around nodes/clients.

### Canvas election button

A `<button>` absolutely positioned inside `.stage`, shown/hidden by `syncButtons()`. Positioned at `(14 + pNode.x, 14 + pNode.y + NR + 18)` via inline style when the current primary is dead and candidates exist. Includes RAFT tooltip on hover.

---

## 7. App Logic (`js/app.js`)

### Event binding

All via `addEventListener` (no inline `onclick`). Button IDs: `btn-reset`, `btn-write-start`, `btn-write-next`, `btn-write-finish`, `btn-read-start`, `btn-read-session-start`, `btn-read-session-again`, `btn-read-session-end`, `btn-read-next`, `btn-read-finish`, `btn-canvas-election`, `btn-dismiss-welcome`, `btn-dismiss-wip`.

### Canvas interaction

- **Node click:** toggle alive/dead. On kill: `crashNode()` wipes memory, preserves journal, retracts memory-only acks, recomputes majority. On restart: `recoverNode()` restores memory from journal, enters `recovering` phase for 600ms. Resets write, read, and election visuals (but NOT document state).
- **Link click:** toggle partition via `getLinkBetween()`; same resets
- **Client link click:** toggle wp/rp; if mid-engine, aborts that engine and marks client as error; server-side steps continue in background

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
│ Canvas stage (position:relative)                           │
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
│ Footer (author, docs links, GitHub, disclaimer)             │
└───────────────────────────────────────────────────────────┘
```

---

## 9. Known Bugs & Limitations

> For a full correctness audit (correct / incorrect / imprecise / missing), see `docs/correctness.md`.

### Bugs

| # | Description | Severity | Status |
|---|---|---|---|
| ~~B1~~ | ~~**`w:0 + j:true` not demoted to `w:1`** — simulator showed fire-and-forget; MongoDB demotes to w:1.~~ | High | ✅ Fixed |
| ~~B2~~ | ~~**`w:majority + j:false` explain text wrong** — implied fragility on default config where `writeConcernMajorityJournalDefault:true` overrides j.~~ | Medium | ✅ Fixed |
| ~~B3~~ | ~~**Election succeeded with 1 alive node** — RAFT requires majority (2 of 3). Simulator allowed election with 1 secondary.~~ | High | ✅ Fixed |
| B4 | **`getLinkBetween` only knows primary↔s1 and primary↔s2 slot pairs** — after election where s1 becomes primary, the s1↔s2 link returns `null`. Partition toggling between the new primary and remaining secondary doesn't work. | Medium | Open |
| B5 | **`resolveReadTarget` ignores reader network reachability** — checks `node.alive` but not per-node reader connectivity. Single `rp` boolean is a model simplification. | Low | Known limitation |
| B6 | **Old primary toggled back online after election** — comes alive with "Old Primary" label but doesn't trigger rollback/sync. After election, if the NEW primary is killed for a second election, `getLinkBetween` returns `null` for the new topology. | Medium | Open (depends on B4) |

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

## 10. Anticipated Improvements

### Design

| Area | Current State | Improvement |
|---|---|---|
| **Typography scale** | 10+ CSS rem sizes + separate px sizes on canvas; visually inconsistent | Define 4–5 named type steps via CSS variables; use a `BASE_FONT` constant for canvas |
| **Config panel headers** | 0.75rem, same visual weight as field labels | Increase to 0.85rem+, heavier weight to read as section titles |
| **Node health indicator** | 7px dot at top-right of node circle, easy to miss | Increase to 10px or consolidate with the main border color |
| **Node phase readability** | Phase communicated only by border/fill color (very similar shades) | Add small phase label inside node ("ACK", "ERR", "READ") during non-idle phases |
| **Consistency overlays** | Fixed 148px width, updated 60×/sec from inside `draw()` | Move updates out of render loop to step transitions only; use `min-width` |
| **Step badge vs dots** | Both show the same "step N of M" information redundantly | Remove the text badge; enlarge dots slightly |
| **Primary/secondary role badges** | Distinguished only by border color and text label | Add a crown/"P" icon in the primary node, "S" in secondaries |
| **Dirty read visual** | Only flagged in overlay with ⚠ text | Also highlight the version badge on the read client circle in amber |
| **Consistency overlay symbols** | ◎ used for both fire-and-forget and in-flight (different meanings) | Use distinct symbols: ✓/◉ committed, ⏳ in-flight, ○ unconfirmed, ✕ error |

### UX

| Area | Current State | Improvement |
|---|---|---|
| **Pure-animation steps** | Require "Next →" click even when nothing to decide | Auto-advance after particle arrives for steps with no pedagogical pause |
| **Finish button prominence** | "Finish ▶▶" is secondary style; "Next →" is primary | Swap: make "Finish" primary green after step 2; or hide "Finish" until step 2 |
| **Snapshot buttons** | All three shown at once when rc=snapshot; two disabled pre-session | Show only "Start session & read" initially; reveal others after session starts |
| **Snapshot session invalidation** | Silently logged in event log; no visual reaction in panel or buttons | Flash session indicator red + show "Session invalidated" label + disable "Read again" with tooltip |
| **`w:2` vs `w:majority` explanation** | Both offered without distinguishing context | Add a tooltip or note that on a 3-node set these are equivalent |
| **`rc:available` explanation** | Appears identical to `rc:local` | Add an inline note: "On replica sets, identical to local. On sharded clusters, may return orphaned documents." |
| **Step explain text** | Currently `<details open>` — expanded by default | Consider defaulting to collapsed after the user has seen 2+ steps; or adding a global "verbose / concise" toggle |

### Supported Simulation Scenarios

| Scenario | Current Coverage | What's Needed |
|---|---|---|
| **1 — Dirty read + rollback (weak concerns)** | Full via write w:1 → read rc:local → kill primary → trigger election → rollback | Done |
| **2 — Safe read + retry (strong concerns)** | Partial — core T2–T4 insight works; no auto-retry after election | Add retryable write simulation (auto re-issue after election) |
| **3 — Minority node failure** | Full — kill a secondary, writes continue; kill primary, election available | Done |
| **4 — Majority failure → read-only** | Partial — write blocks, majority reads frozen | Add explicit "Cluster read-only" banner on canvas + reconfiguration button |
| **5 — Total node loss** | Minimal — all-dead state reachable, reads/writes fail | Add a "Restore from backup" conceptual step |
| **6–8 — Multi-region / chaos / latency** | Not covered | Out of scope for 3-node simulator; would need a new tool |
| **Post-election fault injection** | Broken — `getLinkBetween` returns null for s1↔s2 | Fix link topology to support dynamic primary slot |
| **Second election after first** | Partially broken due to B1/B2 | Fix requires rethinking link keys as dynamic rather than slot-based |
| **`readPreference: nearest`** | Not implemented | Add option with simulated per-node latency constants |
| **Causal consistency sessions** | Not implemented | Could extend snapshot session model with `afterClusterTime` semantics |
| **Second application client** | Not implemented | High canvas complexity; lower priority |

---

## 11. Codebase Health

### Resolved (from prior reviews)

- CSS extracted to `css/style.css`
- Inline `onclick` replaced with `addEventListener`
- `js/v6/` deleted
- Engine reset centralised in `resetEngine()`
- Auto-finish merged into shared `_autoFinish()`
- `PANEL_EL_IDS` lookup replaces string manipulation
- `getBoundingClientRect` cached per resize
- DOM reads (`sel-w`, `sel-rc`, `sel-readpref`) done once per draw frame
- `resolveReadTarget` moved to `state.js` to break circular dep
- `hoverTarget` encapsulated via `getHoverTarget()`/`setHoverTarget()` accessors
- `aria-label` on canvas, `for` on all labels
- Welcome popup shown once via `localStorage`
- `rp`/`wp` link reset on concern/preference change

### Open

| Item | Notes |
|---|---|
| **Everything is still global scope** — `<script src>` loading, no ES modules | The prior review mentions ES module conversion as done, but the live codebase uses plain `<script src>` tags with no `export`/`import`. Either the module conversion was lost or was only done on a branch. |
| **No `<label for>` on all selects** | The live `index.html` does have `for` attributes — confirmed present. |
| **`updateConsistencyViews` called from inside `draw()`** | Re-renders DOM 60×/sec during animation. Should be moved to step transitions only. |
| ~~**`w:0 + j:true` edge case**~~ | ~~MongoDB demotes this to `w:1` behavior.~~ ✅ Fixed — guard added in `buildWriteSteps`. |
