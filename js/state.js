// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════
const PARTICLE_MS  = 1400;
const AUTO_STEP_MS = 700;

// Pure timing utility — no DOM deps, available to all subsequent files
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
const state = {
  nodes: {
    primary: { label: 'Primary',     x: 0, y: 0, alive: true, phase: 'idle', docVersionId: 0 },
    s1:      { label: 'Secondary 1', x: 0, y: 0, alive: true, phase: 'idle', docVersionId: 0 },
    s2:      { label: 'Secondary 2', x: 0, y: 0, alive: true, phase: 'idle', docVersionId: 0 },
  },
  primaryKey: 'primary', // which node key is currently acting as primary
  writeClient: { x: 0, y: 0, phase: 'idle', lastWrittenVersion: 0 },
  readClient:  {
    x: 0, y: 0, phase: 'idle', lastReceivedVersion: null,
    sessionActive: false, sessionSnapshotId: null,
  },
  particles: [],
  links: { ps1: true, ps2: true, wp: true, rp: true },
  doc: {
    versions: [],        // [{ id, op:'insert'|'update', ackedBy: Set<nodeKey> }]
    latestId: 0,         // id of most recently issued write (0 = nothing written yet)
    majorityCommitId: 0, // highest id confirmed by ≥2 nodes
  },
};

// ═══════════════════════════════════════
// DOC STATE HELPERS
// ═══════════════════════════════════════
function resetDoc() {
  state.doc.versions = [];
  state.doc.latestId = 0;
  state.doc.majorityCommitId = 0;
  Object.values(state.nodes).forEach(n => { n.docVersionId = 0; });
  state.writeClient.lastWrittenVersion = 0;
  state.readClient.lastReceivedVersion = null;
  state.readClient.sessionActive = false;
  state.readClient.sessionSnapshotId = null;
  // Reset election state
  state.primaryKey = 'primary';
  state.nodes.primary.label = 'Primary';
  state.nodes.s1.label = 'Secondary 1';
  state.nodes.s2.label = 'Secondary 2';
}

function resetLinks() { state.links.ps1 = true; state.links.ps2 = true; state.links.wp = true; state.links.rp = true; }

// Returns the link key for the structural connection between two node keys.
// Links are named for the original topology: ps1 = 'primary'↔'s1', ps2 = 'primary'↔'s2'.
// After election the same link keys still represent the physical wire between those node slots.
function getLinkBetween(a, b) {
  if ((a === 'primary' && b === 's1') || (a === 's1' && b === 'primary')) return 'ps1';
  if ((a === 'primary' && b === 's2') || (a === 's2' && b === 'primary')) return 'ps2';
  return null; // s1↔s2 has no toggleable link — always connected after election
}

function isReachableForWrite(key) {
  const pk = state.primaryKey;
  if (key === pk) return state.nodes[key].alive;
  const lk = getLinkBetween(pk, key);
  return state.nodes[key].alive && (lk ? state.links[lk] : true);
}

function getServedVersion(nodeKey, rc) {
  const node = state.nodes[nodeKey];
  if (rc === 'local' || rc === 'available') {
    const id = node.docVersionId;
    return { id, dirty: id > 0 && id > state.doc.majorityCommitId };
  }
  // majority, linearizable, snapshot → majority-commit point
  const id = state.doc.majorityCommitId;
  return { id, dirty: false };
}

function advanceMajorityCommit() {
  // Scans from the latest version backward. MongoDB commits are cumulative: if vN is
  // majority-confirmed, all prior versions are implicitly committed too, so we stop at
  // the first (highest) version that has ≥2 acks.
  for (let i = state.doc.versions.length - 1; i >= 0; i--) {
    const v = state.doc.versions[i];
    if (v.ackedBy.size >= 2 && v.id > state.doc.majorityCommitId) {
      state.doc.majorityCommitId = v.id;
      break;
    }
  }
}

// Resolves which node should serve a read given rc and readPreference.
// Lives here (not simulation.js) because both draw.js and simulation.js need it.
function resolveReadTarget(rc, readPref) {
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
    const s = secKeys.find(k => state.nodes[k].alive);
    return s || (state.nodes[pk].alive ? pk : null);
  }
  return pk;
}
