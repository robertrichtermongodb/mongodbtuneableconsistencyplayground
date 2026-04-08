// ═══════════════════════════════════════
// ANIMATION
// ═══════════════════════════════════════
let skipAnimations = false;
function setSkipAnimations(v) { skipAnimations = v; }

function awaitParticle(from, to, color, label, onArrive) {
  if (skipAnimations) {
    if (onArrive) onArrive();
    return Promise.resolve();
  }
  return new Promise(resolve => {
    state.particles.push({
      sx: from.x, sy: from.y, tx: to.x, ty: to.y,
      x: from.x,  y: from.y, progress: 0, color, label,
      onArrive: () => { if (onArrive) onArrive(); resolve(); },
    });
    startAnimLoop();
  });
}

function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

let animRunning = false, lastT = null;
function startAnimLoop() {
  if (animRunning) return;
  animRunning = true; lastT = null;
  requestAnimationFrame(function loop(ts) {
    if (!lastT) lastT = ts;
    const dt = Math.min(ts - lastT, 50); lastT = ts;
    state.particles.forEach(p => {
      p.progress = Math.min(1, p.progress + dt / PARTICLE_MS);
      p.x = p.sx + (p.tx - p.sx) * ease(p.progress);
      p.y = p.sy + (p.ty - p.sy) * ease(p.progress);
    });
    state.particles.filter(p => p.progress >= 1 && p.onArrive).forEach(p => { p.onArrive(); p.onArrive = null; });
    state.particles = state.particles.filter(p => p.progress < 1);
    draw();
    if (state.particles.length > 0) requestAnimationFrame(loop);
    else { animRunning = false; draw(); }
  });
}

// ═══════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════
let clientDragged = { write: false, read: false };

function computeLayout(W, H) {
  const cx = W / 2;
  const topY    = 60;
  const priY    = 205;
  const secY    = 330;
  const spread  = Math.min(220, W * 0.26);

  if (!clientDragged.write) { state.writeClient.x = cx - spread; state.writeClient.y = topY; }
  if (!clientDragged.read)  { state.readClient.x  = cx + spread; state.readClient.y  = topY; }

  state.nodes.primary.x = cx;          state.nodes.primary.y = priY;
  state.nodes.s1.x      = cx - spread; state.nodes.s1.y      = secY;
  state.nodes.s2.x      = cx + spread; state.nodes.s2.y      = secY;
}

function resetClientDrag() { clientDragged.write = false; clientDragged.read = false; }

// ═══════════════════════════════════════
// CANVAS SETUP
// ═══════════════════════════════════════
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const NR = 52, CR = 34;

let canvasW = 0, canvasH = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvasW = rect.width;
  canvasH = rect.height;
  canvas.width  = canvasW * dpr;
  canvas.height = canvasH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeLayout(canvasW, canvasH);
  draw();
}

// ── Phase color lookups (read from T at draw-time) ──

function phaseFill(phase) {
  return ({
    idle: T.phaseIdle, active: T.greenActiveBg, acked: T.greenDarkBg,
    error: T.redDarkBg, reading: T.blueActiveBg, serving: T.blueActiveMid,
    waiting: T.phaseWaiting, received: T.greenDarkBg,
    candidate: T.purpleCandBg, recovering: T.phaseRecovBg,
  })[phase] || T.phaseIdle;
}

function phaseStroke(phase) {
  return ({
    active: T.green, acked: T.green, error: T.red,
    reading: T.blue, serving: T.green,
    candidate: T.purple, recovering: T.flowRepl,
  })[phase] || null;
}

// ═══════════════════════════════════════
// CANVAS HIT TESTING
// ═══════════════════════════════════════

let hoverTarget = null;
function setHoverTarget(val) { hoverTarget = val; }
function getHoverTarget()    { return hoverTarget; }

function pointToSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitTest(mx, my) {
  // Lock banner (checked first — sits at the bottom of the canvas)
  if (_lockBannerBounds) {
    const b = _lockBannerBounds;
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h)
      return { type: 'lockBanner' };
  }
  // Client circles (checked first — they sit above everything visually)
  const wc = state.writeClient, rc = state.readClient;
  if (Math.hypot(mx - wc.x, my - wc.y) <= CR + 5) return { type: 'client', key: 'write' };
  if (Math.hypot(mx - rc.x, my - rc.y) <= CR + 5) return { type: 'client', key: 'read' };

  for (const [key, node] of Object.entries(state.nodes)) {
    if (Math.hypot(mx - node.x, my - node.y) <= NR + 5) return { type: 'node', key };
  }
  const nodeKeys = Object.keys(state.nodes);
  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      const aKey = nodeKeys[i], bKey = nodeKeys[j];
      const a = state.nodes[aKey], b = state.nodes[bKey];
      const lk = getLinkBetween(aKey, bKey);
      if (!lk) continue;
      const dist = pointToSegDist(mx, my, a.x, a.y, b.x, b.y);
      if (dist < 14 && Math.hypot(mx - a.x, my - a.y) > NR + 8 && Math.hypot(mx - b.x, my - b.y) > NR + 8)
        return { type: 'link', key: lk };
    }
  }
  const wt = effectiveWriteTarget();
  const wp = state.nodes[wt];
  const wDist = pointToSegDist(mx, my, wc.x, wc.y + CR, wp.x, wp.y - NR);
  if (wDist < 14 && Math.hypot(mx - wc.x, my - wc.y) > CR + 5 && Math.hypot(mx - wp.x, my - wp.y) > NR + 5)
    return { type: 'clientLink', key: 'wp' };
  const tKey = resolveReadTarget(
    document.getElementById('sel-rc')?.value || 'majority',
    document.getElementById('sel-readpref')?.value || 'primary'
  );
  if (tKey) {
    const t = state.nodes[tKey];
    const rDist = pointToSegDist(mx, my, rc.x, rc.y + CR, t.x, t.y - NR);
    if (rDist < 14 && Math.hypot(mx - rc.x, my - rc.y) > CR + 5 && Math.hypot(mx - t.x, my - t.y) > NR + 5)
      return { type: 'clientLink', key: 'rp' };
  }
  return null;
}

// ═══════════════════════════════════════
// DRAW
// ═══════════════════════════════════════
function draw() {
  const W = canvasW, H = canvasH;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = T.canvasBg; ctx.fillRect(0, 0, W, H);

  const selW  = document.getElementById('sel-w').value;
  const selRC = document.getElementById('sel-rc').value;
  const selRP = document.getElementById('sel-readpref').value;

  drawRSBox();
  drawReplicationLinks();
  drawWriteClientLine();
  drawReadClientLine(selRC, selRP);
  // Role is computed dynamically — never stored. isNodeIsolated() does BFS
  // to check if the node can reach the primary through live links.
  Object.entries(state.nodes).forEach(([k, n]) => {
    const role = k === state.primaryKey ? 'primary' : isNodeIsolated(k) ? 'isolated' : 'secondary';
    drawNode(n, role);
  });
  drawWriteClient(selW);
  drawReadClient(selRC);
  drawDocLedger();
  drawParticles();
  updateConsistencyViews();

  const resetBtn = document.getElementById('btn-canvas-reset-ui');
  const hasCustomUI = clientDragged.write || clientDragged.read || state.writeClient.targetNode || state.readClient.targetNode;
  if (resetBtn) resetBtn.style.display = hasCustomUI ? 'block' : 'none';

  drawLockHint();
  if (typeof debugLabelsActive !== 'undefined' && debugLabelsActive) drawDebugLabels();
}

let _lockBannerBounds = null; // { x, y, w, h } — updated each draw, used by hitTest

function drawLockHint() {
  if (!isAnyEngineActive()) { _lockBannerBounds = null; return; }
  const wA = (writeEngine.idx !== -1 && !writeEngine.done && !writeEngine.aborted) || writeEngine.busy;
  const eA = (electionEngine.idx !== -1 && !electionEngine.done && !electionEngine.aborted) || electionEngine.busy;
  const rA = (readEngine.idx !== -1 && !readEngine.done && !readEngine.aborted) || readEngine.busy;
  const parts = [];
  if (wA || eA) parts.push(eA ? 'Election' : 'Write');
  if (rA) parts.push('Read');
  const prefix = parts.join(' and ');
  const text = `🔒 ${prefix} in progress - topology locked · finish or reset to reconfigure`;
  ctx.save();
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const metrics = ctx.measureText(text);
  const pw = metrics.width + 24, ph = 20;
  const px = canvasW / 2 - pw / 2, py = canvasH - 8 - ph;
  _lockBannerBounds = { x: px, y: py, w: pw, h: ph };
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = T.amberDarkBg;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = T.amber;
  ctx.fillText(text, canvasW / 2, canvasH - 8);
  ctx.restore();
}

function drawDebugLabels() {
  ctx.save();
  const font = 'bold 9px monospace';
  ctx.font = font;
  ctx.textBaseline = 'top';

  function badge(label, x, y) {
    const m = ctx.measureText(label);
    const pw = m.width + 6, ph = 13;
    ctx.fillStyle = '#ff00cc';
    ctx.globalAlpha = 0.88;
    ctx.beginPath(); ctx.roundRect(x, y, pw, ph, 3); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 3, y + 2);
  }

  Object.entries(state.nodes).forEach(([k, n]) => {
    badge('node:' + k, n.x + NR - 4, n.y - NR - 14);
  });

  const wc = state.writeClient, rc = state.readClient;
  badge('writeClient', wc.x - 20, wc.y - CR - 16);
  badge('readClient', rc.x - 20, rc.y - CR - 16);

  const linkSlots = { ps1: 0, ps2: 1, s1s2: 2 };
  Object.entries(state.links).forEach(([k, _]) => {
    if (k === 'wp' || k === 'rp') return;
    const pairMap = { ps1: ['primary', 's1'], ps2: ['primary', 's2'], s1s2: ['s1', 's2'] };
    const pair = pairMap[k];
    if (!pair) return;
    const a = state.nodes[pair[0]], b = state.nodes[pair[1]];
    if (!a || !b) return;
    badge('link:' + k, (a.x + b.x) / 2 - 10, (a.y + b.y) / 2 - 8);
  });

  badge('link:wp', (wc.x + state.nodes[state.primaryKey].x) / 2 - 10,
    (wc.y + state.nodes[state.primaryKey].y) / 2 - 8);

  const rtKey = resolveReadTarget(
    document.getElementById('sel-rc')?.value || 'majority',
    document.getElementById('sel-readpref')?.value || 'primary'
  );
  if (rtKey) {
    badge('link:rp', (rc.x + state.nodes[rtKey].x) / 2 - 10,
      (rc.y + state.nodes[rtKey].y) / 2 - 8);
  }

  badge('docLedger', canvasW / 2 - 20, 12);
  badge('rsBox', state.nodes.primary.x - NR - 30, state.nodes.primary.y - NR - 38);

  Object.entries(state.nodes).forEach(([k, n]) => {
    const bx = n.x - 40, by = n.y + NR + 12;
    badge('mem:' + k, bx, by - 14);
  });

  if (_lockBannerBounds) {
    badge('lockBanner', _lockBannerBounds.x, _lockBannerBounds.y - 14);
  }

  ctx.restore();
}

function drawDocLedger() {
  const { latestId, majorityCommitId } = state.doc;
  const cx      = canvasW / 2;
  const ledgerY = 40;

  ctx.save();
  ctx.textAlign = 'center';

  if (latestId === 0) {
    drawIconText('Doc #1  ·  no writes yet', cx, ledgerY + 4, '10px system-ui', T.textDimmer, 10);
    ctx.restore(); return;
  }

  const hasCommitted = majorityCommitId > 0;
  const hasInFlight  = latestId > majorityCommitId;
  const latestVer    = state.doc.versions.find(v => v.id === latestId);
  const latestAcks   = latestVer ? latestVer.ackedBy.size : 0;
  const isLost       = hasInFlight && latestAcks === 0 && state.writeClient.phase === 'received';
  const twoRows = hasCommitted && hasInFlight;
  const boxW = 190, boxH = twoRows ? 58 : 42;
  const bx = cx - boxW / 2, by = ledgerY - boxH / 2;

  ctx.fillStyle = T.badgeBg;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = isLost ? T.red : hasInFlight ? T.amber : T.green;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.stroke();

  drawIconText('Doc #1', cx, by + 13, 'bold 9px system-ui', T.ledgerTitle, 9);

  if (isLost && !hasCommitted) {
    drawVersionRow(cx, by + 33, `v${latestId}`,         false, 'LOST',      T.red,   'bold 13px system-ui');
  } else if (isLost && hasCommitted) {
    drawVersionRow(cx, by + 30, `v${majorityCommitId}`, true,  'committed', T.green, 'bold 11px system-ui');
    drawVersionRow(cx, by + 47, `v${latestId}`,         false, 'LOST',      T.red,   'bold 11px system-ui');
  } else if (!hasInFlight) {
    drawVersionRow(cx, by + 33, `v${latestId}`,         true,  'durable',   T.green, 'bold 13px system-ui');
  } else if (!hasCommitted) {
    drawVersionRow(cx, by + 33, `v${latestId}`,         false, 'in-flight', T.amber, 'bold 13px system-ui');
  } else {
    drawVersionRow(cx, by + 30, `v${majorityCommitId}`, true,  'committed', T.green, 'bold 11px system-ui');
    drawVersionRow(cx, by + 47, `v${latestId}`,         false, 'in-flight', T.amber, 'bold 11px system-ui');
  }

  ctx.restore();
}

function drawRSBox() {
  const pad = 38;
  const allNodes = Object.values(state.nodes);
  const xs = allNodes.map(n => n.x);
  const ys = allNodes.map(n => n.y);
  const bx  = Math.min(...xs) - NR - pad;
  const bw  = Math.max(...xs) + NR + pad - bx;
  const by  = Math.min(...ys) - NR - 24;
  const bh  = Math.max(...ys) + NR + 72 - by;
  ctx.save();
  ctx.strokeStyle = T.rsBoxBorder; ctx.lineWidth = 1.8; ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.stroke();
  ctx.setLineDash([]);
  const isz = 17;
  const lx = bx + 12, ly = by + bh + 6;
  drawIcon(ICON_RS, lx + isz/2, ly + isz/2, isz, T.rsBoxText);
  ctx.fillStyle = T.rsBoxText; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('Replica Set  \u00B7  3-node P-S-S  \u00B7  majority = 2', lx + isz + 6, ly + 13);
  ctx.restore();
}

function drawReplicationLinks() {
  const nodeKeys = Object.keys(state.nodes);
  const pairs = [];
  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      pairs.push([nodeKeys[i], nodeKeys[j]]);
    }
  }

  pairs.forEach(([aKey, bKey]) => {
    const a = state.nodes[aKey];
    const b = state.nodes[bKey];
    const lk = getLinkBetween(aKey, bKey);
    if (!lk) return;
    const linked = state.links[lk];
    const broken = !linked || !a.alive || !b.alive;
    const hoverLinkKey = lk;
    const hovered = hoverTarget && hoverTarget.type === 'link' && hoverTarget.key === hoverLinkKey;
    // Role-based, not link-key-based — correct after election when roles swap
    const isSecSec = aKey !== state.primaryKey && bKey !== state.primaryKey;
    ctx.save();
    ctx.strokeStyle = hovered ? T.linkHover : broken ? T.linkBroken : isSecSec ? T.linkSecSec : T.linkDefault;
    ctx.lineWidth = hovered ? 3 : isSecSec ? 1.2 : 2;
    ctx.setLineDash(isSecSec ? [2, 4] : [5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (!a.alive || !b.alive) {
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fillStyle = T.redDarkBg; ctx.fill();
      ctx.strokeStyle = T.red; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = T.red; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
    } else if (!linked) {
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fillStyle = T.amberDarkBg; ctx.fill();
      ctx.strokeStyle = T.amber; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = T.amber; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
    } else if (hovered) {
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
      ctx.fillStyle = T.cardBg; ctx.fill();
      ctx.strokeStyle = T.linkHoverMid; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = T.blue; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u2702', mx, my); ctx.textBaseline = 'alphabetic';
      if (isSecSec) {
        ctx.font = '9px system-ui'; ctx.fillStyle = T.textSecondary; ctx.textBaseline = 'top';
        ctx.fillText('Heartbeat only \u2014 no replication', mx, my + 14);
      }
    }
    ctx.restore();
  });
}

function drawWriteClientLine() {
  const p = state.nodes[effectiveWriteTarget()];
  const wc = state.writeClient;
  const linked = state.links.wp;
  const hovered = hoverTarget && hoverTarget.type === 'clientLink' && hoverTarget.key === 'wp';

  ctx.save();
  ctx.strokeStyle = hovered ? T.wLinkHover : !linked ? T.linkDeadMid : T.wLinkOk;
  ctx.lineWidth = hovered ? 3 : 1.8; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(wc.x, wc.y + CR); ctx.lineTo(p.x, p.y - NR);
  ctx.stroke(); ctx.setLineDash([]);

  const mx = (wc.x + p.x) / 2, my = (wc.y + CR + p.y - NR) / 2;
  if (!linked) {
    ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
    ctx.fillStyle = T.redDarkBg; ctx.fill();
    ctx.strokeStyle = T.red; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = T.red; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
  } else if (hovered) {
    ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fillStyle = T.cardBg; ctx.fill();
    ctx.strokeStyle = T.wLinkHoverMid; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = T.wLinkHoverTxt; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2702', mx, my); ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawReadClientLine(rcVal, readPref) {
  const tKey = resolveReadTarget(rcVal, readPref);
  if (!tKey) return;
  const t = state.nodes[tKey];
  const rc = state.readClient;
  const linked = state.links.rp;
  const hovered = hoverTarget && hoverTarget.type === 'clientLink' && hoverTarget.key === 'rp';

  ctx.save();
  ctx.strokeStyle = hovered ? T.rLinkHover : !linked ? T.linkDeadMid : t.alive ? T.rLinkOk : T.rLinkDead;
  ctx.lineWidth = hovered ? 3 : 1.8; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(rc.x, rc.y + CR); ctx.lineTo(t.x, t.y - NR);
  ctx.stroke(); ctx.setLineDash([]);

  const mx = (rc.x + t.x) / 2, my = (rc.y + CR + t.y - NR) / 2;
  if (!linked) {
    ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
    ctx.fillStyle = T.redDarkBg; ctx.fill();
    ctx.strokeStyle = T.red; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = T.red; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
  } else if (hovered) {
    ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fillStyle = T.cardBg; ctx.fill();
    ctx.strokeStyle = T.rLinkHoverMid; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = T.blue; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2702', mx, my); ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawNode(node, role) {
  const nodeKey = Object.keys(state.nodes).find(k => state.nodes[k] === node);
  const hovered = hoverTarget && hoverTarget.type === 'node' && hoverTarget.key === nodeKey;

  ctx.save();
  if (hovered) {
    ctx.beginPath(); ctx.arc(node.x, node.y, NR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = node.alive ? T.hoverKillHint : T.hoverRevHint;
    ctx.lineWidth = 3; ctx.stroke();
  }
  if (!node.alive) ctx.globalAlpha = 0.22;
  const isIsolated = role === 'isolated';
  const defStroke = isIsolated ? T.amber : role === 'primary' ? T.nodeStrokePri : T.nodeStrokeSec;
  const stroke    = phaseStroke(node.phase) || defStroke;
  ctx.beginPath(); ctx.arc(node.x, node.y, NR, 0, Math.PI * 2);
  ctx.fillStyle = phaseFill(node.phase); ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = node.phase !== 'idle' ? 3 : 1.8; ctx.stroke();

  const leafColor =
    !node.alive                ? T.nodeDeadLeaf :
    node.phase === 'acked'     ? T.green :
    node.phase === 'serving'   ? T.green :
    node.phase === 'active'    ? T.leafActive :
    node.phase === 'reading'   ? T.blue :
    node.phase === 'error'     ? T.red :
    node.phase === 'candidate'  ? T.purple :
    node.phase === 'recovering' ? T.flowRepl :
    isIsolated                  ? T.amber :
    role === 'primary'          ? T.leafPriIdle : T.leafSecIdle;
  drawIcon(ICON_LEAF, node.x, node.y - 10, 30, leafColor, 24);

  if (node.phase === 'candidate') {
    ctx.beginPath(); ctx.arc(node.x, node.y, NR + 7, 0, Math.PI * 2);
    ctx.strokeStyle = T.purple; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (node.phase === 'recovering') {
    ctx.beginPath(); ctx.arc(node.x, node.y, NR + 7, 0, Math.PI * 2);
    ctx.strokeStyle = T.flowRepl; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }
  if (isIsolated) {
    ctx.beginPath(); ctx.arc(node.x, node.y, NR + 7, 0, Math.PI * 2);
    ctx.strokeStyle = T.amber; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }

  ctx.fillStyle = T.nodeText; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  const displayLabel = isIsolated ? `${node.label} (isolated)` : node.label;
  ctx.fillText(displayLabel, node.x, node.y + 22);
  drawNodeDocBadge(node);
  ctx.restore();

  const hx = node.x + NR * 0.7, hy = node.y - NR * 0.7;
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2);
  ctx.fillStyle = node.alive ? T.greenDarkBg : T.redDarkBg; ctx.fill();
  ctx.strokeStyle = node.alive ? T.green : T.red; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2);
  ctx.fillStyle = node.alive ? T.green : T.red; ctx.fill();
  ctx.restore();
}

function drawNodeDocBadge(node) {
  const mem  = node.memoryVersion;
  const disk = node.journalVersion;

  function vColor(v) {
    if (v === 0) return T.textDimmer;
    return v <= state.doc.majorityCommitId ? T.green : T.amber;
  }
  function vText(v) { return v === 0 ? '\u2014' : `v${v}`; }

  const bw = 80, rowH = 18, divider = 1, br = 5;
  const bh = rowH * 2 + divider;
  const bx = node.x - bw / 2, by = node.y + NR + 12;
  const memColor  = vColor(mem);
  const diskColor = vColor(disk);
  const borderColor = mem > disk ? T.amber : memColor;

  ctx.fillStyle = T.badgeBg;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.fill();
  ctx.strokeStyle = borderColor; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.stroke();

  ctx.strokeStyle = T.badgeDivider; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bx + 4, by + rowH); ctx.lineTo(bx + bw - 4, by + rowH); ctx.stroke();

  ctx.font = '7px system-ui'; ctx.textAlign = 'left';
  ctx.fillStyle = T.textHint; ctx.fillText('MEM', bx + 5, by + 11);
  ctx.fillStyle = T.textHint; ctx.fillText('DISK', bx + 5, by + rowH + 12);

  ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right';
  ctx.fillStyle = memColor;
  ctx.fillText(vText(mem), bx + bw - 6, by + 13);

  ctx.fillStyle = diskColor;
  ctx.fillText(vText(disk), bx + bw - 6, by + rowH + 13);

  if (mem > 0 && mem > disk) {
    ctx.fillStyle = T.amberAlpha88; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('\u25BC', bx + bw / 2, by + rowH + 1);
  }
}

function drawWriteClient(wVal) {
  const c = state.writeClient;
  const stroke = c.phase === 'received' ? T.green : c.phase === 'error' ? T.red : T.amber;
  const fill   = c.phase === 'received' ? T.greenMidBg : c.phase === 'error' ? T.redDarkBg : T.clientIdleBg;
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, CR, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = T.clientText; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Write', c.x, c.y - 4); ctx.fillText('Client', c.x, c.y + 11);
  ctx.fillStyle = T.amber; ctx.font = '9px system-ui';
  ctx.fillText('w:' + wVal, c.x, c.y + CR + 14);
  let wYOff = CR + 27;
  if (c.targetNode) {
    ctx.fillStyle = T.purple; ctx.font = '9px system-ui';
    ctx.fillText('\u2192 ' + state.nodes[c.targetNode].label, c.x, c.y + wYOff);
    wYOff += 13;
  }
  if (state.writeClient.lastWrittenVersion > 0) {
    ctx.fillStyle = T.textSecondary; ctx.font = '9px system-ui';
    ctx.fillText(`wrote v${c.lastWrittenVersion}`, c.x, c.y + wYOff);
  }
  ctx.restore();
}

function drawReadClient(rcVal) {
  const c = state.readClient;
  const sessionActive = !!c.sessionActive;
  const stroke = c.phase === 'received' ? T.green : c.phase === 'error' ? T.red : T.blue;
  const fill   = c.phase === 'received' ? T.greenMidBg : c.phase === 'error' ? T.redDarkBg : T.blueDarkBg;
  ctx.save();
  if (sessionActive) {
    ctx.beginPath(); ctx.arc(c.x, c.y, CR + 6, 0, Math.PI*2);
    ctx.strokeStyle = T.amber; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath(); ctx.arc(c.x, c.y, CR, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = T.clientText; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Read', c.x, c.y - 4); ctx.fillText('Client', c.x, c.y + 11);
  ctx.fillStyle = T.blue; ctx.font = '9px system-ui';
  ctx.fillText('rc:' + rcVal, c.x, c.y + CR + 14);
  let yOff = CR + 27;
  if (c.targetNode) {
    ctx.fillStyle = T.purple; ctx.font = '9px system-ui';
    ctx.fillText('\u2192 ' + state.nodes[c.targetNode].label, c.x, c.y + yOff);
    yOff += 13;
  }
  if (sessionActive) {
    const snapLabel = c.sessionSnapshotId > 0 ? `v${c.sessionSnapshotId}` : 'none';
    ctx.fillStyle = T.amber; ctx.font = '9px system-ui';
    ctx.fillText('Session @ ' + snapLabel, c.x, c.y + yOff);
    yOff += 13;
  }
  if (c.lastReceivedVersion !== null) {
    const v = c.lastReceivedVersion;
    const vStr = v.id > 0 ? `v${v.id}` : 'none';
    const suffix = v.dirty ? ' \u26A0' : v.id > 0 ? ' \u2713' : '';
    ctx.fillStyle = v.dirty ? T.amber : v.id > 0 ? T.green : T.textSecondary;
    ctx.font = '9px system-ui';
    ctx.fillText(`got ${vStr}${suffix}`, c.x, c.y + yOff);
  }
  ctx.restore();
}

function drawDocIcon(x, y, color) { drawDocIconAt(x, y, 14, color); }

function drawDocIconAt(x, y, size, color) {
  const w = size * 0.78, h = size, fold = size * 0.28;
  const lx = x - w / 2, ly = y - h / 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly); ctx.lineTo(lx + w - fold, ly); ctx.lineTo(lx + w, ly + fold);
  ctx.lineTo(lx + w, ly + h); ctx.lineTo(lx, ly + h); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(lx + w - fold, ly); ctx.lineTo(lx + w - fold, ly + fold); ctx.lineTo(lx + w, ly + fold);
  ctx.closePath();
  ctx.fillStyle = color + '55'; ctx.fill();
  ctx.strokeStyle = T.docStroke; ctx.lineWidth = 0.5; ctx.stroke();
}

function drawIconText(text, cx, textBaselineY, font, color, iconSize) {
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const gap = 5, totalW = iconSize + gap + tw;
  const startX = cx - totalW / 2;
  drawDocIconAt(startX + iconSize / 2, textBaselineY - iconSize * 0.15, iconSize, color);
  ctx.fillStyle = color; ctx.textAlign = 'left';
  ctx.fillText(text, startX + iconSize + gap, textBaselineY);
  ctx.textAlign = 'center';
}

function drawCheckbox(cx, cy, size, done, color) {
  const r = size * 0.22, x = cx - size / 2, y = cy - size / 2;
  ctx.fillStyle = done ? color + '22' : T.badgeBg;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, r); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, r); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = done ? 2 : 1.5; ctx.lineCap = 'round';
  if (done) {
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.25, cy + size * 0.02);
    ctx.lineTo(cx - size * 0.02, cy + size * 0.25);
    ctx.lineTo(cx + size * 0.30, cy - size * 0.20);
    ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(cx - size * 0.22, cy); ctx.lineTo(cx + size * 0.22, cy); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawVersionRow(cx, baselineY, versionText, isDone, statusLabel, color, font) {
  ctx.font = font;
  const gap = 6, iconSz = 14, cbSz = 13;
  const vw = ctx.measureText(versionText).width;
  const sw = ctx.measureText(statusLabel).width;
  const totalW = iconSz + gap + vw + gap * 2 + cbSz + gap + sw;
  let x = cx - totalW / 2;
  drawDocIconAt(x + iconSz / 2, baselineY - 2, iconSz, color); x += iconSz + gap;
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(versionText, x, baselineY); x += vw + gap * 2;
  drawCheckbox(x + cbSz / 2, baselineY - cbSz / 2 + 1, cbSz, isDone, color); x += cbSz + gap;
  ctx.fillStyle = color; ctx.fillText(statusLabel, x, baselineY);
  ctx.textAlign = 'center';
}

function drawParticles() {
  state.particles.forEach(p => {
    if (p.x == null) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI*2);
    ctx.fillStyle = p.color + '18'; ctx.fill();
    drawDocIcon(p.x, p.y, p.color);
    if (p.label) {
      ctx.fillStyle = T.particleLabel; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, p.y - 15);
    }
    ctx.restore();
  });
}

function drawIcon(path, cx, cy, size, color, viewSize = 16) {
  const s = size / viewSize;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}


// ═══════════════════════════════════════
// CONSISTENCY OVERLAY VIEWS
// ═══════════════════════════════════════
function updateConsistencyViews() {
  const wBox = document.getElementById('write-status');
  const rBox = document.getElementById('read-status');
  const doc  = state.doc;

  const primaryDown = !state.nodes[state.primaryKey].alive;
  const anyAlive    = Object.values(state.nodes).some(n => n.alive);

  if (primaryDown && anyAlive) {
    wBox.innerHTML = TEXTS.consistency.noPrimary;
  } else if (doc.latestId === 0) {
    wBox.innerHTML = TEXTS.consistency.noWrites;
  } else {
    const vid = doc.latestId;
    const committed = vid <= doc.majorityCommitId;
    const version = doc.versions.find(v => v.id === vid);
    const ackCount = version ? version.ackedBy.size : 0;
    const wc = state.writeClient;
    const wVal = document.getElementById('sel-w').value;

    const ackButLost = wc.phase === 'received' && ackCount === 0 && !committed;
    const isDefault  = wVal === 'majority';
    const safetyNote = TEXTS.safetyNote;

    if (wc.phase === 'error') {
      wBox.innerHTML = TEXTS.consistency.writeFailed(vid, wVal, isDefault, safetyNote);
    } else if (ackButLost) {
      wBox.innerHTML = TEXTS.consistency.ackButLost(vid, wVal);
    } else if (committed) {
      wBox.innerHTML = TEXTS.consistency.committed(vid, ackCount);
    } else if (wVal === '0') {
      wBox.innerHTML = TEXTS.consistency.fireForget(vid, safetyNote);
    } else {
      wBox.innerHTML = TEXTS.consistency.inFlight(vid, ackCount, isDefault, safetyNote);
    }
  }

  const rc = state.readClient;
  const rcVal = document.getElementById('sel-rc').value;
  const sessionLabel = rc.sessionActive
    ? (rc.sessionSnapshotId > 0 ? `v${rc.sessionSnapshotId}` : 'none')
    : null;
  const sessionSuffix = sessionLabel !== null ? ` Session locked at ${sessionLabel}.` : '';

  if (rc.lastReceivedVersion === null && rc.phase === 'idle') {
    rBox.innerHTML = TEXTS.consistency.noReads;
  } else if (rc.phase === 'waiting') {
    rBox.innerHTML = TEXTS.consistency.reading(rcVal, sessionSuffix);
  } else if (rc.phase === 'error') {
    rBox.innerHTML = rc.errorReason === 'linearizable'
      ? TEXTS.consistency.readLinearizableBlocked(sessionSuffix)
      : TEXTS.consistency.readFailed(sessionSuffix);
  } else if (rc.lastReceivedVersion !== null) {
    const v = rc.lastReceivedVersion;
    const vStr = v.id > 0 ? `v${v.id}` : 'none';
    if (v.id === 0) {
      const reason = (rcVal === 'local' || rcVal === 'available')
        ? 'Node has no data yet.'
        : `No majority-confirmed data exists (latest v${doc.latestId} still in-flight).`;
      rBox.innerHTML = TEXTS.consistency.readNone(rcVal, reason, sessionSuffix);
    } else if (v.dirty) {
      rBox.innerHTML = TEXTS.consistency.dirtyRead(vStr, rcVal, doc.majorityCommitId, sessionSuffix);
    } else {
      rBox.innerHTML = TEXTS.consistency.safeRead(vStr, rcVal, sessionSuffix);
    }
  }
}

function updateReadActionControls() {
  const rcVal = document.getElementById('sel-rc')?.value;
  const isSnapshot = rcVal === 'snapshot';
  const btnDefault = document.getElementById('btn-read-start');
  const snapWrap = document.getElementById('session-actions');
  if (!btnDefault || !snapWrap) return;
  btnDefault.style.display = isSnapshot ? 'none' : '';
  snapWrap.style.display = isSnapshot ? 'flex' : 'none';
}
