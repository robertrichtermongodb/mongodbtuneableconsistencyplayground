// ═══════════════════════════════════════
// CENTRALIZED USER-FACING TEXTS
// ═══════════════════════════════════════
// All user-visible strings in one place for review and consistency.
// Each section follows the pattern: plain-English summary first, then technical detail.

const TEXTS = {

  // ─── Default safety note (appended to risky states) ──────────────────
  defaultNote: `<br><em class="default-safety">\u2139 MongoDB defaults to <strong>w:majority</strong> since v5.0, which prevents this by requiring a majority of nodes to confirm the write to disk before acknowledging.</em>`,

  safetyNote: `<div class="cb-default-note">\u2139 The MongoDB default <strong>w:majority</strong> prevents this \u2014 the client only gets an acknowledgment after 2+ nodes confirm the write to disk.</div>`,

  // ─── Dropdown tooltips ───────────────────────────────────────────────
  dropdowns: {
    'sel-w': {
      '0':        'Write Concern (w)\n\nw:0 \u2014 Fire & forget. The client sends the write but receives no confirmation at all. It won\'t know if the write succeeded or failed. Fastest option, but zero durability guarantees.',
      '1':        'Write Concern (w)\n\nw:1 \u2014 Primary only. The primary confirms after storing the write in memory. Fast, but if the primary crashes before copying the data to a secondary, the write is permanently lost.',
      '2':        'Write Concern (w)\n\nw:2 \u2014 Two nodes must confirm. The write exists on at least two nodes before the client is notified, greatly reducing the chance of data loss compared to w:1.',
      '3':        'Write Concern (w)\n\nw:3 \u2014 All three nodes must confirm. The write is verified on every member of the replica set. Strongest durability but highest latency since all nodes must respond.',
      'majority': 'Write Concern (w)\n\nw:majority \u2014 A majority of nodes (2 of 3) must confirm. This is MongoDB\'s default since v5.0. The write survives any single-node failure \u2014 the standard balance of safety and performance.',
    },
    'sel-j': {
      'false': 'Journal (j)\n\nj:false \u2014 A node counts its confirmation when the write reaches memory. The write to disk happens shortly after (~50ms). If the node crashes before that, data in memory is lost.\n\nNote: w:majority overrides this to j:true by default (writeConcernMajorityJournalDefault).',
      'true':  'Journal (j)\n\nj:true \u2014 A node only counts its confirmation after the write is saved to disk (journal). This makes the write crash-safe before the client hears back. Adds latency but prevents data loss on node failure.',
    },
    'sel-rc': {
      'local':        'Read Concern\n\nrc:local \u2014 Returns whatever the target node currently has, with no waiting. Fastest read, but may include data not yet confirmed by other nodes. If the primary fails, unconfirmed data could disappear (dirty read risk).',
      'available':    'Read Concern\n\nrc:available \u2014 Behaves identically to rc:local on replica sets. The distinction only matters on sharded clusters, where it may return orphaned documents during chunk migrations.',
      'majority':     'Read Concern\n\nrc:majority \u2014 Returns only data confirmed by a majority of nodes. This data is guaranteed to never disappear, even if the primary fails. Recommended default \u2014 trades a small amount of freshness for strong consistency.',
      'snapshot':     'Read Concern\n\nrc:snapshot \u2014 Returns a frozen point-in-time view of majority-confirmed data. Within a session, all reads see the exact same state \u2014 no phantom reads, no changing results. Designed for multi-document transactions.',
      'linearizable': 'Read Concern\n\nrc:linearizable \u2014 Strongest guarantee. The primary must prove it still leads the cluster by communicating with other nodes before answering. Ensures real-time ordering. Always set maxTimeMS to avoid indefinite blocking.',
    },
    'sel-readpref': {
      'primary':            'Read Preference\n\nprimary \u2014 Always read from the primary. Guarantees the freshest data since the primary receives all writes first. Required for rc:linearizable.',
      'primaryPreferred':   'Read Preference\n\nprimaryPreferred \u2014 Read from the primary if it\u2019s available, otherwise fall back to a secondary. Useful when you prefer fresh data but want reads to continue during failovers.',
      'secondary':          'Read Preference\n\nsecondary \u2014 Always read from a secondary. Takes read load off the primary, but the secondary may be slightly behind \u2014 reads can return older data depending on replication delay.',
      'secondaryPreferred': 'Read Preference\n\nsecondaryPreferred \u2014 Read from a secondary if one is available, otherwise fall back to the primary. Good for spreading read load while staying available.',
    },
  },

  // ─── Button tooltips ─────────────────────────────────────────────────
  buttons: {
    'btn-write-start':        'Start a write operation with the selected settings. Steps through the full replication flow one step at a time.',
    'btn-write-next':         'Advance to the next step in the write flow.',
    'btn-write-finish':       'Skip to the end and show the final state instantly (no animations).',
    'btn-read-start':         'Issue a read with the selected read concern and preference. Steps through the read flow one at a time.',
    'btn-read-next':          'Advance to the next step in the read flow.',
    'btn-read-finish':        'Skip to the end and show the final state instantly.',
    'btn-read-session-start': 'Open a snapshot session pinned at the current majority-confirmed point, then perform the first read.',
    'btn-read-session-again': 'Read again within the same snapshot session. The result should be identical \u2014 that\u2019s the snapshot guarantee.',
    'btn-read-session-end':   'Close the snapshot session. Future reads will use a fresh majority-confirmed point.',
    'btn-reset':              'Reset everything \u2014 all nodes healthy, all links connected, document cleared.',
    'btn-theme-toggle':       'Switch between dark and light theme.',
    'btn-canvas-election':    'Trigger Election\n\nUses RAFT consensus: secondaries vote for the candidate with the most up-to-date data. A majority wins and becomes the new primary. Unconfirmed writes on the old primary are rolled back.',
  },

  // ─── Config badge tooltips ───────────────────────────────────────────
  badge: {
    default: 'Default (since MongoDB 5.0)\n\nw:majority waits for a majority of replica set members to confirm the write to disk before acknowledging. This prevents data loss and rollback in all failure scenarios.',
    nonDefault(w) {
      return `Non-default write concern\n\nYou are using w:${w}, which confirms before a majority of nodes have the data. If the primary fails before replication, the write can be lost \u2014 even though the client received a confirmation. MongoDB defaults to w:majority since v5.0 to prevent this.`;
    },
  },

  // ─── Write machine step texts ────────────────────────────────────────
  write: {
    writerDisconnected: {
      title: 'Writer disconnected \u2014 cannot reach primary',
      explain: `The writer\u2019s network connection to the primary is <strong>interrupted</strong>. No writes can be sent. Click the writer\u2192primary link on the canvas to reconnect.`,
    },

    primaryDown: {
      title: 'No primary \u2014 write fails',
      explain: `The primary is down and MongoDB cannot accept writes without one. <strong>Use the Trigger Election button</strong> if a majority of nodes are alive to promote a new primary.`,
    },

    primaryCrashedUnjournaled(opLabel, isDefault, defaultNote) {
      return {
        title: 'Primary crashed \u2014 data lost',
        explain: `The primary crashed after storing <strong>${opLabel}</strong> in memory but <strong>before writing it to disk</strong>. ` +
          `Since the data was only in memory, it is permanently lost. The client receives a <strong>network error</strong>.` +
          (!isDefault ? defaultNote : ''),
      };
    },

    primaryCrashedJournaled(opLabel) {
      return {
        title: 'Primary crashed \u2014 replication stopped',
        explain: `The primary crashed, but <strong>${opLabel}</strong> was already <strong>written to disk</strong> and will survive recovery. ` +
          `However, replication to secondaries is halted. The client receives a <strong>network error</strong>. ` +
          `After an election, a new primary can continue replication from the saved data.`,
      };
    },

    primaryBouncedUnjournaled(opLabel, isDefault, defaultNote) {
      return {
        title: 'Primary restarted \u2014 data lost',
        explain: `The primary restarted but <strong>${opLabel}</strong> was only stored in memory (not yet on disk). ` +
          `The in-memory data was lost during the restart. The client receives a <strong>network error</strong>.` +
          (!isDefault ? defaultNote : ''),
      };
    },

    primaryBouncedAfterAck(opLabel, isDefault, defaultNote) {
      return {
        title: 'Primary restarted \u2014 background replication aborted',
        explain: `The primary restarted after the client already received confirmation. <strong>${opLabel}</strong> was lost from the primary\u2019s memory ` +
          `(not yet saved to disk). Background replication cannot continue. ` +
          `<em>The client believes the write succeeded, but a subsequent read with <strong>rc:majority</strong> will not find it \u2014 ` +
          `this is the <strong>rollback risk</strong> of non-default write concerns.</em>` +
          (!isDefault ? defaultNote : ''),
      };
    },

    clientSend(opLabel, w, j) {
      return {
        title: `Write Client sends ${opLabel}`,
        explain: `<strong>All MongoDB writes go to the primary.</strong> The write client sends <strong>${opLabel}</strong> with ` +
          `write concern <strong>w:${w}${j ? ', j:true' : ''}</strong>.` +
          `<br><em>The write concern controls when the primary sends confirmation back to the client \u2014 ` +
          `it does not delay the write itself from being applied.</em>`,
      };
    },

    primaryMem(opLabel, ackNeedsJournal, j) {
      return {
        title: `Primary stores ${opLabel} in memory`,
        explain: `The primary stores <strong>${opLabel}</strong> in its <strong>in-memory cache</strong> and records it in the oplog (operation log). ` +
          (ackNeedsJournal
            ? `With <strong>${j ? 'j:true' : 'w:majority'}</strong>, the primary\u2019s confirmation won\u2019t count until the next step writes the data to disk.`
            : `The write can now be read with <strong>rc:local</strong>, but it\u2019s <strong>not yet on disk</strong> \u2014 a crash would lose it. ` +
              `With <strong>j:false</strong>, this already counts as the primary\u2019s confirmation (no need to wait for the disk write).`),
      };
    },

    primaryJournal(opLabel, ackNeedsJournal, j) {
      return {
        title: `Primary journal flush \u2014 ${opLabel} saved to disk${ackNeedsJournal ? ' (required for confirmation)' : ''}`,
        explain: ackNeedsJournal
          ? `The primary writes <strong>${opLabel}</strong> to its <strong>on-disk journal</strong>, making the data crash-safe. ` +
            (j ? `<strong>j:true</strong> requires this disk write before the primary\u2019s confirmation counts.`
               : `<strong>w:majority</strong> requires a disk write before confirmation \u2014 even though the client set j:false. MongoDB\u2019s default server config overrides j:false for majority writes to ensure full durability.`)
          : `The primary writes <strong>${opLabel}</strong> to its <strong>on-disk journal</strong>. The data on this node now <strong>survives a crash or restart</strong>. ` +
            `The primary\u2019s confirmation was already counted in the previous step (memory) because j:false doesn\u2019t require a disk write for confirmation.`,
      };
    },

    fireForget(opLabel) {
      return {
        title: 'Fire-and-forget (w:0) \u2014 no confirmation',
        explain: `<strong>w:0</strong>: the client sent the write but asked for no confirmation at all. ` +
          `It won\u2019t know if the write succeeded or failed. Background replication to secondaries proceeds normally.`,
      };
    },

    secondaryMem(label, opLabel, acked, ackNeedsJournal, j) {
      const isRequired = !acked;
      return {
        title: `${label}: receives ${opLabel}`,
        explain: isRequired
          ? `The primary sends <strong>${opLabel}</strong> to <strong>${label}</strong> via oplog replication. The secondary stores it in memory.` +
            (ackNeedsJournal
              ? ` The secondary has the data in memory, but its confirmation won\u2019t count yet \u2014 <strong>${j ? 'j:true' : 'w:majority'}</strong> requires a disk write first.`
              : ` With <strong>j:false</strong>, this node\u2019s confirmation counts immediately \u2014 no need to wait for the disk write.`)
          : `The primary sends <strong>${opLabel}</strong> to <strong>${label}</strong> via oplog replication (background). ` +
            `This happens <strong>after the client already received confirmation</strong>.`,
      };
    },

    secondaryJournal(label, nextId, acked, ackNeedsJournal, w) {
      const isRequired = !acked;
      return {
        title: `${label}: journal flush to disk${ackNeedsJournal && isRequired ? ' (required for confirmation)' : ''}`,
        explain: ackNeedsJournal && isRequired
          ? `<strong>${label}</strong> writes <strong>v${nextId}</strong> to its on-disk journal, making the data crash-safe on this node. ` +
            `This node\u2019s confirmation now counts toward satisfying the write concern (w:${w}).`
          : `<strong>${label}</strong> writes <strong>v${nextId}</strong> to its on-disk journal. The data on this node now <strong>survives a crash or restart</strong>.`,
      };
    },

    ack(opLabel, w, j, nextId, ackNeedsJournal, needCount, isDefault, defaultNote) {
      return {
        title: `ACK \u2014 ${opLabel} acknowledged`,
        explain: `Enough nodes have confirmed the write for <strong>w:${w}${j ? ', j:true' : ''}</strong>. ` +
          (w === 'majority'
            ? `<strong>Fully durable.</strong> v${nextId} is confirmed by a majority. It survives the failure of any single node \u2014 no risk of data loss.` +
              (!j ? ` <em>(MongoDB\u2019s default server config requires a disk write for majority confirmations, even when the client sets j:false.)</em>` : '')
            : w === 1
            ? `Only the primary has confirmed. v${nextId} is on disk on the primary but <strong>not yet copied to any secondary</strong>. ` +
              `If the primary fails before a secondary gets this data, <strong>the write is permanently lost</strong> even though the client was told it succeeded.` +
              `<br><em>CAP trade-off: Availability over Consistency (PA). w:1 keeps the primary responsive even under partition \u2014 ` +
              `it ACKs without waiting for peers. If the primary is actually isolated, these writes will be rolled back after election. ` +
              `In production, the primary steps down ~10\u202Fs after losing majority heartbeats.</em>` +
              defaultNote
            : `Confirmed by ${needCount} node(s). Remaining secondaries will receive the data in the background.` +
              defaultNote),
      };
    },

    wcUnsatisfied(opLabel, w, needCount, reachCount) {
      const isMajority = w === 'majority';
      return {
        title: 'Write concern cannot be satisfied',
        explain: `<strong>w:${w}</strong> needs ${needCount} node(s) to confirm, but only ${reachCount} are reachable. ` +
          `MongoDB will wait until enough nodes become available or the <strong>wtimeout</strong> fires. ` +
          `<strong>The write (${opLabel}) is NOT lost</strong> \u2014 it is already stored on the primary\u2019s journal. ` +
          (isMajority
            ? `<br><br><strong>CAP trade-off: Consistency over Availability (CP).</strong> ` +
              `w:majority refuses to confirm a write that isn\u2019t verified by a majority \u2014 the client is told the write failed, ` +
              `preventing a split-brain scenario where two partitions accept conflicting writes.`
            : `However, since w:${w} doesn\u2019t require majority confirmation, the data may be rolled back if an election occurs in another partition.`) +
          `<br><em>In production the primary would also step down after ~10\u202Fs once heartbeats confirm it has lost majority. ` +
          `The simulator skips this delay \u2014 the write concern itself already prevents inconsistency.</em>`,
      };
    },

    replComplete(nextId) {
      return {
        title: `Replication complete \u2014 all nodes at v${nextId}`,
        explain: `All reachable nodes now have <strong>v${nextId}</strong> stored in memory and on disk. The write is fully distributed across the replica set.`,
      };
    },
  },

  // ─── Read step texts ─────────────────────────────────────────────────
  read: {
    disconnected: {
      title: 'Reader disconnected \u2014 cannot reach cluster',
      explain: `The reader\u2019s network connection is <strong>interrupted</strong>. No reads can be served. Click the reader link on the canvas to reconnect.`,
    },

    rcNote: {
      local:        `<strong>rc:local</strong> \u2014 returns the node\u2019s current data with no waiting or coordination. Fastest, but may include data not yet confirmed by other nodes (dirty read risk).`,
      available:    `<strong>rc:available</strong> \u2014 same as rc:local on replica sets. (On sharded clusters it may return orphaned documents from migrations.)`,
      majority:     (mcId) => `<strong>rc:majority</strong> \u2014 returns only data confirmed by a majority of nodes (currently <strong>v${mcId > 0 ? mcId : 'none'}</strong>). This data will never disappear, even if the primary fails.`,
      snapshot:     (mcId) => `<strong>rc:snapshot</strong> \u2014 returns a frozen point-in-time view of majority-confirmed data (currently <strong>v${mcId > 0 ? mcId : 'none'}</strong>). Designed for multi-document transactions.`,
      linearizable: `<strong>rc:linearizable</strong> \u2014 strongest guarantee. The primary must prove it still leads the cluster before answering. Ensures real-time ordering. Always use maxTimeMS to avoid hanging.`,
    },

    issueRead(rc, readPrefLabel, vLabel, rcNoteText, isLinForced) {
      return {
        title: `Read Client requests doc #1 (${vLabel} expected)`,
        explain: `Read issued with <strong>rc:${rc}</strong> to <strong>${readPrefLabel}</strong>. ${rcNoteText}` +
          (isLinForced ? ` <strong>rc:linearizable always routes to the primary</strong>, regardless of your read preference setting.` : ``),
      };
    },

    noEligibleNode(readPref) {
      return {
        title: 'No eligible node \u2014 read fails',
        explain: `Read preference <strong>${readPref}</strong> found no alive node that matches. ` +
          (readPref === 'primary' ? `The primary is down.` : `No secondaries are alive.`) +
          ` The client receives a connection error.`,
      };
    },

    localRead(targetKey, primaryKey, nodeLabel, dirty, mcId) {
      const isPrimary = targetKey === primaryKey;
      return {
        title: `Node reads local data \u2192 ${nodeLabel}${dirty ? ' \u26A0 (dirty)' : nodeLabel !== 'none' ? ' \u2713' : ''}`,
        explain: isPrimary
          ? `The primary returns its latest data: <strong>${nodeLabel}</strong>.` +
            (dirty ? ` This is above the majority-confirmed point (v${mcId}) \u2014 <strong>dirty read risk</strong>: if the primary fails before this data reaches a majority, it could disappear and your client already saw it.` : '')
          : `The secondary returns whatever it currently has \u2014 <strong>no waiting, no coordination</strong>: <strong>${nodeLabel}</strong>.` +
            (dirty ? ` This is above the majority-confirmed point (v${mcId}) \u2014 <strong>dirty read risk</strong>: this data could disappear if the primary fails before it\u2019s confirmed by enough nodes.`
                   : mcId > 0 ? ` Majority-confirmed at v${mcId}.` : ''),
      };
    },

    majorityFrozen(reachableCount) {
      return {
        title: 'Majority-confirmed point is frozen',
        explain: `With only <strong>${reachableCount} reachable node(s)</strong>, no new writes can be confirmed by a majority (needs 2). ` +
          `The last confirmed data is still available and safe from rollback, but it may become increasingly stale while the cluster is degraded.`,
      };
    },

    majorityFrozenReturn(frozenLabel) {
      return {
        title: `Returns frozen snapshot \u2192 ${frozenLabel}`,
        explain: `The node returns its last majority-confirmed snapshot: <strong>${frozenLabel}</strong>. ` +
          `This data is <strong>safe from rollback</strong> but may be stale \u2014 it reflects the last time a majority of nodes confirmed a write.`,
      };
    },

    majorityRead(servedLabel, targetKey, primaryKey, globalMcLabel) {
      const isPrimary = targetKey === primaryKey;
      const lagNote = globalMcLabel
        ? `<br><br>The cluster majority-confirmed point is <strong>${globalMcLabel}</strong>, but this node has only replicated up to <strong>${servedLabel}</strong> \u2014 ` +
          `<strong>rc:majority</strong> caps the result at what this node actually holds.`
        : '';
      return {
        title: `Node reads majority-confirmed data \u2192 ${servedLabel}`,
        explain: `The node returns data that has been confirmed by a majority of nodes: <strong>${servedLabel}</strong>. ` +
          (isPrimary
            ? `On the <strong>primary</strong>, this is the most current safe view. No rollback risk.`
            : `On this <strong>secondary</strong>, the confirmed point may lag slightly behind the primary due to replication delay. The data is <strong>guaranteed safe from rollback</strong>.`) +
          lagNote,
      };
    },

    linearizableCheck: {
      title: 'Primary checks leadership with secondaries',
      explain: `<strong>rc:linearizable</strong> requires the primary to prove it is still the leader before answering. ` +
        `It does this by communicating with secondaries \u2014 if a majority responds, leadership is confirmed. ` +
        `This prevents a stale primary (that was secretly replaced) from serving outdated data.`,
    },

    linearizableEval: {
      title: 'Primary evaluates leadership confirmation',
      explain: `The primary checks whether a majority of nodes responded to its leadership check. ` +
        `If yes, the read proceeds with the freshest majority-confirmed data. ` +
        `If not, <strong>the read blocks</strong> until it times out (maxTimeMS). ` +
        `This is a safety measure: answering without confirmed leadership could mean returning stale data.`,
    },

    linearizableReturn: {
      title: 'Data returned to client',
      explain: `With <strong>rc:linearizable</strong>, the primary returns data reflecting every majority-confirmed write up to this moment \u2014 ` +
        `the strongest read guarantee in MongoDB. Combined with <strong>w:majority</strong> writes, reads and writes behave as if executed by a single thread.`,
    },

    linearizableBlocked: {
      title: 'Read blocked \u2014 leadership not confirmed',
      explain: `The primary could not reach a majority of nodes to confirm it is still the leader. ` +
        `Rather than risk returning stale data, <strong>rc:linearizable blocks</strong> until <strong>maxTimeMS</strong> expires. ` +
        `This is the safety trade-off: linearizable reads choose correctness over availability.`,
    },

    snapshotRead(snapLabel, isSession, targetKey, primaryKey) {
      const sessionNote = isSession
        ? `The <strong>snapshot session</strong> is locked at <strong>${snapLabel}</strong>. Even if new writes are confirmed while this read runs, the session always returns the same point-in-time view.`
        : `<strong>rc:snapshot</strong> captures a <strong>frozen point-in-time view</strong> of majority-confirmed data: <strong>${snapLabel}</strong>. Unlike rc:majority which reads from a moving target, snapshot provides an atomic view at a fixed moment.`;
      return {
        title: `Node prepares point-in-time snapshot \u2192 ${snapLabel}`,
        explain: sessionNote +
          ` All reads in this transaction see the exact same data \u2014 no phantom reads, no changing results.` +
          (targetKey !== primaryKey ? ` <em>Note: on a secondary, the snapshot may lag slightly behind the primary due to replication delay.</em>` : ''),
      };
    },

    dataReturn(vLabel, isDirty, served, rc, latestId, mcId, snapshotOverrideId) {
      let explain;
      if (latestId === 0) {
        explain = `No writes have been issued yet \u2014 the document does not exist. The read returns <strong>nothing</strong>. Try issuing a write first.`;
      } else if (isDirty) {
        explain = `The node sends <strong>${vLabel}</strong>, which is ahead of the majority-confirmed point (v${mcId}). ` +
          `With <strong>rc:${rc}</strong>, this data <strong>may include unconfirmed writes</strong>. If the primary fails before these writes reach enough nodes, they disappear \u2014 but your client already saw them.`;
      } else if (rc === 'snapshot' && snapshotOverrideId !== null) {
        explain = `Result: <strong>${vLabel} \u2713</strong>. The snapshot session is locked at <strong>v${snapshotOverrideId > 0 ? snapshotOverrideId : 'none'}</strong>, so any newer writes are intentionally hidden until the session ends.`;
      } else if (served.id === 0) {
        explain = `No write has been confirmed by a majority yet. rc:${rc} returns <strong>nothing</strong>. The latest write (v${latestId}) is on the primary but hasn\u2019t been confirmed by enough nodes.`;
      } else {
        explain = `Result: <strong>${vLabel} \u2713</strong>. With <strong>rc:${rc}</strong>, this data is <strong>guaranteed safe from rollback</strong> \u2014 confirmed by a majority of nodes.`;
      }
      return {
        title: `Data returned \u2192 ${vLabel}${isDirty ? ' \u26A0' : served.id > 0 ? ' \u2713' : ''}`,
        explain,
      };
    },
  },

  // ─── Election step texts ─────────────────────────────────────────────
  election: {
    impossible(reason) {
      return {
        title: 'Election impossible \u2014 no majority',
        explain: `${reason} RAFT requires a <strong>majority of voting members</strong> to agree on a new primary. Bring more nodes online first.`,
      };
    },

    campaign(winnerLabel, winnerVersion) {
      return {
        title: `Election triggered \u2014 ${winnerLabel} campaigns`,
        explain: `Secondaries detect the primary is unreachable and start an election after <strong>electionTimeoutMillis</strong> (default 10s). ` +
          `<em>MongoDB uses <strong>RAFT consensus</strong>: each secondary requests votes based on how up-to-date its data is. ` +
          `Peers only vote for a candidate whose data is at least as fresh as theirs, and each node votes once per term. ` +
          `The candidate that collects a majority wins.</em> ` +
          `<strong>${winnerLabel}</strong> has the most recent data (v${winnerVersion}) and qualifies as the new primary.`,
      };
    },

    elected(winnerLabel, rollbackNote, mcId) {
      return {
        title: `${winnerLabel} elected \u2014 new Primary`,
        explain: `Election complete. <strong>${winnerLabel}</strong> collected a majority of votes and is now the primary.${rollbackNote} ` +
          `All majority-confirmed data (v${mcId || 'none'}) is intact on surviving nodes.`,
      };
    },

    rollbackNote(uncommitted) {
      if (uncommitted.length === 0) return ` No unconfirmed writes \u2014 all data is safe.`;
      return ` <strong>Unconfirmed write(s) ${uncommitted.map(v => `v${v.id}`).join(', ')} are rolled back</strong> \u2014 ` +
        `they were never confirmed by a majority, so the new primary discards them. Any client that read these values via rc:local now holds stale data.`;
    },
  },

  // ─── Consistency view texts (draw.js) ────────────────────────────────
  consistency: {
    noWrites: '<div class="cb-dim">No writes issued</div>',

    noPrimary: `<div class="cb-label">Cluster status</div>` +
      `<div class="cb-status cb-warn">\u26A0 No primary \u2014 read-only</div>` +
      `<div class="cb-detail">Writes are blocked. Use \u201CTrigger Election\u201D to promote a surviving secondary.</div>`,

    writeFailed(vid, wVal, isDefault, safetyNote) {
      return `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-error">\u26A0 Write concern failed</div>` +
        `<div class="cb-detail">The write didn\u2019t get enough confirmations for w:${wVal}. The data exists on the primary but hasn\u2019t been replicated \u2014 if the primary fails, it could be lost.</div>` +
        (!isDefault ? safetyNote : '');
    },

    ackButLost(vid, wVal) {
      return `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-error">\u26A0 Acknowledged but LOST</div>` +
        `<div class="cb-detail"><strong>What happened:</strong> The client was told v${vid} succeeded (w:${wVal}), but the only node holding the data failed before it could be copied elsewhere. The data is now permanently lost.</div>` +
        `<div class="cb-default-note">\u2139 <strong>How to prevent:</strong> Use <strong>w:majority</strong> (MongoDB\u2019s default since v5.0). ` +
        `The client only gets confirmation after 2+ nodes save the write to disk \u2014 this scenario becomes impossible.</div>`;
    },

    committed(vid, ackCount) {
      return `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-ok">\u25C9 Majority-confirmed</div>` +
        `<div class="cb-detail">This write is safe. Confirmed by ${ackCount} node(s) and will survive any single node failure. No risk of data loss.</div>`;
    },

    fireForget(vid, safetyNote) {
      return `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-warn">\u25CE Fire-and-forget</div>` +
        `<div class="cb-detail">The client sent the write but asked for no confirmation (w:0). It has no way to know if the write succeeded, failed, or was lost.</div>` +
        safetyNote;
    },

    inFlight(vid, ackCount, isDefault, safetyNote) {
      return `<div class="cb-label">Write v${vid}</div>` +
        `<div class="cb-status cb-warn">\u25CE In-flight \u2014 ${ackCount}/2 majority</div>` +
        `<div class="cb-detail">The write is in progress but hasn\u2019t been confirmed by enough nodes yet. If the primary fails now, this data could be lost.</div>` +
        (!isDefault ? safetyNote : '');
    },

    // ── Read consistency views ─────────────────────
    noReads: '<div class="cb-dim">No reads completed</div>',

    reading(rcVal, sessionSuffix) {
      return `<div class="cb-label">Reading\u2026</div>` +
        `<div class="cb-status" style="color:var(--blue)">rc:${rcVal}</div>` +
        `<div class="cb-detail">Request in progress.${sessionSuffix}</div>`;
    },

    readFailed(sessionSuffix) {
      return `<div class="cb-label">Read failed</div>` +
        `<div class="cb-status cb-error">\u26A0 No eligible node</div>` +
        `<div class="cb-detail">The target node is unavailable. Read cannot be served.${sessionSuffix}</div>`;
    },

    readLinearizableBlocked(sessionSuffix) {
      return `<div class="cb-label">Read blocked</div>` +
        `<div class="cb-status cb-error">\u26A0 Leadership not confirmed</div>` +
        `<div class="cb-detail">rc:linearizable requires the primary to prove leadership with a majority. Under partition it can\u2019t \u2014 the read blocks until maxTimeMS expires.${sessionSuffix}</div>`;
    },

    readNone(rcVal, reason, sessionSuffix) {
      return `<div class="cb-label">Read result: none</div>` +
        `<div class="cb-status cb-dim">No data returned</div>` +
        `<div class="cb-detail">rc:${rcVal} \u2014 ${reason}${sessionSuffix}</div>`;
    },

    dirtyRead(vStr, rcVal, mcId, sessionSuffix) {
      return `<div class="cb-label">Read result: ${vStr}</div>` +
        `<div class="cb-status cb-warn">\u25CE Dirty read \u2014 unconfirmed</div>` +
        `<div class="cb-detail">rc:${rcVal} returned data above the majority-confirmed point (v${mcId || 'none'}). If the primary fails, this write could be rolled back and your client already saw it.${sessionSuffix}</div>`;
    },

    safeRead(vStr, rcVal, sessionSuffix) {
      return `<div class="cb-label">Read result: ${vStr}</div>` +
        `<div class="cb-status cb-ok">\u25C9 Safe \u2014 majority-confirmed</div>` +
        `<div class="cb-detail">rc:${rcVal} guarantees this data will not be rolled back.${sessionSuffix}</div>`;
    },
  },

  // ─── Canvas hover tooltips (native title attribute) ───────────────
  canvasTips: {
    node(label, alive) {
      return alive
        ? `${label}\nClick to shut down this node (simulates crash — memory lost, journal preserved).`
        : `${label} (down)\nClick to restart (recovers from journal).`;
    },
    link(labelA, labelB, linked) {
      return linked
        ? `${labelA} \u2194 ${labelB}: connected\nClick to partition this link (both nodes stay alive but cannot communicate).`
        : `${labelA} \u2194 ${labelB}: partitioned\nClick to restore the connection.`;
    },
    linkSecSec(labelA, labelB, linked) {
      return linked
        ? `${labelA} \u2194 ${labelB}: heartbeat only\nMongoDB supports chained replication (secondaries can sync from other secondaries), but this simulator excludes it for clarity. A secondary is only considered reachable if it has a direct link to the current primary.\nClick to partition.`
        : `${labelA} \u2194 ${labelB}: partitioned\nClick to restore.`;
    },
    clientWrite(targetLabel) {
      return `Write Client\nClick to cycle target node: ${targetLabel}\nDrag to reposition.`;
    },
    clientRead(targetLabel) {
      return `Read Client\nClick to cycle target node: ${targetLabel}\nDrag to reposition.`;
    },
    clientLink(type, linked) {
      const name = type === 'wp' ? 'Writer \u2192 Node' : 'Reader \u2192 Node';
      return linked
        ? `${name}: connected\nClick to disconnect (simulates network interruption).`
        : `${name}: disconnected\nClick to reconnect.`;
    },
    lockBanner: `Topology locked during operation\n\nAllowing topology changes mid-operation would require tracking every possible state combination: primary alive/dead, secondaries in various replication stages, journal states, partition states — and their interactions. This grows exponentially and produces confusing, hard-to-explain results.\n\nInstead, configure your topology first, then run the operation to observe a clean, well-defined outcome. Chain multiple operations to explore failure scenarios step by step.`,
  },

  // ─── Suggested scenarios ─────────────────────────────────────────────
  // Grouped: defaults-under-stress first (the heroes), then opt-in risk.
  scenarios: [
    { group: 'Defaults under pressure', subtitle: 'w:majority + rc:majority \u2014 see how the defaults protect your data' },
    {
      id: 'safe-write',
      name: 'Safe write \u2192 crash \u2192 recovery',
      what: 'Write with defaults, crash the primary, trigger an election. The new primary still has your data because a majority confirmed it before the crash.',
      next: 'Write \u2192 Finish \u2192 kill Primary \u2192 Trigger Election \u2192 read from new primary.',
      setup: { w: 'majority', j: 'false', rc: 'majority', readPref: 'primary' },
    },
    {
      id: 'partition-safe',
      name: 'Network partition \u2192 write blocked, data safe',
      what: 'The primary is cut off from both secondaries. It refuses to confirm the write because it can\u2019t reach a majority \u2014 choosing consistency over availability (CP). No data is lost or inconsistent.',
      next: 'Partition is pre-set. Write \u2192 Finish (write concern error) \u2192 no split-brain.',
      setup: { w: 'majority', j: 'false', rc: 'majority', readPref: 'primary', links: { ps1: false, ps2: false } },
    },
    {
      id: 'snapshot-isolation',
      name: 'Snapshot isolation across writes',
      what: 'Pin a session to a point in time. No matter what writes happen after, every read in this session returns the exact same data \u2014 no surprises, no phantom changes.',
      next: 'Start session \u2192 Write \u2192 Finish \u2192 Read again \u2192 same result.',
      setup: { w: 'majority', j: 'false', rc: 'snapshot', readPref: 'primary' },
    },
    {
      id: 'linearizable',
      name: 'Strongest read guarantee',
      what: 'rc:linearizable makes the primary prove it\u2019s still the leader before answering. Under partition it can\u2019t, so the read blocks \u2014 it will never return stale data.',
      next: 'Partition is pre-set. Issue a linearizable read and observe the block.',
      setup: { w: 'majority', j: 'false', rc: 'linearizable', readPref: 'primary', links: { ps1: false, ps2: false } },
    },

    { group: 'Lowering the guardrails', subtitle: 'What happens when you trade safety for speed or availability' },
    {
      id: 'w1-data-loss',
      name: 'w:1 \u2192 data loss after crash',
      what: 'The client hears "write succeeded," but the data only lives on one node. When that node crashes before replicating, the write is gone forever.',
      next: 'Write \u2192 Finish \u2192 kill Primary \u2192 Trigger Election \u2192 read from new primary.',
      setup: { w: '1', j: 'false', rc: 'majority', readPref: 'primary' },
    },
    {
      id: 'dirty-read',
      name: 'rc:local \u2192 dirty read from secondary',
      what: 'A secondary returns data that hasn\u2019t been confirmed by a majority. If the primary fails, that data could be rolled back \u2014 but your app already saw it.',
      next: 'Write w:1 \u2192 Finish \u2192 Read rc:local from secondary.',
      setup: { w: '1', j: 'false', rc: 'local', readPref: 'secondary' },
    },
    {
      id: 'split-brain',
      name: 'w:1 \u2192 split-brain under partition',
      what: 'The old primary is isolated but with w:1 it still accepts writes \u2014 choosing availability over consistency (PA). After election, a new primary emerges and these writes are rolled back.',
      next: 'Partition is pre-set. Force Election \u2192 write to old primary (change write client target).',
      setup: { w: '1', j: 'false', rc: 'majority', readPref: 'primary', links: { ps1: false, ps2: false } },
    },
    {
      id: 'fire-forget',
      name: 'w:0 \u2192 fire-and-forget',
      what: 'Send the write and move on \u2014 no confirmation, no waiting. You\u2019ll never know if it succeeded. Maximum speed, zero durability guarantees.',
      next: 'Click write \u2014 no ACK step, client returns to idle instantly.',
      setup: { w: '0', j: 'false', rc: 'local', readPref: 'primary' },
    },
  ],
};
