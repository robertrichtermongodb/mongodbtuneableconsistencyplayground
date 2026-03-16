# Codebase Review — MongoDB Concerns Playground

---

## 1. UX / Product

### Critical
- **~~Step explain text is hidden by default.~~** ✅ Done — `<details open>` is now the default in `showStepPanel`. (`engine.js`)
- **~~Welcome popup on every load.~~** ✅ Done — `localStorage` flag `tcp-welcome-seen` suppresses it on return visits. WIP popup still follows every welcome dismissal (intentional while app is WIP). (`app.js — initPopups`)

### Notable
- **~~Read target changes but `rp` link state does not reset.~~** ✅ Done — `state.links.rp = true` is now set on every `sel-rc`/`sel-readpref` change event. (`app.js`)
- **~~Topo-hint says "click client arrows"~~** ✅ Done — copy updated to "click client connection lines". (`index.html`)
- **No `wtimeout` control.** The step explanations reference `wtimeout` but there is no way to simulate a timeout value. A future improvement but currently a gap between explanation and interactivity.
- **`w:2` vs `w:majority` are functionally identical on a 3-node set** but the simulator offers both without explaining the distinction or showing any difference in behavior.
- **`rc:available` is indistinguishable from `rc:local`** in this replica-set-only context. The orphaned-document behavior (sharded clusters) cannot be shown. Either remove `available` or add a note explaining why its behavior appears identical here.

---

## 2. Simulation Correctness

### Bugs / Inaccuracies
- **`resolveReadTarget` ignores network partitions.** It checks `node.alive` but not whether the `rp` link is connected or whether the target is reachable through the replication topology. A secondary can be alive but partitioned; the read client would still be shown routing to it. (`simulation.js:12–29`)
- **`advanceMajorityCommit` scans backward and stops at first qualifying entry.** The comment says it finds "the highest id confirmed by ≥2 nodes". If versions are non-sequential in ack state (e.g., v1: 2 acks, v2: 1 ack, v3: 2 acks), it correctly sets `majorityCommitId=3` since MongoDB commits are cumulative. This is correct but **not explained in a comment** — the implicit assumption that majority-commit of vN implies all prior versions are committed needs a code comment for maintainability. (`state.js:82–90`)
- **Election: winner selection ignores network reachability.** `buildElectionSteps` picks the candidate with the highest `docVersionId` but does not validate that a quorum can actually communicate. An isolated node could be "elected" in the simulation. (`simulation.js:438–439`)
- **After election, the old primary slot (`'primary'`) keeps its structural key** but is relabeled "Old Primary". The `primaryKey` pointer moves to `'s1'` or `'s2'`. `getLinkBetween` is slot-based, so after election **all replication links from the new primary return `null`** (the `s1↔s2` case), meaning the partition toggle no longer works for the new primary's connections. This is a known design limitation but is undocumented and will confuse users who try to inject faults post-election. (`state.js:58–62`, `draw.js:209`)
- **`reachableCount` in `buildReadSteps` uses `isReachableForWrite`** which tests reachability *for replication* (primary→node path). For reads, what matters is whether the read client can reach the target, not whether the primary can. These diverge when `rp` is cut but the replication links are intact. (`simulation.js:235–236`)

### Missing Behaviors
- **Election is 2-step only** — no heartbeat timeout concept, no term/vote visualization, no split-vote. The RAFT description in the explain text is accurate but the animation doesn't reflect it.
- **Snapshot session invalidation on election is silent in the UI.** The log records it but the step panel and session buttons don't react. A user in the middle of a snapshot session may not notice the invalidation. (`simulation.js:490–494`)
- **`rc:majority` on a partitioned secondary** shows "majority-commit frozen" correctly, but the step does not clarify that *non-causal reads still return the last frozen snapshot* while *causal reads (afterClusterTime) would block*. The distinction is in the explain text but is conflated into one UI path.

---

## 3. Code Quality

### Architecture
- **~~No modules — everything is global.~~** ✅ Done — all six JS files converted to ES modules (`export`/`import`). The six `<script src>` tags in `index.html` are replaced by a single `<script type="module" src="js/app.js">`. A new `js/logger.js` module was created to break the `app.js`↔`engine.js` circular dependency. `resolveReadTarget` moved from `simulation.js` to `state.js` to break the `draw.js`↔`simulation.js` circular dep. Dependency graph is now a clean DAG with no circular imports.
- **~~`canvas` and `ctx` are defined in `draw.js` but consumed in `app.js`** (canvas click/hover listeners). `icons.js` also assumes `ctx` exists from `draw.js`.~~** ✅ Done — `canvas`/`ctx` are now explicit named exports from `draw.js`, imported by `app.js`. `drawIcon` moved from `icons.js` into `draw.js` (where `ctx` lives); `icons.js` exports Path2D constants only. `hoverTarget` is module-private in `draw.js` with exported `getHoverTarget`/`setHoverTarget` accessors. `updateConsistencyViews` and `updateReadActionControls` moved from `app.js` to `draw.js`, eliminating the last `draw.js`↔`app.js` circular dependency.
- **~~`js/v6/` contains a full copy of all JS files.~~** ✅ Done — directory deleted.

### Performance
- **~~`draw()` calls `canvas.getBoundingClientRect()` twice per frame~~** ✅ Done — `canvasW`/`canvasH` are now cached in `resizeCanvas()` and used directly in `draw()`. (`draw.js`)
- **~~`drawWriteClient()` and `drawReadClient()` call `document.getElementById(...)` on every canvas frame.~~** ✅ Done — `draw()` reads `sel-w`, `sel-rc`, `sel-readpref` once per frame and passes them as arguments to `drawWriteClient(wVal)`, `drawReadClient(rcVal)`, and `drawReadClientLine(rcVal, readPref)`. (`draw.js`)

### Maintainability
- **~~All CSS is inline in `index.html`~~** ✅ Done — extracted to `css/style.css`. (`index.html`, `css/style.css`)
- **~~Inline `onclick` handlers in HTML~~** ✅ Done — all `onclick` attributes removed from HTML; `addEventListener` calls added in `app.js` init section.
- **~~`resetWriteVisual`/`resetReadVisual`/`resetElectionVisual` manually enumerate all engine fields~~** ✅ Done — replaced with `resetEngine(eng)` helper in `engine.js` that clears all fields and cancels the auto-finish timer. (`engine.js`, `app.js`)
- **~~`autoFinishWrite`, `autoFinishRead`, `autoFinishElection` are structurally identical~~** ✅ Done — merged into `_autoFinish(eng, advanceFn)` shared implementation; the three public functions are now thin wrappers. Auto-finish timer ID is stored on `eng._autoFinishId` instead of separate module-level vars. (`engine.js`)
- **~~`showStepPanel` derives `prefix` from `panelId` via string manipulation~~** ✅ Done — replaced with `PANEL_EL_IDS` lookup map keyed by panel ID. (`engine.js`)

---

## 4. HTML / Accessibility

- **~~No `<label for>` associations.~~** ✅ Done — all four `<label>` elements now carry matching `for` attributes (`sel-w`, `sel-j`, `sel-rc`, `sel-readpref`). (`index.html`)
- **~~Canvas has no `role` or `aria-label`.~~** ✅ Done — `role="img"` and descriptive `aria-label` added to `<canvas>`. (`index.html`)
- **Button text changes dynamically** ("New doc with ID 1" → "Update doc with ID 1") without an `aria-live` region. Assistive technology won't announce the change.
- **`<details>/<summary>` used for collapsible step details** is semantically correct but the `summary` text ("Details") is not descriptive enough for screen readers.

---

## 5. Gaps vs. Documented Scope (`scenario-coverage.md`)

The following remain open from the gap analysis (not yet implemented):

| Gap | Priority per docs | Status |
|---|---|---|
| **~~Explicit "cluster read-only" indicator~~** | Low effort, High impact | ✅ Done — added to writer consistency overlay when primary is down. (`app.js — updateConsistencyViews`) |
| `readPreference: nearest` | Medium | Not done |
| Reconfiguration button (Scenario 4) | Low–Medium | Not done |
| Election: RAFT vote animation (multi-step) | High effort | Minimal (2-step stub) |
| Retryable write simulation | Medium | Not done |
| Second application client (App A / App B) | High effort | Not done |

Election *is* partially implemented (`buildElectionSteps` exists, canvas election button, engine wired up) but the 2-step model is minimal — it skips the heartbeat-timeout → vote-request → quorum-count sequence that is central to the HA narrative.

---

## 6. Quick Wins (Low Effort, High Value)

1. **~~Default step explain to expanded~~** ✅ Done — `<details open>` in `showStepPanel`.
2. **~~Show welcome popup once~~** ✅ Done — `localStorage` flag `tcp-welcome-seen`.
3. **~~Extract CSS~~** ✅ Done — `css/style.css`.
4. **~~Remove `js/v6/`~~** ✅ Done — deleted.
5. **~~Add `aria-label` to canvas and `for` attributes to all labels~~** ✅ Done.
6. **~~Cache `getBoundingClientRect`~~** ✅ Done — `canvasW`/`canvasH` in `draw.js`.
7. **~~Add a "Cluster read-only" banner~~** ✅ Done — writer overlay now shows "No primary — read-only" when `state.nodes[primaryKey].alive === false`.
8. **~~Reset `rp`/`wp` link state when read/write preference changes~~** ✅ Done — `state.links.rp = true` on `sel-rc`/`sel-readpref` change.
