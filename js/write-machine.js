// ═══════════════════════════════════════
// WRITE STATE MACHINE (lazy step generator)
// ═══════════════════════════════════════
// The machine evaluates the topology at each step to decide the next action.
// Topology is locked during execution (UI blocks node/link clicks while any
// engine is active), so the machine can assume stable topology throughout.
//
// All helpers and phase handlers are module-level functions that take a
// context object (ctx). createWriteMachine() is a thin factory that builds
// the ctx and returns the public API.

// ── Pure setup helpers ──

function normalizeWriteConcern(wOrig, journalRequired) {
  let w = wOrig;
  if (w === 0 && journalRequired) {
    log('w:0 + j:true → MongoDB demotes to w:1 (primary must ack after journal flush).', 'warn');
    w = 1;
  }
  return {
    w,
    ackNeedsJournal: journalRequired || w === 'majority',
    needCount:       w === 'majority' ? 2 : w === 0 ? 0 : w,
    secsNeeded:      w === 'majority' ? 1 : (typeof w === 'number' && w > 1) ? w - 1 : 0,
  };
}

function buildWriteOp(doc, w) {
  const nextId  = doc.latestId + 1;
  const op      = doc.latestId === 0 ? 'insert' : 'update';
  return { nextId, op, opLabel: `${op} _id:1 → v${nextId}`, isDefault: w === 'majority', defaultNote: TEXTS.defaultNote };
}

function buildTopoSnapshot() {
  return {
    reachable: Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length,
    total:     Object.keys(state.nodes).length,
    primaryPartitioned: isPrimaryPartitioned(),
    allHealthy: Object.values(state.nodes).every(n => n.alive) &&
                Object.entries(state.links).every(([k, v]) => k === 'wp' || k === 'rp' || v),
  };
}

// ── Context helpers ──

function wmEmit(ctx, step) { ctx.history.push(step); return step; }

function wmFailWrite(ctx, title, explain) {
  ctx.phase = 'done';
  return wmEmit(ctx, {
    title, explain,
    run: async () => {
      const idx = state.doc.versions.findIndex(v => v.id === ctx.nextId);
      if (idx >= 0) state.doc.versions.splice(idx, 1);
      if (state.doc.latestId >= ctx.nextId) state.doc.latestId = ctx.nextId - 1;
      state.writeClient.phase = 'error';
      log(title, 'err');
      draw();
    },
  });
}

function wmAckCount(ctx) {
  const entry = state.doc.versions.find(v => v.id === ctx.nextId);
  return entry ? entry.ackedBy.size : 0;
}

function wmIsWcSatisfied(ctx) { return wmAckCount(ctx) >= ctx.needCount; }

function wmEligibleSecs(ctx) {
  const wt = effectiveWriteTarget();
  return Object.keys(state.nodes).filter(k =>
    k !== wt && state.nodes[k].alive && isReachableForWrite(k) &&
    !ctx.replicated.has(k) && !ctx.memApplied.has(k) && k !== ctx.pendingJournal
  );
}

function wmPickNextSec(ctx) { return wmEligibleSecs(ctx)[0] || null; }

function wmMakeMemStep(ctx, k) {
  const label = state.nodes[k].label;
  const txt = TEXTS.write.secondaryMem(label, ctx.opLabel, ctx.acked, ctx.ackNeedsJournal, ctx.journalRequired);
  return {
    title: txt.title, serverSide: true, explain: txt.explain,
    run: async () => {
      await awaitParticle(state.nodes[effectiveWriteTarget()], state.nodes[k], THEME.flowRepl, 'v' + ctx.nextId, () => {
        state.nodes[k].memoryVersion = ctx.nextId;
        if (!ctx.ackNeedsJournal) {
          const entry = state.doc.versions.find(v => v.id === ctx.nextId);
          if (entry) { entry.ackedBy.add(k); }
          advanceMajorityCommit();
        }
        state.nodes[k].phase = 'active';
        log(`${label}: v${ctx.nextId} in memory.`, 'info');
      });
      draw();
    },
  };
}

function wmMakeJournalStep(ctx, k) {
  const label = state.nodes[k].label;
  const txt = TEXTS.write.secondaryJournal(label, ctx.nextId, ctx.acked, ctx.ackNeedsJournal, ctx.w);
  return {
    title: txt.title, serverSide: true, explain: txt.explain,
    run: async () => {
      journalFlush(k);
      if (ctx.ackNeedsJournal) {
        const entry = state.doc.versions.find(v => v.id === ctx.nextId);
        if (entry) { entry.ackedBy.add(k); }
        advanceMajorityCommit();
      }
      state.nodes[k].phase = 'acked';
      log(`${label}: journal flushed - v${ctx.nextId} crash-safe.`, 'ok');
      draw();
    },
  };
}

// ── Phase handlers ──

function wmHandleSendPhase(ctx) {
  if (!state.links.wp) {
    const txt = TEXTS.write.writerDisconnected;
    return wmFailWrite(ctx, txt.title, txt.explain);
  }
  if (effectiveWriteTarget() !== state.primaryKey) {
    const targetLabel = state.nodes[effectiveWriteTarget()].label;
    return wmFailWrite(ctx,
      `Not primary - ${targetLabel} cannot accept writes`,
      `<strong>MongoDB error: NotWritablePrimary.</strong> The write client is targeting <em>${targetLabel}</em>, ` +
      `which is a secondary. Only the primary can accept write operations. ` +
      `The driver would normally discover the primary automatically, but in this simulation the target was set manually.`
    );
  }
  if (!state.nodes[effectiveWriteTarget()].alive) {
    return wmFailWrite(ctx,
      `Target node is down - cannot deliver write`,
      `The write client is targeting <em>${state.nodes[effectiveWriteTarget()].label}</em>, which is currently down. ` +
      `No write can be delivered.`
    );
  }
  ctx.phase = 'primaryMem';
  const txt = TEXTS.write.clientSend(ctx.opLabel, ctx.w, ctx.journalRequired);
  return wmEmit(ctx, {
    title: txt.title, explain: txt.explain,
    run: () => {
      const entry = { id: ctx.nextId, op: ctx.op, ackedBy: new Set() };
      state.doc.versions.push(entry);
      state.doc.latestId = ctx.nextId;
      state.writeClient.lastWrittenVersion = ctx.nextId;
      return awaitParticle(state.writeClient, state.nodes[effectiveWriteTarget()], THEME.flowWrite, ctx.op === 'insert' ? 'INS' : 'UPD', () => {
        state.nodes[effectiveWriteTarget()].phase = 'active';
        state.writeClient.phase = 'waiting';
        log(`Write received by primary (${ctx.opLabel}).`, 'info');
      });
    },
  });
}

function wmHandlePrimaryMemPhase(ctx) {
  ctx.phase = 'primaryJournal';
  const txt = TEXTS.write.primaryMem(ctx.opLabel, ctx.ackNeedsJournal, ctx.journalRequired);
  return wmEmit(ctx, {
    title: txt.title, serverSide: true, explain: txt.explain,
    run: async () => {
      const wt = effectiveWriteTarget();
      state.nodes[wt].memoryVersion = ctx.nextId;
      if (!ctx.ackNeedsJournal) {
        const entry = state.doc.versions.find(v => v.id === ctx.nextId);
        if (entry) { entry.ackedBy.add(wt); }
        advanceMajorityCommit();
      }
      state.nodes[wt].phase = 'active';
      log(`Primary: v${ctx.nextId} applied in memory.`, 'info');
      draw();
    },
  });
}

function wmHandlePrimaryJournalPhase(ctx) {
  ctx.phase = ctx.w === 0 ? 'fireForget' : 'repl';
  const txt = TEXTS.write.primaryJournal(ctx.opLabel, ctx.ackNeedsJournal, ctx.journalRequired);
  return wmEmit(ctx, {
    title: txt.title, serverSide: true, explain: txt.explain,
    run: async () => {
      const wt = effectiveWriteTarget();
      journalFlush(wt);
      if (ctx.ackNeedsJournal) {
        const entry = state.doc.versions.find(v => v.id === ctx.nextId);
        if (entry) { entry.ackedBy.add(wt); }
        advanceMajorityCommit();
      }
      state.nodes[wt].phase = ctx.w === 0 ? 'acked' : 'active';
      log(`Primary: journal flushed - v${ctx.nextId} crash-safe.`, 'ok');
      draw();
    },
  });
}

function wmHandleFireForgetPhase(ctx) {
  ctx.phase = 'done';
  const secs = wmEligibleSecs(ctx);
  const txt = TEXTS.write.fireForget(ctx.opLabel, ctx.topoNote);
  return wmEmit(ctx, {
    title: txt.title, explain: txt.explain,
    run: async () => {
      secs.forEach((k, i) => setTimeout(() =>
        awaitParticle(state.nodes[effectiveWriteTarget()], state.nodes[k], THEME.flowRepl, 'v' + ctx.nextId, () => {
          state.nodes[k].memoryVersion = ctx.nextId;
          const entry = state.doc.versions.find(v => v.id === ctx.nextId);
          if (entry) { entry.ackedBy.add(k); advanceMajorityCommit(); }
          state.nodes[k].phase = 'acked';
          setTimeout(() => { journalFlush(k); draw(); }, PAUSE_JOURNAL_MS);
        }),
      i * PAUSE_STAGGER_MS));
      startAnimLoop();
      log(`w:0 - no ACK. ${ctx.opLabel} async replication proceeds.`, 'warn');
      state.writeClient.phase = 'idle';
      draw();
    },
  });
}

// ── Replication sub-phase handlers ──

function wmTryJournalAfterMem(ctx) {
  if (ctx.ackNeedsJournal || ctx.memApplied.size === 0) return null;
  const secKey = [...ctx.memApplied][0];
  ctx.memApplied.delete(secKey);
  ctx.replicated.add(secKey);
  return wmEmit(ctx, wmMakeJournalStep(ctx, secKey));
}

function wmTryPendingJournal(ctx) {
  if (!ctx.pendingJournal) return null;
  const secKey = ctx.pendingJournal;
  ctx.pendingJournal = null;
  ctx.memApplied.delete(secKey);
  ctx.replicated.add(secKey);
  return wmEmit(ctx, wmMakeJournalStep(ctx, secKey));
}

function wmTryAckStep(ctx) {
  if (ctx.acked || !wmIsWcSatisfied(ctx)) return null;
  ctx.acked = true;
  const txt = TEXTS.write.ack(ctx.opLabel, ctx.w, ctx.journalRequired, ctx.nextId, ctx.ackNeedsJournal, ctx.needCount, ctx.isDefault, ctx.defaultNote, ctx.topoNote);
  return wmEmit(ctx, {
    title: txt.title, explain: txt.explain,
    run: async () => {
      state.nodes[effectiveWriteTarget()].phase = 'acked';
      await awaitParticle(state.nodes[effectiveWriteTarget()], state.writeClient, THEME.flowAck, 'ACK', () => {
        state.writeClient.phase = 'received';
      });
      log(`ACK - w:${ctx.w}${ctx.journalRequired ? ', j:true' : ''} satisfied. ${ctx.opLabel} done.`, 'ok');
    },
  });
}

function wmTryNextSecondaryMem(ctx) {
  const nextSec = wmPickNextSec(ctx);
  if (!nextSec) return null;
  ctx.memApplied.add(nextSec);
  if (ctx.ackNeedsJournal) ctx.pendingJournal = nextSec;
  return wmEmit(ctx, wmMakeMemStep(ctx, nextSec));
}

function wmTryWcFailure(ctx) {
  if (ctx.acked || wmIsWcSatisfied(ctx)) return null;
  const reachCount = Object.keys(state.nodes).filter(k => isReachableForWrite(k)).length;
  ctx.phase = 'done';
  const txt = TEXTS.write.wcUnsatisfied(ctx.opLabel, ctx.w, ctx.needCount, reachCount);
  return wmEmit(ctx, {
    title: txt.title, explain: txt.explain,
    run: async () => {
      await delay(PAUSE_LONG_MS);
      const wt = effectiveWriteTarget();
      if (state.nodes[wt].alive) state.nodes[wt].phase = 'error';
      state.writeClient.phase = 'error';
      if (state.nodes[wt].alive) {
        await awaitParticle(state.nodes[wt], state.writeClient, THEME.flowErr, 'ERR', () => {});
      }
      log(`Write concern error - w:${ctx.w} unachievable. ${ctx.opLabel} sits on primary.`, 'err');
    },
  });
}

function wmReplCompleteStep(ctx) {
  ctx.phase = 'done';
  const txt = TEXTS.write.replComplete(ctx.nextId, ctx.topoNote);
  return wmEmit(ctx, {
    title: txt.title, serverSide: true, explain: txt.explain,
    run: async () => {
      Object.values(state.nodes).forEach(n => { if (n.alive) n.phase = 'idle'; });
      draw();
    },
  });
}

function wmHandleReplPhase(ctx) {
  return wmTryJournalAfterMem(ctx)
      || wmTryPendingJournal(ctx)
      || wmTryAckStep(ctx)
      || wmTryNextSecondaryMem(ctx)
      || wmTryWcFailure(ctx)
      || wmReplCompleteStep(ctx);
}

// ── Phase dispatch table ──

const wmPhaseHandlers = {
  send:           wmHandleSendPhase,
  primaryMem:     wmHandlePrimaryMemPhase,
  primaryJournal: wmHandlePrimaryJournalPhase,
  fireForget:     wmHandleFireForgetPhase,
  repl:           wmHandleReplPhase,
};

// ── Factory ──

function createWriteMachine(wOrig, journalRequired) {
  const wc   = normalizeWriteConcern(wOrig, journalRequired);
  const op   = buildWriteOp(state.doc, wc.w);
  const topo = buildTopoSnapshot();

  const ctx = {
    w: wc.w, ackNeedsJournal: wc.ackNeedsJournal, needCount: wc.needCount, secsNeeded: wc.secsNeeded,
    nextId: op.nextId, op: op.op, opLabel: op.opLabel, isDefault: op.isDefault, defaultNote: op.defaultNote,
    topoNote: topo.allHealthy ? '' : TEXTS.topoNote(topo),
    journalRequired,
    phase: 'send', replicated: new Set(), memApplied: new Set(),
    pendingJournal: null, acked: false, history: [],
    secKeys: Object.keys(state.nodes).filter(k => k !== effectiveWriteTarget()),
    totalSecs: Object.keys(state.nodes).filter(k => k !== effectiveWriteTarget()).length,
  };

  return {
    history: ctx.history,
    get isDone() { return ctx.phase === 'done'; },
    getProgress() {
      return { phase: ctx.phase, acked: ctx.acked, replicated: ctx.replicated.size,
               memApplied: ctx.memApplied.size, secsNeeded: ctx.secsNeeded,
               totalSecs: ctx.totalSecs, w: ctx.w,
               errored: ctx.phase === 'done' && !ctx.acked && ctx.history.length > 0 };
    },
    nextStep() {
      if (ctx.phase === 'done') return null;
      const handler = wmPhaseHandlers[ctx.phase];
      return handler ? handler(ctx) : null;
    },
  };
}
