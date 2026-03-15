# MongoDB Concerns Playground — Architecture & Concept

## Purpose

An interactive single-page application for exploring how MongoDB **write concerns** and **read concerns** shape data flow, consistency, and durability in a 3-node replica set (Primary + 2 Secondaries). The goal is to make abstract MongoDB guarantees tangible by letting users step through the exact sequence of events that happens at each concern level, while also being able to inject faults (node failures, network partitions, client disconnects) at any point.

---

## Conceptual Model

### The Document

All scenarios revolve around a single abstract document: **doc #1**. Its lifecycle is:

- `v0` — does not exist yet
- `v1` — first write (insert)
- `v2, v3, …` — subsequent writes (updates)

Every node in the replica set tracks which version it currently holds (`docVersionId`). A version is **majority-committed** once at least 2 of the 3 nodes have acknowledged it (`ackedBy.size >= 2`). The app distinguishes:

| State | Meaning |
|---|---|
| `latestId === 0` | Nothing written yet |
| `latestId > majorityCommitId` | Latest write is in-flight / not yet majority-committed |
| `latestId === majorityCommitId` | Fully durable — every write is majority-confirmed |

This distinction is what makes read concerns observable: a `rc:local` read may return an in-flight version that `rc:majority` would not.

### Write Concerns Simulated

| w value | Behaviour |
|---|---|
| `w:0` | Fire-and-forget — no ACK to client, async replication proceeds |
| `w:1` | Primary applies → ACK returned → async replication to secondaries |
| `w:2` | Primary applies → replicates to S1 → ACK → async replication to S2 |
| `w:3` | Primary applies → replicates to S1 → replicates to S2 → ACK |
| `w:majority` | Primary applies → replicates to first secondary → ACK → async to second |
| `j:true` | Each required node flushes to disk journal before counting its ack |

Replication to secondaries beyond the write concern threshold always happens but is modelled as a background (server-side) operation that continues even if the client connection is cut.

### Read Concerns Simulated

| rc value | What it returns |
|---|---|
| `rc:local` | Node's current in-memory state — may include uncommitted data (dirty read) |
| `rc:available` | Same as local on replica sets (relevant difference is on sharded clusters) |
| `rc:majority` | Highest version confirmed by ≥2 nodes — guaranteed rollback-safe |
| `rc:snapshot` | Consistent point-in-time snapshot of the majority-commit point |
| `rc:linearizable` | Primary verifies it is still the legitimate primary (via w:majority check with secondaries) before serving the read |

### Read Preferences

`primary`, `primaryPreferred`, `secondary`, `secondaryPreferred` — control which node the read client targets. `rc:linearizable` always forces the primary regardless of preference.

### Fault Injection

Users can click directly on the canvas to mutate topology:

| Target | Effect |
|---|---|
| Node circle | Toggle node alive/dead |
| Dashed line between nodes | Toggle replication link (partition between primary and that secondary) |
| Write client → Primary arrow | Interrupt the writer's connection (simulates client timeout) |
| Read client → Target arrow | Interrupt the reader's connection |

Node/link changes reset the current simulation and document state. Client-link interruptions abort only the respective engine but allow in-progress server-side replication to finish in the background.

---

## Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ header + topo hint bar (Reset button)                           │
├──────────────┬──────────────────────────────┬───────────────────┤
│ Write config │      Step panels             │  Read config      │
│ (w, j        │  ┌────────────┬────────────┐ │  (rc, readPref)   │
│  selects)    │  │ WRITE panel│ READ panel │ │                   │
│              │  │ start btn  │ start btn  │ │                   │
│              │  │ step info  │ step info  │ │                   │
│              │  │ Next/Finish│ Next/Finish│ │                   │
│              │  └────────────┴────────────┘ │                   │
├──────────────┴──────────────────────────────┴───────────────────┤
│  Canvas (full width, position:relative)                         │
│  ┌──────────────┐                         ┌──────────────────┐  │
│  │ writer status│     animation area      │ reader status    │  │
│  │ overlay      │                         │ overlay          │  │
│  └──────────────┘                         └──────────────────┘  │
│    [Write Client]        [ledger]          [Read Client]         │
│          │                                       │              │
│          └────────────[Primary]───────────────── ┘              │
│                       /       \                                  │
│               [Secondary 1] [Secondary 2]                       │
├─────────────────────────────────────────────────────────────────┤
│ Event log                                                        │
└─────────────────────────────────────────────────────────────────┘
```

The canvas layout is computed dynamically on resize. Key constants: `NR=52` (node radius), `CR=34` (client radius), `topY=82` (client icon y-position), `nodeY=H-120` (node row y-position), `spread=min(250, W*0.28)`.

---

## File Structure

All files are loaded in order via `<script src>` tags — no build step, works as static files on GitHub Pages.

```
index.html        — layout, CSS, script tags
js/
  state.js        — shared state object + document helpers
  icons.js        — SVG Path2D for MongoDB leaf/RS icons
  engine.js       — step engines, syncButtons, auto-finish
  draw.js         — canvas rendering (layout, nodes, links, particles, ledger)
  simulation.js   — buildWriteSteps(), buildReadSteps()
  app.js          — event handlers, consistency views, init
docs/
  architecture.md — this file
  research.md     — compressed MongoDB concern reference
```

---

## State Model (`js/state.js`)

```javascript
state = {
  nodes: {
    primary: { label, x, y, alive, phase, docVersionId },
    s1:      { ... },
    s2:      { ... },
  },
  writeClient: { x, y, phase, lastWrittenVersion },
  readClient:  { x, y, phase, lastReceivedVersion },  // lastReceivedVersion: { id, dirty } | null
  particles:   [],  // active flying document icons
  links: {
    ps1: bool,  // Primary ↔ Secondary 1 replication link
    ps2: bool,  // Primary ↔ Secondary 2 replication link
    wp:  bool,  // Writer → Primary client connection
    rp:  bool,  // Reader → Target client connection
  },
  doc: {
    versions:        [{ id, op:'insert'|'update', ackedBy: Set<nodeKey> }],
    latestId:        number,   // 0 = nothing written
    majorityCommitId: number,  // highest id with ackedBy.size >= 2
  },
}
```

**Node phases** drive canvas visual state: `idle | active | acked | error | reading | serving | waiting | received`.

**Key helpers:**
- `isReachableForWrite(key)` — node alive AND its replication link is connected
- `getServedVersion(nodeKey, rc)` — returns `{ id, dirty }` based on concern level
- `advanceMajorityCommit()` — scans `doc.versions` and advances `majorityCommitId`

---

## Simulation Engine (`js/engine.js`)

Two independent engine instances: `writeEngine` and `readEngine`. Each is:

```javascript
{ mode: 'step', steps: [], idx: -1, _waitResolve: null, busy: false, done: false, aborted: false }
```

### `runEngine(steps, eng, panelId)`

Iterates through a step array:

1. Sets `eng.idx = i`, renders the step panel
2. **Step 0 runs immediately** (no click required) — subsequent steps wait for user via `waitForClick()`
3. Runs `step.run()` (an async function that performs animations/state mutations)
4. If `eng.aborted` mid-loop: collects remaining steps with `serverSide: true` and runs them asynchronously in the background (models server-side replication continuing after client disconnect)

### Step object shape

```javascript
{
  title:      string,       // shown in step panel header
  explain:    string,       // HTML shown in step panel body
  run:        async fn,     // performs the actual animation + state mutation
  serverSide: bool,         // if true, runs in background after client abort
}
```

### `syncButtons()`

Called after every state transition. Manages disabled/enabled state of all interactive buttons and locks the write concern dropdowns (`sel-w`, `sel-j`) while a write is in progress.

### Auto-finish

`autoFinishWrite()` / `autoFinishRead()` — use `setInterval` at 120ms to repeatedly call `advanceWriteStep()` / `advanceReadStep()`, automatically consuming the `_waitResolve` gate at each step until the engine is done.

---

## Step Builders (`js/simulation.js`)

### `buildWriteSteps(w, j)`

Generates an ordered step array for a write operation. Logic:

1. Guard: writer disconnected → immediate error step
2. Compute reachability: `reachableSecs`, `secsNeeded` (how many secondaries must replicate before ACK)
3. Guard: primary down → error step
4. Step: client sends particle to primary (always)
5. Step: primary applies (always, `serverSide: true`)
6. Early return for `w:0` with async parallel replication
7. Guard: write concern unachievable → block/error steps
8. `required` secondaries: sequential `makeReplStep()` calls (each animates a particle, marks node acked, advances majority commit)
9. ACK returned step (particle primary → write client)
10. `asyncSecs` (remaining): more `makeReplStep()` calls marked `serverSide: true` — these run after ACK and continue in background if client disconnects

### `buildReadSteps(rc, readPref)`

1. Guard: reader disconnected → error step
2. Resolve target node via `resolveReadTarget(rc, readPref)`
3. Step: read client sends particle to target
4. Guard: target not alive → error step
5. rc-specific steps:
   - `local/available`: read node's current in-memory state, flag if dirty
   - `majority`: read majority-commit snapshot (or frozen snapshot if isolated)
   - `snapshot`: same as majority but framed as point-in-time snapshot for transactions
   - `linearizable`: additional round-trip to secondaries to confirm primary leadership, then serve majority-commit snapshot
6. Return data step: particle target → read client, sets `lastReceivedVersion`

---

## Canvas Rendering (`js/draw.js`)

Every draw cycle calls these in order:

1. `ctx.fillRect` — dark background (`#0E1C2A`)
2. `drawRSBox()` — dashed border around the three nodes with RS icon + label
3. `drawReplicationLinks()` — dashed lines between primary and secondaries; scissors icon on hover; amber × for partition, red × for dead node
4. `drawWriteClientLine()` / `drawReadClientLine()` — dashed lines from clients to their targets; scissors on hover; red × when cut
5. `drawNode()` × 3 — circles with leaf icon + label + health dot (top-right); faded to 22% opacity when dead
6. `drawNodeDocBadge()` — rounded badge below each node showing current doc version with doc icon, colour-coded: green = majority-committed, amber = in-flight, dim = no data
7. `drawWriteClient()` / `drawReadClient()` — client circles with concern labels beneath
8. `drawDocLedger()` — floating box in the vertical centre between clients and nodes:
   - No writes: dim icon+text "Doc #1 · no writes yet"
   - In-flight only: amber `[doc icon] vN  [☐] in-flight`
   - Both committed + in-flight: two rows (green committed + amber in-flight)
   - Fully durable: green `[doc icon] vN  [☑] durable`
9. `drawParticles()` — flying document icons along straight paths (eased animation at `PARTICLE_MS=1400ms`)
10. `updateConsistencyViews()` — populates the two HTML overlay boxes inside the canvas card (writer status top-left, reader status top-right)

### Key drawing helpers

- `drawDocIconAt(x, y, size, color)` — parameterised document shape (folded-corner rectangle)
- `drawIconText(text, cx, y, font, color, iconSize)` — centres `[doc icon] text` as a unit
- `drawCheckbox(cx, cy, size, done, color)` — rounded square; checkmark if `done`, dash if pending
- `drawVersionRow(cx, y, versionText, isDone, statusLabel, color, font)` — full row: `[doc icon] vX  [checkbox] label`
- `awaitParticle(from, to, color, label, onArrive)` — returns a Promise that resolves when the particle reaches its target
- `hitTest(mx, my)` — returns `{ type:'node'|'link'|'clientLink', key }` or `null` for click/hover detection

---

## Consistency Overlay Views (`js/app.js` — `updateConsistencyViews`)

Two HTML panels float over the top-left and top-right corners of the canvas card. They are updated on every `draw()` call and reflect current state:

**Writer overlay** — shows:
- "No writes issued" (idle)
- "In-flight — N/2 majority" with ack count (pending)
- "Majority-committed" (durable)
- "Write concern failed" (error / timeout)
- "Fire-and-forget" (w:0)

**Reader overlay** — shows:
- "No reads completed" (idle)
- "Reading… rc:X" (in progress)
- "Dirty read — uncommitted" with version (local/available returning above majority-commit)
- "Safe — majority-confirmed" with version
- "No data returned" (majority-commit is v0 or node has nothing)
- "Read failed" (no eligible node / connection cut)

---

## Interaction Flows

### Write flow

1. User selects `w` and `j` in the left config panel
2. Clicks **"New doc with ID 1"** (or **"Update doc with ID 1"** for subsequent writes)
3. `handleWrite()` calls `buildWriteSteps(w, j)` then `runEngine(...)`
4. Step 0 runs immediately (particle flies to primary)
5. Each subsequent step waits for **"Next →"** or **"Finish ▶▶"** (auto-advance)
6. Write concern dropdowns are locked (`disabled`) during the run
7. Button text cycles: "New doc with ID 1" → "Update doc with ID 1" (based on `state.doc.latestId`)

### Read flow

1. User selects `rc` and `readPref` in the right config panel
2. Clicks **"Query doc with ID 1"** (can be done mid-write at any step)
3. `handleRead()` calls `buildReadSteps(rc, readPref)` then `runEngine(...)`
4. The read engine is fully independent — both engines run concurrently
5. Read result (`lastReceivedVersion`) persists in state and is shown in the reader overlay

### Fault injection at any point

- Click a **node** → toggles alive/dead; resets both simulations and document
- Click a **replication link** (dashed line between nodes) → toggles partition; resets both simulations and document
- Click a **client arrow** (write or read) → toggles connection; if mid-simulation, aborts that engine, but server-side steps (replication) continue in background; does NOT reset document state

---

## Design Principles

1. **Decoupled engines** — write and read run independently so you can pause a write mid-way and issue a read to observe exactly what `rc:majority` vs `rc:local` would return at that moment.

2. **Persistent document state** — the document's version history and majority-commit point survive engine resets. Only an explicit "Reset ↺" or a topology change (node toggle / link toggle) resets the document. This lets you accumulate writes and observe their consistency implications across multiple reads.

3. **Server-side steps survive client disconnect** — `serverSide: true` on replication steps ensures that cutting the client link shows the realistic behaviour: client gets an error, but the cluster continues replicating in the background.

4. **Sequential replication** — each secondary replicates and acknowledges in one step (oplog pull + ack combined). Required secondaries replicate before the client ACK; async secondaries replicate after.

5. **No build step** — six ordered `<script src>` tags, static files, deployable directly to GitHub Pages.
