// ═══════════════════════════════════════
// BUILD ELECTION STEPS
// ═══════════════════════════════════════

function selectElectionCandidates(pk, forcePartition, majorityNeeded) {
  if (forcePartition) {
    const secKeys = Object.keys(state.nodes).filter(k => k !== pk && state.nodes[k].alive);
    if (secKeys.length === 0) return [];
    const secPartition = getPartition(secKeys[0]);
    secPartition.delete(pk);
    if (secPartition.size < majorityNeeded) return [];
    return [...secPartition]
      .sort((a, b) => (state.nodes[b].memoryVersion || 0) - (state.nodes[a].memoryVersion || 0));
  }
  return Object.keys(state.nodes)
    .filter(k => k !== pk && state.nodes[k].alive)
    .sort((a, b) => (state.nodes[b].memoryVersion || 0) - (state.nodes[a].memoryVersion || 0));
}

function swapPrimaryRole(winner, oldPk, forcePartition) {
  const winnerNode = state.nodes[winner];
  const oldLabel = winnerNode.label;
  state.primaryKey = winner;
  winnerNode.label = 'Primary';
  if (forcePartition) {
    state.nodes[oldPk].label = oldLabel.replace('Primary', 'Secondary').trim() || oldLabel;
  } else {
    state.nodes[oldPk].label = oldLabel;
  }
  return oldLabel;
}

function rollbackUncommittedVersions() {
  state.doc.versions = state.doc.versions.filter(v => v.id <= state.doc.majorityCommitId);
  state.doc.latestId = state.doc.majorityCommitId;
}

function capWinningPartitionVersions(winner) {
  const winPartition = getPartition(winner);
  Object.entries(state.nodes).forEach(([k, n]) => {
    if (winPartition.has(k)) {
      n.memoryVersion  = Math.min(n.memoryVersion  || 0, state.doc.majorityCommitId);
      n.journalVersion = Math.min(n.journalVersion || 0, state.doc.majorityCommitId);
    }
  });
}

function invalidateSnapshotIfNeeded() {
  if (state.readClient.sessionActive &&
      state.readClient.sessionSnapshotId > state.doc.majorityCommitId) {
    state.readClient.sessionActive = false;
    state.readClient.sessionSnapshotId = null;
    log('Snapshot session invalidated - locked version was rolled back.', 'warn');
  }
}

function logElectionResult(uncommitted, oldPk, oldLabel, forcePartition) {
  if (uncommitted.length > 0) {
    const vList = uncommitted.map(v => `v${v.id}`).join(', ');
    const isStaleRetained = forcePartition
      && state.nodes[oldPk].memoryVersion > state.doc.majorityCommitId;
    const suffix = isStaleRetained
      ? 'Old primary retains stale data until it reconnects.'
      : '\u2014 rolled back.';
    log(`Rollback: ${vList} not majority-committed. ${suffix}`, 'warn');
  }
  if (forcePartition) {
    log(`${oldLabel} is now Primary. Old primary stepped down and is isolated.`, 'warn');
  } else {
    log(`${oldLabel} is now Primary. Writes can resume.`, 'ok');
  }
}

function buildQuorumFailureStep(candidates, totalAlive, majorityNeeded, forcePartition) {
  const reason = candidates.length === 0
    ? (forcePartition ? `No reachable secondary partition forms a majority.` : `No alive secondaries available.`)
    : `Only ${totalAlive} of ${Object.keys(state.nodes).length} voting members ${forcePartition ? 'in the partition' : 'alive'} - need ${majorityNeeded} (majority) to hold an election.`;
  const tImp = TEXTS.election.impossible(reason);
  return [{
    title: tImp.title, explain: tImp.explain,
    run: async () => { log(`Election aborted - ${reason}`, 'err'); draw(); },
  }];
}

function buildCampaignAndElectedSteps(winner, pk, forcePartition) {
  const winnerNode = state.nodes[winner];
  const uncommitted = state.doc.versions.filter(v => v.id > state.doc.majorityCommitId);
  const tCamp = TEXTS.election.campaign(winnerNode.label, winnerNode.memoryVersion || 'none');
  const rollbackNote = TEXTS.election.rollbackNote(uncommitted);
  const tElected = TEXTS.election.elected(winnerNode.label, rollbackNote, state.doc.majorityCommitId);

  return [
    { title: tCamp.title, explain: tCamp.explain,
      run: async () => {
        winnerNode.phase = 'candidate';
        draw();
        log(`Election in progress - ${winnerNode.label} is campaigning (oplog v${winnerNode.memoryVersion || 'none'}).`, 'warn');
      },
    },
    { title: tElected.title, explain: tElected.explain,
      run: async () => {
        const oldLabel = swapPrimaryRole(winner, pk, forcePartition);
        rollbackUncommittedVersions();
        capWinningPartitionVersions(winner);
        invalidateSnapshotIfNeeded();
        Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
        logElectionResult(uncommitted, pk, oldLabel, forcePartition);
        draw();
      },
    },
  ];
}

function buildElectionSteps(opts) {
  const forcePartition = opts && opts.forcePartition;
  const pk = state.primaryKey;
  const majorityNeeded = majorityThreshold();
  const candidates = selectElectionCandidates(pk, forcePartition, majorityNeeded);
  const totalAlive = forcePartition
    ? candidates.length
    : Object.values(state.nodes).filter(n => n.alive).length;

  if (candidates.length === 0 || totalAlive < majorityNeeded) {
    return buildQuorumFailureStep(candidates, totalAlive, majorityNeeded, forcePartition);
  }
  return buildCampaignAndElectedSteps(candidates[0], pk, forcePartition);
}
