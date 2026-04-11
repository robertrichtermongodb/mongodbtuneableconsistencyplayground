// ═══════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════
let clientDragged = { write: false, read: false };

function computeLayout(W, H) {
  const cx = W / 2;
  const topY    = LAYOUT_TOP_Y;
  const priY    = LAYOUT_PRIMARY_Y;
  const secY    = LAYOUT_SECONDARY_Y;
  const spread  = Math.min(LAYOUT_MAX_SPREAD, W * LAYOUT_SPREAD_RATIO);

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
const NODE_RADIUS = 52, CLIENT_RADIUS = 34;

// Layout
const LAYOUT_TOP_Y     = 60;
const LAYOUT_PRIMARY_Y = 205;
const LAYOUT_SECONDARY_Y = 330;
const LAYOUT_MAX_SPREAD = 220;
const LAYOUT_SPREAD_RATIO = 0.26;

// Hit-test tolerances
const HIT_TOLERANCE     = 5;
const HIT_LINK_DISTANCE = 14;
const HIT_LINK_MARGIN   = 8;

// Drawing sizing
const RS_BOX_PAD        = 38;
const LINK_MIDPOINT_R   = 10;
const LINK_HOVER_R      = 8;
const OUTER_RING_OFFSET = 7;
const HOVER_RING_OFFSET = 6;
const DOC_BADGE_WIDTH   = 80;
const DOC_BADGE_ROW_H   = 18;

// Fonts (reused across many drawing functions)
const FONT_SMALL         = '9px system-ui';
const FONT_LABEL         = 'bold 12px system-ui';
const FONT_VALUE         = 'bold 11px system-ui';
const FONT_CAPTION       = '12px system-ui';
const FONT_TINY          = '7px system-ui';
const FONT_PARTICLE      = 'bold 10px system-ui';
const FONT_DEBUG         = 'bold 9px monospace';

// Stroke widths
const STROKE_DEFAULT       = 1.8;
const STROKE_HOVER         = 3;
const STROKE_CLIENT_BORDER = 2.5;
const STROKE_SEC_SEC       = 1.2;

// Doc icon geometry (proportional to size param)
const DOC_ICON_WIDTH_RATIO = 0.78;
const DOC_ICON_FOLD_RATIO  = 0.28;

// Node element offsets
const NODE_DEAD_ALPHA        = 0.22;
const NODE_LEAF_ICON_SIZE    = 30;
const NODE_LEAF_ICON_OFFSET  = 10;
const NODE_LABEL_OFFSET_Y    = 22;

// Client label offsets
const CLIENT_META_LINE1_DY   = 14;
const CLIENT_META_STACK_DY   = 27;
const CLIENT_META_LINE_GAP   = 13;

// Particle
const PARTICLE_RADIUS        = 14;

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
    idle: THEME.phaseIdle, active: THEME.greenActiveBg, acked: THEME.greenDarkBg,
    error: THEME.redDarkBg, reading: THEME.blueActiveBg, serving: THEME.blueActiveMid,
    waiting: THEME.phaseWaiting, received: THEME.greenDarkBg,
    candidate: THEME.purpleCandBg, recovering: THEME.phaseRecovBg,
  })[phase] || THEME.phaseIdle;
}

function phaseStroke(phase) {
  return ({
    active: THEME.green, acked: THEME.green, error: THEME.red,
    reading: THEME.blue, serving: THEME.green,
    candidate: THEME.purple, recovering: THEME.flowRepl,
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
  const param = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + param * dx), py - (ay + param * dy));
}

function hitTestNodeLinks(mx, my) {
  const nodeKeys = Object.keys(state.nodes);
  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      const aKey = nodeKeys[i], bKey = nodeKeys[j];
      const nodeA = state.nodes[aKey], nodeB = state.nodes[bKey];
      const linkKey = getLinkBetween(aKey, bKey);
      if (!linkKey) continue;
      const dist = pointToSegDist(mx, my, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
      if (dist < HIT_LINK_DISTANCE && Math.hypot(mx - nodeA.x, my - nodeA.y) > NODE_RADIUS + HIT_LINK_MARGIN && Math.hypot(mx - nodeB.x, my - nodeB.y) > NODE_RADIUS + HIT_LINK_MARGIN)
        return { type: 'link', key: linkKey };
    }
  }
  return null;
}

function hitTestClientLinks(mx, my) {
  const wc = state.writeClient, rc = state.readClient;
  const wt = effectiveWriteTarget();
  const wp = state.nodes[wt];
  const wDist = pointToSegDist(mx, my, wc.x, wc.y + CLIENT_RADIUS, wp.x, wp.y - NODE_RADIUS);
  if (wDist < HIT_LINK_DISTANCE && Math.hypot(mx - wc.x, my - wc.y) > CLIENT_RADIUS + HIT_TOLERANCE && Math.hypot(mx - wp.x, my - wp.y) > NODE_RADIUS + HIT_TOLERANCE)
    return { type: 'clientLink', key: 'wp' };
  const tKey = resolveReadTarget(getSelectedReadConcern(), getSelectedReadPref());
  if (tKey) {
    const targetNode = state.nodes[tKey];
    const rDist = pointToSegDist(mx, my, rc.x, rc.y + CLIENT_RADIUS, targetNode.x, targetNode.y - NODE_RADIUS);
    if (rDist < HIT_LINK_DISTANCE && Math.hypot(mx - rc.x, my - rc.y) > CLIENT_RADIUS + HIT_TOLERANCE && Math.hypot(mx - targetNode.x, my - targetNode.y) > NODE_RADIUS + HIT_TOLERANCE)
      return { type: 'clientLink', key: 'rp' };
  }
  return null;
}

function hitTest(mx, my) {
  if (_lockBannerBounds) {
    const bounds = _lockBannerBounds;
    if (mx >= bounds.x && mx <= bounds.x + bounds.w && my >= bounds.y && my <= bounds.y + bounds.h)
      return { type: 'lockBanner' };
  }
  const wc = state.writeClient, rc = state.readClient;
  if (Math.hypot(mx - wc.x, my - wc.y) <= CLIENT_RADIUS + HIT_TOLERANCE) return { type: 'client', key: 'write' };
  if (Math.hypot(mx - rc.x, my - rc.y) <= CLIENT_RADIUS + HIT_TOLERANCE) return { type: 'client', key: 'read' };
  for (const [key, node] of Object.entries(state.nodes)) {
    if (Math.hypot(mx - node.x, my - node.y) <= NODE_RADIUS + HIT_TOLERANCE) return { type: 'node', key };
  }
  return hitTestNodeLinks(mx, my) || hitTestClientLinks(mx, my);
}

// ═══════════════════════════════════════
// DRAW
// ═══════════════════════════════════════
function drawNodes() {
  Object.entries(state.nodes).forEach(([k, n]) => {
    const role = k === state.primaryKey ? 'primary' : isNodeIsolated(k) ? 'isolated' : 'secondary';
    drawNode(n, role);
  });
}

function syncResetButton() {
  const resetBtn = document.getElementById('btn-canvas-reset-ui');
  const hasCustomUI = clientDragged.write || clientDragged.read || state.writeClient.targetNode || state.readClient.targetNode;
  if (resetBtn) resetBtn.style.display = hasCustomUI ? 'block' : 'none';
}

function draw() {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = THEME.canvasBg; ctx.fillRect(0, 0, canvasW, canvasH);

  const selW  = getSelectedWriteConcern();
  const selRC = getSelectedReadConcern();
  const selRP = getSelectedReadPref();

  drawRSBox();
  drawReplicationLinks();
  drawWriteClientLine();
  drawReadClientLine(selRC, selRP);
  drawNodes();
  drawWriteClient(selW);
  drawReadClient(selRC);
  drawDocLedger();
  drawParticles();
  updateConsistencyViews();
  syncResetButton();
  drawLockHint();
  if (typeof debugLabelsActive !== 'undefined' && debugLabelsActive) drawDebugLabels();
}

let _lockBannerBounds = null; // { x, y, w, h } — updated each draw, used by hitTest

function drawLockHint() {
  if (!isTopologyLocked()) { _lockBannerBounds = null; return; }
  const wA = isEngineActive(writeEngine);
  const eA = isEngineActive(electionEngine);
  const rA = isEngineActive(readEngine);
  const parts = [];
  if (wA || eA) parts.push(eA ? 'Election' : 'Write');
  if (rA) parts.push('Read');
  const prefix = parts.join(' and ');
  const text = parts.length > 0
    ? `🔒 ${prefix} in progress - topology locked · finish or reset to reconfigure`
    : TEXTS.canvasTips.sessionLockBanner;
  ctx.save();
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const metrics = ctx.measureText(text);
  const pw = metrics.width + 24, ph = 20;
  const px = canvasW / 2 - pw / 2, py = canvasH - 8 - ph;
  _lockBannerBounds = { x: px, y: py, w: pw, h: ph };
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = THEME.amberDarkBg;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = THEME.amber;
  ctx.fillText(text, canvasW / 2, canvasH - 8);
  ctx.restore();
}

function drawDebugBadge(label, x, y) {
  const metrics = ctx.measureText(label);
  const pw = metrics.width + 6, ph = 13;
  ctx.fillStyle = '#ff00cc';
  ctx.globalAlpha = 0.88;
  ctx.beginPath(); ctx.roundRect(x, y, pw, ph, 3); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 3, y + 2);
}

function drawDebugNodeLabels() {
  Object.entries(state.nodes).forEach(([k, n]) => {
    drawDebugBadge('node:' + k, n.x + NODE_RADIUS - 4, n.y - NODE_RADIUS - 14);
  });
  Object.entries(state.nodes).forEach(([k, n]) => {
    drawDebugBadge('mem:' + k, n.x - 40, n.y + NODE_RADIUS + 12 - 14);
  });
}

function drawDebugLinkLabels() {
  const wc = state.writeClient, rc = state.readClient;
  Object.keys(state.links).forEach(k => {
    if (k === 'wp' || k === 'rp') return;
    const pair = LINK_PAIR_LABELS[k];
    if (!pair) return;
    const nodeA = state.nodes[pair[0]], nodeB = state.nodes[pair[1]];
    if (!nodeA || !nodeB) return;
    drawDebugBadge('link:' + k, (nodeA.x + nodeB.x) / 2 - 10, (nodeA.y + nodeB.y) / 2 - 8);
  });
  drawDebugBadge('link:wp', (wc.x + state.nodes[state.primaryKey].x) / 2 - 10,
    (wc.y + state.nodes[state.primaryKey].y) / 2 - 8);
  const rtKey = resolveReadTarget(getSelectedReadConcern(), getSelectedReadPref());
  if (rtKey) {
    drawDebugBadge('link:rp', (rc.x + state.nodes[rtKey].x) / 2 - 10,
      (rc.y + state.nodes[rtKey].y) / 2 - 8);
  }
}

function drawDebugLabels() {
  ctx.save();
  ctx.font = FONT_DEBUG;
  ctx.textBaseline = 'top';

  drawDebugNodeLabels();
  const wc = state.writeClient, rc = state.readClient;
  drawDebugBadge('writeClient', wc.x - 20, wc.y - CLIENT_RADIUS - 16);
  drawDebugBadge('readClient', rc.x - 20, rc.y - CLIENT_RADIUS - 16);
  drawDebugLinkLabels();
  drawDebugBadge('docLedger', canvasW / 2 - 20, 12);
  drawDebugBadge('rsBox', state.nodes.primary.x - NODE_RADIUS - 30, state.nodes.primary.y - NODE_RADIUS - 38);
  if (_lockBannerBounds) drawDebugBadge('lockBanner', _lockBannerBounds.x, _lockBannerBounds.y - 14);

  ctx.restore();
}

function drawLedgerVersionRows(cx, by, latestId, majorityCommitId, isLost, hasCommitted, hasInFlight) {
  if (isLost && !hasCommitted) {
    drawVersionRow(cx, by + 33, `v${latestId}`,         false, 'LOST',      THEME.red,   'bold 13px system-ui');
  } else if (isLost && hasCommitted) {
    drawVersionRow(cx, by + 30, `v${majorityCommitId}`, true,  'committed', THEME.green, 'bold 11px system-ui');
    drawVersionRow(cx, by + 47, `v${latestId}`,         false, 'LOST',      THEME.red,   'bold 11px system-ui');
  } else if (!hasInFlight) {
    drawVersionRow(cx, by + 33, `v${latestId}`,         true,  'durable',   THEME.green, 'bold 13px system-ui');
  } else if (!hasCommitted) {
    drawVersionRow(cx, by + 33, `v${latestId}`,         false, 'in-flight', THEME.amber, 'bold 13px system-ui');
  } else {
    drawVersionRow(cx, by + 30, `v${majorityCommitId}`, true,  'committed', THEME.green, 'bold 11px system-ui');
    drawVersionRow(cx, by + 47, `v${latestId}`,         false, 'in-flight', THEME.amber, 'bold 11px system-ui');
  }
}

function computeLedgerState() {
  const { latestId, majorityCommitId } = state.doc;
  const hasCommitted = majorityCommitId > 0;
  const hasInFlight  = latestId > majorityCommitId;
  const latestVer    = state.doc.versions.find(v => v.id === latestId);
  const latestAcks   = latestVer ? latestVer.ackedBy.size : 0;
  const isLost       = hasInFlight && latestAcks === 0 && state.writeClient.phase === 'received';
  return { latestId, majorityCommitId, hasCommitted, hasInFlight, isLost };
}

function drawDocLedger() {
  const cx = canvasW / 2, ledgerY = 40;
  ctx.save();
  ctx.textAlign = 'center';

  const ls = computeLedgerState();
  if (ls.latestId === 0) {
    drawIconText('Doc #1  ·  no writes yet', cx, ledgerY + 4, '10px system-ui', THEME.textDimmer, 10);
    ctx.restore(); return;
  }

  const twoRows = ls.hasCommitted && ls.hasInFlight;
  const boxW = 190, boxH = twoRows ? 58 : 42;
  const bx = cx - boxW / 2, by = ledgerY - boxH / 2;

  ctx.fillStyle = THEME.badgeBg;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = ls.isLost ? THEME.red : ls.hasInFlight ? THEME.amber : THEME.green;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.stroke();

  drawIconText('Doc #1', cx, by + 13, 'bold 9px system-ui', THEME.ledgerTitle, 9);
  drawLedgerVersionRows(cx, by, ls.latestId, ls.majorityCommitId, ls.isLost, ls.hasCommitted, ls.hasInFlight);
  ctx.restore();
}

function drawRSBox() {
  const pad = RS_BOX_PAD;
  const allNodes = Object.values(state.nodes);
  const xs = allNodes.map(n => n.x);
  const ys = allNodes.map(n => n.y);
  const bx  = Math.min(...xs) - NODE_RADIUS - pad;
  const bw  = Math.max(...xs) + NODE_RADIUS + pad - bx;
  const by  = Math.min(...ys) - NODE_RADIUS - 24;
  const bh  = Math.max(...ys) + NODE_RADIUS + 72 - by;
  ctx.save();
  ctx.strokeStyle = THEME.rsBoxBorder; ctx.lineWidth = STROKE_DEFAULT; ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.stroke();
  ctx.setLineDash([]);
  const isz = 17;
  const lx = bx + 12, ly = by + bh + 6;
  drawIcon(ICON_RS, lx + isz/2, ly + isz/2, isz, THEME.rsBoxText);
  ctx.fillStyle = THEME.rsBoxText; ctx.font = FONT_CAPTION; ctx.textAlign = 'left';
  ctx.fillText('Replica Set  \u00B7  3-node P-S-S  \u00B7  majority = 2', lx + isz + 6, ly + 13);
  ctx.restore();
}

function drawBrokenMidpoint(mx, my, fillColor, strokeColor) {
  ctx.beginPath(); ctx.arc(mx, my, LINK_MIDPOINT_R, 0, Math.PI * 2);
  ctx.fillStyle = fillColor; ctx.fill();
  ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = strokeColor; ctx.font = FONT_LABEL; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
}

function drawHoverMidpoint(mx, my, strokeColor, iconColor) {
  ctx.beginPath(); ctx.arc(mx, my, LINK_HOVER_R, 0, Math.PI * 2);
  ctx.fillStyle = THEME.cardBg; ctx.fill();
  ctx.strokeStyle = strokeColor; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = iconColor; ctx.font = FONT_SMALL; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('\u2702', mx, my); ctx.textBaseline = 'alphabetic';
}

function drawSingleReplicationLink(aKey, bKey) {
  const nodeA = state.nodes[aKey];
  const nodeB = state.nodes[bKey];
  const linkKey = getLinkBetween(aKey, bKey);
  if (!linkKey) return;
  const linked = state.links[linkKey];
  const broken = !linked || !nodeA.alive || !nodeB.alive;
  const hovered = hoverTarget && hoverTarget.type === 'link' && hoverTarget.key === linkKey;
  const isSecSec = aKey !== state.primaryKey && bKey !== state.primaryKey;
  ctx.save();
  ctx.strokeStyle = hovered ? THEME.linkHover : broken ? THEME.linkBroken : isSecSec ? THEME.linkSecSec : THEME.linkDefault;
  ctx.lineWidth = hovered ? STROKE_HOVER : isSecSec ? STROKE_SEC_SEC : 2;
  ctx.setLineDash(isSecSec ? [2, 4] : [5, 4]);
  ctx.beginPath(); ctx.moveTo(nodeA.x, nodeA.y); ctx.lineTo(nodeB.x, nodeB.y); ctx.stroke();
  ctx.setLineDash([]);
  const mx = (nodeA.x + nodeB.x) / 2, my = (nodeA.y + nodeB.y) / 2;
  if (!nodeA.alive || !nodeB.alive) {
    drawBrokenMidpoint(mx, my, THEME.redDarkBg, THEME.red);
  } else if (!linked) {
    drawBrokenMidpoint(mx, my, THEME.amberDarkBg, THEME.amber);
  } else if (hovered) {
    drawHoverMidpoint(mx, my, THEME.linkHoverMid, THEME.blue);
    if (isSecSec) {
      ctx.font = FONT_SMALL; ctx.fillStyle = THEME.textSecondary; ctx.textBaseline = 'top';
      ctx.fillText('Heartbeat only \u2014 no replication', mx, my + 14);
    }
  }
  ctx.restore();
}

function drawReplicationLinks() {
  const nodeKeys = Object.keys(state.nodes);
  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      drawSingleReplicationLink(nodeKeys[i], nodeKeys[j]);
    }
  }
}

function drawClientLine(client, targetNode, linkKey, colors) {
  const linked = state.links[linkKey];
  const hovered = hoverTarget && hoverTarget.type === 'clientLink' && hoverTarget.key === linkKey;
  ctx.save();
  ctx.strokeStyle = hovered ? colors.hover : !linked ? THEME.linkDeadMid : colors.ok;
  ctx.lineWidth = hovered ? STROKE_HOVER : STROKE_DEFAULT; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(client.x, client.y + CLIENT_RADIUS); ctx.lineTo(targetNode.x, targetNode.y - NODE_RADIUS);
  ctx.stroke(); ctx.setLineDash([]);
  const mx = (client.x + targetNode.x) / 2, my = (client.y + CLIENT_RADIUS + targetNode.y - NODE_RADIUS) / 2;
  if (!linked) {
    drawBrokenMidpoint(mx, my, THEME.redDarkBg, THEME.red);
  } else if (hovered) {
    drawHoverMidpoint(mx, my, colors.hoverMid, colors.hoverTxt);
  }
  ctx.restore();
}

function drawWriteClientLine() {
  drawClientLine(state.writeClient, state.nodes[effectiveWriteTarget()], 'wp',
    { hover: THEME.wLinkHover, ok: THEME.wLinkOk, hoverMid: THEME.wLinkHoverMid, hoverTxt: THEME.wLinkHoverTxt });
}

function drawReadClientLine(rcVal, readPref) {
  const tKey = resolveReadTarget(rcVal, readPref);
  if (!tKey) return;
  const targetNode = state.nodes[tKey];
  const okColor = targetNode.alive ? THEME.rLinkOk : THEME.rLinkDead;
  drawClientLine(state.readClient, targetNode, 'rp',
    { hover: THEME.rLinkHover, ok: okColor, hoverMid: THEME.rLinkHoverMid, hoverTxt: THEME.blue });
}

function leafColorForNode(node, role, isIsolated) {
  if (!node.alive)                return THEME.nodeDeadLeaf;
  if (node.phase === 'acked')     return THEME.green;
  if (node.phase === 'serving')   return THEME.green;
  if (node.phase === 'active')    return THEME.leafActive;
  if (node.phase === 'reading')   return THEME.blue;
  if (node.phase === 'error')     return THEME.red;
  if (node.phase === 'candidate') return THEME.purple;
  if (node.phase === 'recovering') return THEME.flowRepl;
  if (isIsolated)                  return THEME.amber;
  return role === 'primary' ? THEME.leafPriIdle : THEME.leafSecIdle;
}

function drawPhaseRing(x, y, color, dash) {
  ctx.beginPath(); ctx.arc(x, y, NODE_RADIUS + OUTER_RING_OFFSET, 0, Math.PI * 2);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
  ctx.stroke(); ctx.setLineDash([]);
}

function drawAlivePip(node) {
  const hx = node.x + NODE_RADIUS * 0.7, hy = node.y - NODE_RADIUS * 0.7;
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2);
  ctx.fillStyle = node.alive ? THEME.greenDarkBg : THEME.redDarkBg; ctx.fill();
  ctx.strokeStyle = node.alive ? THEME.green : THEME.red; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2);
  ctx.fillStyle = node.alive ? THEME.green : THEME.red; ctx.fill();
  ctx.restore();
}

function drawNodeHoverRing(node) {
  ctx.beginPath(); ctx.arc(node.x, node.y, NODE_RADIUS + HOVER_RING_OFFSET, 0, Math.PI * 2);
  ctx.strokeStyle = node.alive ? THEME.hoverKillHint : THEME.hoverRevHint;
  ctx.lineWidth = STROKE_HOVER; ctx.stroke();
}

function drawNode(node, role) {
  const nodeKey = Object.keys(state.nodes).find(k => state.nodes[k] === node);
  const hovered = hoverTarget && hoverTarget.type === 'node' && hoverTarget.key === nodeKey;
  const isIsolated = role === 'isolated';

  ctx.save();
  if (hovered) drawNodeHoverRing(node);
  if (!node.alive) ctx.globalAlpha = NODE_DEAD_ALPHA;
  const defStroke = isIsolated ? THEME.amber : role === 'primary' ? THEME.nodeStrokePri : THEME.nodeStrokeSec;
  const stroke    = phaseStroke(node.phase) || defStroke;
  ctx.beginPath(); ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = phaseFill(node.phase); ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = node.phase !== 'idle' ? STROKE_HOVER : STROKE_DEFAULT; ctx.stroke();

  drawIcon(ICON_LEAF, node.x, node.y - NODE_LEAF_ICON_OFFSET, NODE_LEAF_ICON_SIZE, leafColorForNode(node, role, isIsolated), 24);

  if (node.phase === 'candidate')  drawPhaseRing(node.x, node.y, THEME.purple, [3, 3]);
  if (node.phase === 'recovering') drawPhaseRing(node.x, node.y, THEME.flowRepl, [5, 3]);
  if (isIsolated)                  drawPhaseRing(node.x, node.y, THEME.amber, [4, 3]);

  ctx.fillStyle = THEME.nodeText; ctx.font = FONT_LABEL; ctx.textAlign = 'center';
  ctx.fillText(isIsolated ? `${node.label} (isolated)` : node.label, node.x, node.y + NODE_LABEL_OFFSET_Y);
  drawNodeDocBadge(node);
  ctx.restore();
  drawAlivePip(node);
}

function versionBadgeColor(v) {
  if (v === 0) return THEME.textDimmer;
  return v <= state.doc.majorityCommitId ? THEME.green : THEME.amber;
}

function versionBadgeText(v) { return v === 0 ? '\u2014' : `v${v}`; }

function drawBadgeFrame(bx, by, bw, bh, borderColor, rowH) {
  ctx.fillStyle = THEME.badgeBg;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5); ctx.fill();
  ctx.strokeStyle = borderColor; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5); ctx.stroke();
  ctx.strokeStyle = THEME.badgeDivider; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bx + 4, by + rowH); ctx.lineTo(bx + bw - 4, by + rowH); ctx.stroke();
}

function drawNodeDocBadge(node) {
  const mem  = node.memoryVersion;
  const disk = node.journalVersion;
  const bw = DOC_BADGE_WIDTH, rowH = DOC_BADGE_ROW_H;
  const bh = rowH * 2 + 1;
  const bx = node.x - bw / 2, by = node.y + NODE_RADIUS + 12;
  const memColor  = versionBadgeColor(mem);
  const diskColor = versionBadgeColor(disk);

  drawBadgeFrame(bx, by, bw, bh, mem > disk ? THEME.amber : memColor, rowH);

  ctx.font = FONT_TINY; ctx.textAlign = 'left';
  ctx.fillStyle = THEME.textHint; ctx.fillText('MEM', bx + 5, by + 11);
  ctx.fillStyle = THEME.textHint; ctx.fillText('DISK', bx + 5, by + rowH + 12);
  ctx.font = FONT_VALUE; ctx.textAlign = 'right';
  ctx.fillStyle = memColor;  ctx.fillText(versionBadgeText(mem), bx + bw - 6, by + 13);
  ctx.fillStyle = diskColor; ctx.fillText(versionBadgeText(disk), bx + bw - 6, by + rowH + 13);

  if (mem > 0 && mem > disk) {
    ctx.fillStyle = THEME.amberAlpha88; ctx.font = FONT_SMALL; ctx.textAlign = 'center';
    ctx.fillText('\u25BC', bx + bw / 2, by + rowH + 1);
  }
}

function drawWriteClient(wVal) {
  const client = state.writeClient;
  const stroke = client.phase === 'received' ? THEME.green : client.phase === 'error' ? THEME.red : THEME.amber;
  const fill   = client.phase === 'received' ? THEME.greenMidBg : client.phase === 'error' ? THEME.redDarkBg : THEME.clientIdleBg;
  ctx.save();
  ctx.beginPath(); ctx.arc(client.x, client.y, CLIENT_RADIUS, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = STROKE_CLIENT_BORDER; ctx.stroke();
  ctx.fillStyle = THEME.clientText; ctx.font = FONT_LABEL; ctx.textAlign = 'center';
  ctx.fillText('Write', client.x, client.y - 4); ctx.fillText('Client', client.x, client.y + 11);
  ctx.fillStyle = THEME.amber; ctx.font = FONT_SMALL;
  ctx.fillText('w:' + wVal, client.x, client.y + CLIENT_RADIUS + CLIENT_META_LINE1_DY);
  let wYOff = CLIENT_RADIUS + CLIENT_META_STACK_DY;
  if (client.targetNode) {
    ctx.fillStyle = THEME.purple; ctx.font = FONT_SMALL;
    ctx.fillText('\u2192 ' + state.nodes[client.targetNode].label, client.x, client.y + wYOff);
    wYOff += CLIENT_META_LINE_GAP;
  }
  if (state.writeClient.lastWrittenVersion > 0) {
    ctx.fillStyle = THEME.textSecondary; ctx.font = FONT_SMALL;
    ctx.fillText(`wrote v${client.lastWrittenVersion}`, client.x, client.y + wYOff);
  }
  ctx.restore();
}

function drawReadClientMeta(client, rcVal, sessionActive) {
  ctx.fillStyle = THEME.blue; ctx.font = FONT_SMALL;
  ctx.fillText('rc:' + rcVal, client.x, client.y + CLIENT_RADIUS + CLIENT_META_LINE1_DY);
  let yOff = CLIENT_RADIUS + CLIENT_META_STACK_DY;
  if (client.targetNode) {
    ctx.fillStyle = THEME.purple; ctx.font = FONT_SMALL;
    ctx.fillText('\u2192 ' + state.nodes[client.targetNode].label, client.x, client.y + yOff);
    yOff += CLIENT_META_LINE_GAP;
  }
  if (sessionActive) {
    const snapLabel = client.sessionSnapshotId > 0 ? `v${client.sessionSnapshotId}` : 'none';
    ctx.fillStyle = THEME.amber; ctx.font = FONT_SMALL;
    ctx.fillText('Session @ ' + snapLabel, client.x, client.y + yOff);
    yOff += CLIENT_META_LINE_GAP;
  }
  if (client.lastReceivedVersion !== null) {
    const ver = client.lastReceivedVersion;
    const vStr = ver.id > 0 ? `v${ver.id}` : 'none';
    const suffix = ver.dirty ? ' \u26A0' : ver.id > 0 ? ' \u2713' : '';
    ctx.fillStyle = ver.dirty ? THEME.amber : ver.id > 0 ? THEME.green : THEME.textSecondary;
    ctx.font = FONT_SMALL;
    ctx.fillText(`got ${vStr}${suffix}`, client.x, client.y + yOff);
  }
}

function drawReadClient(rcVal) {
  const client = state.readClient;
  const sessionActive = !!client.sessionActive;
  const stroke = client.phase === 'received' ? THEME.green : client.phase === 'error' ? THEME.red : THEME.blue;
  const fill   = client.phase === 'received' ? THEME.greenMidBg : client.phase === 'error' ? THEME.redDarkBg : THEME.blueDarkBg;
  ctx.save();
  if (sessionActive) {
    ctx.beginPath(); ctx.arc(client.x, client.y, CLIENT_RADIUS + HOVER_RING_OFFSET, 0, Math.PI*2);
    ctx.strokeStyle = THEME.amber; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath(); ctx.arc(client.x, client.y, CLIENT_RADIUS, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = STROKE_CLIENT_BORDER; ctx.stroke();
  ctx.fillStyle = THEME.clientText; ctx.font = FONT_LABEL; ctx.textAlign = 'center';
  ctx.fillText('Read', client.x, client.y - 4); ctx.fillText('Client', client.x, client.y + 11);
  drawReadClientMeta(client, rcVal, sessionActive);
  ctx.restore();
}

function drawDocIcon(x, y, color) { drawDocIconAt(x, y, 14, color); }

function drawDocIconAt(x, y, size, color) {
  const iconW = size * DOC_ICON_WIDTH_RATIO, iconH = size, fold = size * DOC_ICON_FOLD_RATIO;
  const lx = x - iconW / 2, ly = y - iconH / 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly); ctx.lineTo(lx + iconW - fold, ly); ctx.lineTo(lx + iconW, ly + fold);
  ctx.lineTo(lx + iconW, ly + iconH); ctx.lineTo(lx, ly + iconH); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(lx + iconW - fold, ly); ctx.lineTo(lx + iconW - fold, ly + fold); ctx.lineTo(lx + iconW, ly + fold);
  ctx.closePath();
  ctx.fillStyle = color + '55'; ctx.fill();
  ctx.strokeStyle = THEME.docStroke; ctx.lineWidth = 0.5; ctx.stroke();
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
  const radius = size * 0.22, x = cx - size / 2, y = cy - size / 2;
  ctx.fillStyle = done ? color + '22' : THEME.badgeBg;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, radius); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, radius); ctx.stroke();
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
    ctx.beginPath(); ctx.arc(p.x, p.y, PARTICLE_RADIUS, 0, Math.PI*2);
    ctx.fillStyle = p.color + '18'; ctx.fill();
    drawDocIcon(p.x, p.y, p.color);
    if (p.label) {
      ctx.fillStyle = THEME.particleLabel; ctx.font = FONT_PARTICLE; ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, p.y - 15);
    }
    ctx.restore();
  });
}

function drawIcon(path, cx, cy, size, color, viewSize = 16) {
  const scale = size / viewSize;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
}
