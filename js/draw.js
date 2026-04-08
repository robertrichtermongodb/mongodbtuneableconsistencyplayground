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
function computeLayout(W, H) {
  const cx = W / 2;
  const topY  = 40;
  const nodeY = 245;
  const spread = Math.min(250, W * 0.28);

  state.writeClient.x = cx - spread; state.writeClient.y = topY;
  state.readClient.x  = cx + spread; state.readClient.y  = topY;

  state.nodes.primary.x = cx;          state.nodes.primary.y = nodeY;
  state.nodes.s1.x      = cx - spread; state.nodes.s1.y      = nodeY;
  state.nodes.s2.x      = cx + spread; state.nodes.s2.y      = nodeY;
}

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
  for (const [key, node] of Object.entries(state.nodes)) {
    if (Math.hypot(mx - node.x, my - node.y) <= NR + 5) return { type: 'node', key };
  }
  const pk = state.primaryKey;
  const p  = state.nodes[pk];
  const secKeys = Object.keys(state.nodes).filter(k => k !== pk);
  for (const key of secKeys) {
    const s = state.nodes[key];
    const dist = pointToSegDist(mx, my, p.x, p.y, s.x, s.y);
    if (dist < 14 && Math.hypot(mx - p.x, my - p.y) > NR + 8 && Math.hypot(mx - s.x, my - s.y) > NR + 8)
      return { type: 'link', key };
  }
  const wc = state.writeClient;
  const wDist = pointToSegDist(mx, my, wc.x, wc.y + CR, p.x, p.y - NR);
  if (wDist < 14 && Math.hypot(mx - wc.x, my - wc.y) > CR + 5 && Math.hypot(mx - p.x, my - p.y) > NR + 5)
    return { type: 'clientLink', key: 'wp' };
  const tKey = resolveReadTarget(
    document.getElementById('sel-rc')?.value || 'majority',
    document.getElementById('sel-readpref')?.value || 'primary'
  );
  if (tKey) {
    const t = state.nodes[tKey];
    const rc = state.readClient;
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
  Object.entries(state.nodes).forEach(([k, n]) =>
    drawNode(n, k === state.primaryKey ? 'primary' : 'secondary')
  );
  drawWriteClient(selW);
  drawReadClient(selRC);
  drawDocLedger();
  drawParticles();
  updateConsistencyViews();
}

function drawDocLedger() {
  const { latestId, majorityCommitId } = state.doc;
  const cx   = (state.writeClient.x + state.readClient.x) / 2;
  const ledgerY = state.writeClient.y;

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
  const xs  = [state.nodes.s1.x, state.nodes.primary.x, state.nodes.s2.x];
  const bx  = Math.min(...xs) - NR - pad;
  const bw  = Math.max(...xs) + NR + pad - bx;
  const by  = state.nodes.primary.y - NR - 24;
  const bh  = NR * 2 + 80;
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
  const pk = state.primaryKey;
  const p  = state.nodes[pk];
  const secKeys = Object.keys(state.nodes).filter(k => k !== pk);
  secKeys.forEach(k => {
    const s = state.nodes[k];
    const lk = getLinkBetween(pk, k);
    const linked = lk ? state.links[lk] : true;
    const broken = !linked || !s.alive;
    const hovered = hoverTarget && hoverTarget.type === 'link' && hoverTarget.key === k;
    ctx.save();
    ctx.strokeStyle = hovered ? T.linkHover : broken ? T.linkBroken : T.linkDefault;
    ctx.lineWidth = hovered ? 3 : 2; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    ctx.setLineDash([]);
    const mx = (p.x + s.x) / 2, my = (p.y + s.y) / 2;
    if (!s.alive) {
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
    }
    ctx.restore();
  });
}

function drawWriteClientLine() {
  const p = state.nodes[state.primaryKey];
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
  const defStroke = role === 'primary' ? T.nodeStrokePri : T.nodeStrokeSec;
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

  ctx.fillStyle = T.nodeText; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(node.label, node.x, node.y + 22);
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
  if (state.writeClient.lastWrittenVersion > 0) {
    ctx.fillStyle = T.textSecondary; ctx.font = '9px system-ui';
    ctx.fillText(`wrote v${c.lastWrittenVersion}`, c.x, c.y + CR + 27);
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
  const wBox = document.getElementById('writer-consistency');
  const rBox = document.getElementById('reader-consistency');
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
    rBox.innerHTML = TEXTS.consistency.readFailed(sessionSuffix);
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
  const snapWrap = document.getElementById('snapshot-session-actions');
  if (!btnDefault || !snapWrap) return;
  btnDefault.style.display = isSnapshot ? 'none' : '';
  snapWrap.style.display = isSnapshot ? 'flex' : 'none';
}
