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
}

function resetLinks() { state.links.ps1 = true; state.links.ps2 = true; state.links.wp = true; state.links.rp = true; }

function isReachableForWrite(key) {
  if (key === 'primary') return state.nodes.primary.alive;
  return state.nodes[key].alive && state.links['p' + key];
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
  for (let i = state.doc.versions.length - 1; i >= 0; i--) {
    const v = state.doc.versions[i];
    if (v.ackedBy.size >= 2 && v.id > state.doc.majorityCommitId) {
      state.doc.majorityCommitId = v.id;
      break;
    }
  }
}
