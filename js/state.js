// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════
const PARTICLE_MS  = 1400;
const AUTO_STEP_MS = 700;

// Visual pauses — skipped in tests via skipAnimations / delay()
const PAUSE_SHORT_MS    = 250;
const PAUSE_MEDIUM_MS   = 350;
const PAUSE_LONG_MS     = 600;
const PAUSE_STAGGER_MS  = 100;
const PAUSE_JOURNAL_MS  = 400;
const PAUSE_RECOVERY_MS = 600;
const AUTO_FINISH_TICK  = 10;

// Pure timing utility — no DOM deps, available to all subsequent files
function delay(ms) {
  if (typeof skipAnimations !== 'undefined' && skipAnimations) return Promise.resolve();
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
const state = {
  nodes: {
    primary: { label: 'Primary',     x: 0, y: 0, alive: true, phase: 'idle', memoryVersion: 0, journalVersion: 0 },
    s1:      { label: 'Secondary 1', x: 0, y: 0, alive: true, phase: 'idle', memoryVersion: 0, journalVersion: 0 },
    s2:      { label: 'Secondary 2', x: 0, y: 0, alive: true, phase: 'idle', memoryVersion: 0, journalVersion: 0 },
  },
  primaryKey: 'primary',
  writeClient: { x: 0, y: 0, phase: 'idle', lastWrittenVersion: 0, targetNode: null },
  readClient:  {
    x: 0, y: 0, phase: 'idle', lastReceivedVersion: null,
    sessionActive: false, sessionSnapshotId: null, targetNode: null,
  },
  particles: [],
  links: { ps1: true, ps2: true, s1s2: true, wp: true, rp: true },
  doc: {
    versions: [],        // [{ id, op:'insert'|'update', ackedBy: Set<nodeKey> }]
    latestId: 0,         // id of most recently issued write (0 = nothing written yet)
    majorityCommitId: 0, // highest id confirmed by ≥2 nodes
  },
};

// ═══════════════════════════════════════
// DOM HELPERS — semantic UI element access
// ═══════════════════════════════════════
function getSelectedWriteConcern() { return document.getElementById('sel-w').value; }
function getSelectedJournal()      { return document.getElementById('sel-j').value; }
function isJournalRequired()       { return document.getElementById('sel-j').value === 'true'; }
function getSelectedReadConcern()  { return document.getElementById('sel-rc').value; }
function getSelectedReadPref()     { return document.getElementById('sel-readpref').value; }

function setSelectedWriteConcern(v) { document.getElementById('sel-w').value = v; }
function setSelectedJournal(v)      { document.getElementById('sel-j').value = v; }
function setSelectedReadConcern(v)  { document.getElementById('sel-rc').value = v; }
function setSelectedReadPref(v)     { document.getElementById('sel-readpref').value = v; }

// ═══════════════════════════════════════
// DERIVED CONSTANTS
// ═══════════════════════════════════════
function majorityThreshold() {
  return Math.floor(Object.keys(state.nodes).length / 2) + 1;
}

function getVersionEntry(id) {
  return state.doc.versions.find(v => v.id === id);
}

// ═══════════════════════════════════════
// DOC STATE HELPERS
// ═══════════════════════════════════════
function resetDoc() {
  state.doc.versions = [];
  state.doc.latestId = 0;
  state.doc.majorityCommitId = 0;
  Object.values(state.nodes).forEach(n => { n.memoryVersion = 0; n.journalVersion = 0; });
  state.writeClient.lastWrittenVersion = 0;
  state.writeClient.targetNode = null;
  state.readClient.lastReceivedVersion = null;
  state.readClient.sessionActive = false;
  state.readClient.sessionSnapshotId = null;
  state.readClient.targetNode = null;
  // Reset election state
  state.primaryKey = 'primary';
  state.nodes.primary.label = 'Primary';
  state.nodes.s1.label = 'Secondary 1';
  state.nodes.s2.label = 'Secondary 2';
}

function resetLinks() { state.links.ps1 = true; state.links.ps2 = true; state.links.s1s2 = true; state.links.wp = true; state.links.rp = true; }

// Returns the link key for the structural connection between two node keys.
// Links are named for the original topology: ps1 = 'primary'↔'s1', ps2 = 'primary'↔'s2'.
// After election the same link keys still represent the physical wire between those node slots.
function getLinkBetween(a, b) {
  if ((a === 'primary' && b === 's1') || (a === 's1' && b === 'primary')) return 'ps1';
  if ((a === 'primary' && b === 's2') || (a === 's2' && b === 'primary')) return 'ps2';
  if ((a === 's1' && b === 's2') || (a === 's2' && b === 's1')) return 's1s2';
  return null;
}

// Canonical write target — ALL write operations must use this, never raw state.primaryKey.
// Manual targeting (click client circle) overrides automatic primary routing.
function effectiveWriteTarget() {
  return state.writeClient.targetNode || state.primaryKey;
}

// Reachability is relative to the write target, not the primary — matters when
// client is manually targeted to a different node.
function isReachableForWrite(key) {
  const wt = effectiveWriteTarget();
  if (key === wt) return state.nodes[key].alive;
  const linkKey = getLinkBetween(wt, key);
  return state.nodes[key].alive && (linkKey ? state.links[linkKey] : true);
}

// Reachability from the primary's perspective (used by linearizable reads).
function isReachableFromPrimary(key) {
  const pk = state.primaryKey;
  if (key === pk) return state.nodes[key].alive;
  const linkKey = getLinkBetween(pk, key);
  return state.nodes[key].alive && (linkKey ? state.links[linkKey] : true);
}

// BFS from nodeKey over alive nodes connected by up links.
function getPartition(nodeKey) {
  const visited = new Set();
  if (!state.nodes[nodeKey].alive) return visited;
  visited.add(nodeKey);
  const queue = [nodeKey];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const other of Object.keys(state.nodes)) {
      if (visited.has(other) || !state.nodes[other].alive) continue;
      const linkKey = getLinkBetween(current, other);
      if (linkKey && state.links[linkKey]) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  return visited;
}

function isPrimaryPartitioned() {
  const pk = state.primaryKey;
  if (!state.nodes[pk].alive) return false;
  const partition = getPartition(pk);
  return partition.size < majorityThreshold();
}

// Computed, not stored — isolation is dynamic based on current topology.
// Used by draw.js to show amber ring + "(isolated)" label.
//
// We use a direct-link check, NOT transitive BFS, because the simulator
// excludes chained replication. A secondary with only the s1↔s2 heartbeat
// path to the primary cannot receive writes or send ack reports — it is
// effectively isolated for replication purposes.
// Note: isPrimaryPartitioned() still uses full BFS because election quorum
// counts heartbeat connectivity (secondaries can vote via the s1↔s2 link).
function isNodeIsolated(nodeKey) {
  if (nodeKey === state.primaryKey) return false;
  const node = state.nodes[nodeKey];
  if (!node.alive) return false;
  const linkKey = getLinkBetween(nodeKey, state.primaryKey);
  return !linkKey || !state.links[linkKey];
}

function isTopologyTarget(hit) {
  return hit.type === 'node' || hit.type === 'link' || hit.type === 'clientLink';
}

function hasActiveSnapshotSession() {
  return state.readClient.sessionActive && state.readClient.sessionSnapshotId !== null;
}

function getServedVersion(nodeKey, rc) {
  const node = state.nodes[nodeKey];
  if (rc === 'local' || rc === 'available') {
    const id = node.memoryVersion;
    return { id, dirty: id > 0 && id > state.doc.majorityCommitId };
  }
  // majority, linearizable, snapshot → majority-commit point, capped by what
  // this node actually has replicated (a node can't serve data it doesn't have)
  const id = Math.min(state.doc.majorityCommitId, node.memoryVersion);
  return { id, dirty: false };
}

// Flush a node's in-memory data to its on-disk journal (crash-safe).
function journalFlush(nodeKey) {
  const node = state.nodes[nodeKey];
  node.journalVersion = node.memoryVersion;
}

// On crash: wipe volatile memory, preserve journal. Remove memory-only acks.
function crashNode(nodeKey) {
  const node = state.nodes[nodeKey];
  const lostVersion = node.memoryVersion;
  node.memoryVersion = 0;
  // Retract acks for any version this node had only in memory (not journaled)
  if (lostVersion > node.journalVersion) {
    state.doc.versions.forEach(v => {
      if (v.id > node.journalVersion && v.ackedBy.has(nodeKey)) {
        v.ackedBy.delete(nodeKey);
      }
    });
    recomputeMajorityCommit();
  }
}

// On restart: recover from journal into memory.
function recoverNode(nodeKey) {
  const node = state.nodes[nodeKey];
  node.memoryVersion = node.journalVersion;
}

// Full recomputation of majorityCommitId from scratch (needed after crash retracts acks).
function recomputeMajorityCommit() {
  state.doc.majorityCommitId = 0;
  for (let i = state.doc.versions.length - 1; i >= 0; i--) {
    if (state.doc.versions[i].ackedBy.size >= majorityThreshold()) {
      state.doc.majorityCommitId = state.doc.versions[i].id;
      break;
    }
  }
}

function advanceMajorityCommit() {
  // Scans from the latest version backward. MongoDB commits are cumulative: if vN is
  // majority-confirmed, all prior versions are implicitly committed too, so we stop at
  // the first (highest) version that has ≥2 acks.
  for (let i = state.doc.versions.length - 1; i >= 0; i--) {
    const ver = state.doc.versions[i];
    if (ver.ackedBy.size >= majorityThreshold() && ver.id > state.doc.majorityCommitId) {
      state.doc.majorityCommitId = ver.id;
      break;
    }
  }
}

// Oplog catch-up / rollback on rejoin — called when a secondary reconnects to
// the primary (node revived or link restored). Syncs the node to the primary's
// current data level: catches UP if the node fell behind, caps DOWN if it held
// stale data beyond what the primary has (post-election rollback).
// Also advances majorityCommitId when the new ack creates a majority.
function syncRejoiningNode(nodeKey) {
  const pk = state.primaryKey;
  if (nodeKey === pk) return false;
  if (!state.nodes[pk].alive) return false;
  if (!state.nodes[nodeKey].alive) return false;
  if (isNodeIsolated(nodeKey)) return false;

  const node = state.nodes[nodeKey];
  const primaryLevel = state.nodes[pk].memoryVersion;

  node.memoryVersion  = primaryLevel;
  node.journalVersion = primaryLevel;

  state.doc.versions.forEach(v => {
    if (v.id <= primaryLevel) v.ackedBy.add(nodeKey);
    else v.ackedBy.delete(nodeKey);
  });
  advanceMajorityCommit();

  return true;
}

// Resolves which node should serve a read given rc and readPreference.
// Lives here (not simulation.js) because both draw.js and simulation.js need it.
function resolveReadTarget(rc, readPref) {
  // Manual override — user pinned the reader to a specific node
  if (state.readClient.targetNode) return state.readClient.targetNode;

  const pk = state.primaryKey;
  const secKeys = Object.keys(state.nodes).filter(k => k !== pk);
  if (rc === 'linearizable') return pk;
  if (readPref === 'primary')
    return state.nodes[pk].alive ? pk : null;
  if (readPref === 'primaryPreferred') {
    if (state.nodes[pk].alive) return pk;
    return secKeys.find(k => state.nodes[k].alive) || null;
  }
  if (readPref === 'secondary')
    return secKeys.slice().reverse().find(k => state.nodes[k].alive) || null;
  if (readPref === 'secondaryPreferred') {
    const sec = secKeys.find(k => state.nodes[k].alive);
    return sec || (state.nodes[pk].alive ? pk : null);
  }
  return pk;
}
