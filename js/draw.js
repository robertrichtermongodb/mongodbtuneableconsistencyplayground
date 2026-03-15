// ═══════════════════════════════════════
// ANIMATION
// ═══════════════════════════════════════
function awaitParticle(from, to, color, label, onArrive) {
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
  const topY  = 82;
  const nodeY = H - 120;
  const spread = Math.min(250, W * 0.28);

  state.writeClient.x = cx - spread; state.writeClient.y = topY;
  state.readClient.x  = cx + spread; state.readClient.y  = topY;

  state.nodes.primary.x = cx;          state.nodes.primary.y = nodeY;
  state.nodes.s1.x      = cx - spread; state.nodes.s1.y      = nodeY;
  state.nodes.s2.x      = cx + spread; state.nodes.s2.y      = nodeY;
}

// ═══════════════════════════════════════
// DRAW
// ═══════════════════════════════════════
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const NR = 52, CR = 34;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeLayout(rect.width, rect.height);
  draw();
}

const PHASE_FILL   = { idle:'#182535', active:'#0D2820', acked:'#0A2010', error:'#2A0E0E', reading:'#0A1E30', serving:'#0A2018', waiting:'#182535', received:'#0A2010' };
const PHASE_STROKE = { idle:null,      active:'#00ED64', acked:'#00ED64', error:'#FF6B6B', reading:'#7EC8E3', serving:'#00ED64' };

// ═══════════════════════════════════════
// CANVAS HIT TESTING
// ═══════════════════════════════════════
let hoverTarget = null; // { type:'node'|'link', key } or null

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
  const p = state.nodes.primary;
  for (const key of ['s1', 's2']) {
    const s = state.nodes[key];
    const dist = pointToSegDist(mx, my, p.x, p.y, s.x, s.y);
    if (dist < 14 && Math.hypot(mx - p.x, my - p.y) > NR + 8 && Math.hypot(mx - s.x, my - s.y) > NR + 8)
      return { type: 'link', key };
  }
  // Writer → Primary
  const wc = state.writeClient;
  const wDist = pointToSegDist(mx, my, wc.x, wc.y + CR, p.x, p.y - NR);
  if (wDist < 14 && Math.hypot(mx - wc.x, my - wc.y) > CR + 5 && Math.hypot(mx - p.x, my - p.y) > NR + 5)
    return { type: 'clientLink', key: 'wp' };
  // Reader → Target
  const tKey = typeof resolveReadTarget === 'function'
    ? resolveReadTarget(document.getElementById('sel-rc')?.value || 'majority', document.getElementById('sel-readpref')?.value || 'primary')
    : null;
  if (tKey) {
    const t = state.nodes[tKey];
    const rc = state.readClient;
    const rDist = pointToSegDist(mx, my, rc.x, rc.y + CR, t.x, t.y - NR);
    if (rDist < 14 && Math.hypot(mx - rc.x, my - rc.y) > CR + 5 && Math.hypot(mx - t.x, my - t.y) > NR + 5)
      return { type: 'clientLink', key: 'rp' };
  }
  return null;
}

function draw() {
  const W = canvas.getBoundingClientRect().width;
  const H = canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, W, H);
  // Slightly darker canvas background so elements lift off the card
  ctx.fillStyle = '#0E1C2A'; ctx.fillRect(0, 0, W, H);

  drawRSBox();
  drawReplicationLinks();
  drawWriteClientLine();
  drawReadClientLine();
  drawNode(state.nodes.s1,      'secondary');
  drawNode(state.nodes.s2,      'secondary');
  drawNode(state.nodes.primary, 'primary');
  drawWriteClient();
  drawReadClient();
  drawDocLedger();
  drawParticles();

  if (typeof updateConsistencyViews === 'function') updateConsistencyViews();
}

function drawDocLedger() {
  const { latestId, majorityCommitId } = state.doc;
  const cx   = state.nodes.primary.x;
  const midY = (state.writeClient.y + state.nodes.primary.y) / 2;

  ctx.save();
  ctx.textAlign = 'center';

  if (latestId === 0) {
    drawIconText('Doc #1  ·  no writes yet', cx, midY + 5, '13px system-ui', '#4A6880', 13);
    ctx.restore(); return;
  }

  const hasCommitted = majorityCommitId > 0;
  const hasInFlight  = latestId > majorityCommitId;
  const twoRows = hasCommitted && hasInFlight;
  const boxW = 300, boxH = twoRows ? 84 : 62;
  const bx = cx - boxW / 2, by = midY - boxH / 2;

  ctx.fillStyle = '#0D1F30';
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 8); ctx.fill();
  ctx.strokeStyle = hasInFlight ? '#F5A623' : '#00ED64';
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 8); ctx.stroke();

  // Header: doc icon + "Doc #1"
  drawIconText('Doc #1', cx, by + 18, 'bold 12px system-ui', '#7A9AB8', 12);

  if (!hasInFlight) {
    // Everything committed — single durable row
    drawVersionRow(cx, by + 48, `v${latestId}`,         true,  'durable',   '#00ED64', 'bold 19px system-ui');
  } else if (!hasCommitted) {
    // Nothing committed yet — single in-flight row, no phantom "none committed"
    drawVersionRow(cx, by + 48, `v${latestId}`,         false, 'in-flight', '#F5A623', 'bold 19px system-ui');
  } else {
    // Both committed and in-flight exist
    drawVersionRow(cx, by + 42, `v${majorityCommitId}`, true,  'committed', '#00ED64', 'bold 15px system-ui');
    drawVersionRow(cx, by + 66, `v${latestId}`,         false, 'in-flight', '#F5A623', 'bold 15px system-ui');
  }

  ctx.restore();
}

function drawRSBox() {
  const pad = 38;
  const xs  = [state.nodes.s1.x, state.nodes.primary.x, state.nodes.s2.x];
  const bx  = Math.min(...xs) - NR - pad;
  const bw  = Math.max(...xs) + NR + pad - bx;
  const by  = state.nodes.primary.y - NR - 24;
  const bh  = NR * 2 + 78;
  ctx.save();
  ctx.strokeStyle = '#3A5878'; ctx.lineWidth = 1.8; ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.stroke();
  ctx.setLineDash([]);
  const isz = 17, ix = bx+12+isz/2, iy = by+9+isz/2;
  drawIcon(ICON_RS, ix, iy, isz, '#6A8AA8');
  ctx.fillStyle = '#6A8AA8'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('Replica Set  \u00B7  3-node P-S-S  \u00B7  majority = 2', bx+12+isz+6, by+17);
  ctx.restore();
}

function drawReplicationLinks() {
  const p = state.nodes.primary;
  ['s1','s2'].forEach(k => {
    const s = state.nodes[k];
    const linkKey = 'p' + k;
    const linked = state.links[linkKey];
    const broken = !linked || !s.alive;
    const hovered = hoverTarget && hoverTarget.type === 'link' && hoverTarget.key === k;
    ctx.save();
    ctx.strokeStyle = hovered ? '#7AAAC8' : broken ? '#4A2020' : '#4A7090';
    ctx.lineWidth = hovered ? 3 : 2; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    ctx.setLineDash([]);
    const mx = (p.x + s.x) / 2, my = (p.y + s.y) / 2;
    if (!s.alive) {
      // Node dead — red ×
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#2A0E0E'; ctx.fill();
      ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#FF6B6B'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u00D7', mx, my);
      ctx.textBaseline = 'alphabetic';
    } else if (!linked) {
      // Partitioned — amber ×
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#2A1A08'; ctx.fill();
      ctx.strokeStyle = '#F5A623'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#F5A623'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u00D7', mx, my);
      ctx.textBaseline = 'alphabetic';
    } else if (hovered) {
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#182535'; ctx.fill();
      ctx.strokeStyle = '#5A8AAA'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#7EC8E3'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u2702', mx, my);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  });
}

function drawWriteClientLine() {
  const p = state.nodes.primary;
  const wc = state.writeClient;
  const linked = state.links.wp;
  const hovered = hoverTarget && hoverTarget.type === 'clientLink' && hoverTarget.key === 'wp';

  ctx.save();
  ctx.strokeStyle = hovered ? '#A0D060' : !linked ? '#7A2020' : '#6AAA40';
  ctx.lineWidth = hovered ? 3 : 1.8; ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(wc.x, wc.y + CR);
  ctx.lineTo(p.x, p.y - NR);
  ctx.stroke(); ctx.setLineDash([]);

  const mx = (wc.x + p.x) / 2, my = (wc.y + CR + p.y - NR) / 2;
  if (!linked) {
    ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#2A0E0E'; ctx.fill();
    ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#FF6B6B'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
  } else if (hovered) {
    ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#182535'; ctx.fill();
    ctx.strokeStyle = '#5A8A5A'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#8ABA5A'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2702', mx, my); ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawReadClientLine() {
  const rcVal    = document.getElementById('sel-rc')?.value || 'majority';
  const readPref = document.getElementById('sel-readpref')?.value || 'primary';
  const tKey     = resolveReadTarget(rcVal, readPref);
  if (!tKey) return;
  const t = state.nodes[tKey];
  const rc = state.readClient;
  const linked = state.links.rp;
  const hovered = hoverTarget && hoverTarget.type === 'clientLink' && hoverTarget.key === 'rp';

  ctx.save();
  ctx.strokeStyle = hovered ? '#70B8D8' : !linked ? '#7A2020' : t.alive ? '#4A88AA' : '#2A3A48';
  ctx.lineWidth = hovered ? 3 : 1.8; ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(rc.x, rc.y + CR);
  ctx.lineTo(t.x, t.y - NR);
  ctx.stroke(); ctx.setLineDash([]);

  const mx = (rc.x + t.x) / 2, my = (rc.y + CR + t.y - NR) / 2;
  if (!linked) {
    ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#2A0E0E'; ctx.fill();
    ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#FF6B6B'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u00D7', mx, my); ctx.textBaseline = 'alphabetic';
  } else if (hovered) {
    ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#182535'; ctx.fill();
    ctx.strokeStyle = '#3A6A8A'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#7EC8E3'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
    ctx.strokeStyle = node.alive ? '#FF6B6B44' : '#00ED6444';
    ctx.lineWidth = 3; ctx.stroke();
  }

  if (!node.alive) ctx.globalAlpha = 0.22;
  const defStroke = role === 'primary' ? '#E09A20' : '#5A98C8';
  const stroke    = PHASE_STROKE[node.phase] || defStroke;
  ctx.beginPath(); ctx.arc(node.x, node.y, NR, 0, Math.PI * 2);
  ctx.fillStyle = PHASE_FILL[node.phase] || PHASE_FILL.idle; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = node.phase !== 'idle' ? 3 : 1.8; ctx.stroke();

  const leafColor =
    !node.alive             ? '#2A3D50' :
    node.phase === 'acked'  ? '#00ED64' :
    node.phase === 'serving'? '#00ED64' :
    node.phase === 'active' ? '#4DCC90' :
    node.phase === 'reading'? '#7EC8E3' :
    node.phase === 'error'  ? '#FF6B6B' :
    role === 'primary'      ? '#E09A20' : '#5AAAE8';
  drawIcon(ICON_LEAF, node.x, node.y - 10, 30, leafColor, 24);

  ctx.fillStyle = '#D8E8F3'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(node.label, node.x, node.y + 22);

  drawNodeDocBadge(node);
  ctx.restore();

  // Health toggle dot (full opacity, outside save/restore for dead nodes)
  const hx = node.x + NR * 0.7, hy = node.y - NR * 0.7;
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2);
  ctx.fillStyle = node.alive ? '#0A2010' : '#2A0E0E'; ctx.fill();
  ctx.strokeStyle = node.alive ? '#00ED64' : '#FF6B6B'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2);
  ctx.fillStyle = node.alive ? '#00ED64' : '#FF6B6B'; ctx.fill();
  ctx.restore();
}

function drawNodeDocBadge(node) {
  if (state.doc.latestId === 0) return;
  const vid = node.docVersionId;
  let vText, borderColor, textColor, showIcon;
  if (vid === 0) {
    vText = '\u2014'; borderColor = '#2E4460'; textColor = '#4A6880'; showIcon = false;
  } else if (vid <= state.doc.majorityCommitId) {
    vText = `v${vid}`; borderColor = '#00ED64'; textColor = '#00ED64'; showIcon = true;
  } else {
    vText = `v${vid}`; borderColor = '#F5A623'; textColor = '#F5A623'; showIcon = true;
  }
  const iconSz = 11, gap = 4;
  ctx.font = 'bold 12px system-ui';
  const tw = ctx.measureText(vText).width;
  const contentW = showIcon ? iconSz + gap + tw : tw;
  const bw = Math.max(54, contentW + 20);
  const bh = 22, br = 5;
  const bx = node.x - bw / 2, by = node.y + NR + 12;

  ctx.fillStyle = '#0D1F30';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.fill();
  ctx.strokeStyle = borderColor; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, br); ctx.stroke();

  const midX = node.x, midY = by + bh / 2 + 4;
  if (showIcon) {
    drawIconText(vText, midX, midY, 'bold 12px system-ui', textColor, iconSz);
  } else {
    ctx.fillStyle = textColor; ctx.textAlign = 'center';
    ctx.fillText(vText, midX, midY);
  }
}

function drawWriteClient() {
  const c = state.writeClient;
  const stroke = c.phase === 'received' ? '#00ED64' : c.phase === 'error' ? '#FF6B6B' : '#F5A623';
  const fill   = c.phase === 'received' ? '#0A2518' : c.phase === 'error' ? '#2A0E0E' : '#0F2030';
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, CR, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#D8E8F3'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Write', c.x, c.y - 4); ctx.fillText('Client', c.x, c.y + 11);
  ctx.fillStyle = '#F5A623'; ctx.font = '9px system-ui';
  ctx.fillText('w:' + document.getElementById('sel-w').value, c.x, c.y + CR + 14);
  if (state.writeClient.lastWrittenVersion > 0) {
    ctx.fillStyle = '#90AEBF'; ctx.font = '9px system-ui';
    ctx.fillText(`wrote v${c.lastWrittenVersion}`, c.x, c.y + CR + 27);
  }
  ctx.restore();
}

function drawReadClient() {
  const c = state.readClient;
  const sessionActive = !!c.sessionActive;
  const stroke = c.phase === 'received' ? '#00ED64' : c.phase === 'error' ? '#FF6B6B' : '#7EC8E3';
  const fill   = c.phase === 'received' ? '#0A2518' : c.phase === 'error' ? '#2A0E0E' : '#0F2535';
  ctx.save();
  // Session-active ring (outer glow when snapshot session is active)
  if (sessionActive) {
    ctx.beginPath(); ctx.arc(c.x, c.y, CR + 6, 0, Math.PI*2);
    ctx.strokeStyle = '#F5A623'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath(); ctx.arc(c.x, c.y, CR, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#D8E8F3'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Read', c.x, c.y - 4); ctx.fillText('Client', c.x, c.y + 11);
  ctx.fillStyle = '#7EC8E3'; ctx.font = '9px system-ui';
  ctx.fillText('rc:' + document.getElementById('sel-rc').value, c.x, c.y + CR + 14);
  let yOff = CR + 27;
  if (sessionActive) {
    const snapLabel = c.sessionSnapshotId > 0 ? `v${c.sessionSnapshotId}` : 'none';
    ctx.fillStyle = '#F5A623'; ctx.font = '9px system-ui';
    ctx.fillText('Session @ ' + snapLabel, c.x, c.y + yOff);
    yOff += 13;
  }
  if (c.lastReceivedVersion !== null) {
    const v = c.lastReceivedVersion;
    const vStr = v.id > 0 ? `v${v.id}` : 'none';
    const suffix = v.dirty ? ' \u26A0' : v.id > 0 ? ' \u2713' : '';
    ctx.fillStyle = v.dirty ? '#F5A623' : v.id > 0 ? '#00ED64' : '#90AEBF';
    ctx.font = '9px system-ui';
    ctx.fillText(`got ${vStr}${suffix}`, c.x, c.y + yOff);
  }
  ctx.restore();
}

function drawDocIcon(x, y, color) { drawDocIconAt(x, y, 14, color); }

// Draws a document icon centred at (x,y) with the given height
function drawDocIconAt(x, y, size, color) {
  const w = size * 0.78, h = size, fold = size * 0.28;
  const lx = x - w / 2, ly = y - h / 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx + w - fold, ly);
  ctx.lineTo(lx + w, ly + fold);
  ctx.lineTo(lx + w, ly + h);
  ctx.lineTo(lx, ly + h);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(lx + w - fold, ly);
  ctx.lineTo(lx + w - fold, ly + fold);
  ctx.lineTo(lx + w, ly + fold);
  ctx.closePath();
  ctx.fillStyle = color + '55'; ctx.fill();
  ctx.strokeStyle = '#0F1923'; ctx.lineWidth = 0.5; ctx.stroke();
}

// Draw icon+text pair horizontally centred at cx, vertically at textBaselineY
function drawIconText(text, cx, textBaselineY, font, color, iconSize) {
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const gap = 5;
  const totalW = iconSize + gap + tw;
  const startX = cx - totalW / 2;
  drawDocIconAt(startX + iconSize / 2, textBaselineY - iconSize * 0.15, iconSize, color);
  ctx.fillStyle = color; ctx.textAlign = 'left';
  ctx.fillText(text, startX + iconSize + gap, textBaselineY);
  ctx.textAlign = 'center';
}

// Draws a small rounded checkbox centred at (cx, cy)
// done=true → filled box + checkmark; done=false → empty box with dash
function drawCheckbox(cx, cy, size, done, color) {
  const r = size * 0.22;
  const x = cx - size / 2, y = cy - size / 2;
  // Box fill
  ctx.fillStyle = done ? color + '22' : '#0D1F30';
  ctx.beginPath(); ctx.roundRect(x, y, size, size, r); ctx.fill();
  // Box border
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, size, size, r); ctx.stroke();
  // Inner mark
  ctx.strokeStyle = color; ctx.lineWidth = done ? 2 : 1.5; ctx.lineCap = 'round';
  if (done) {
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.25, cy + size * 0.02);
    ctx.lineTo(cx - size * 0.02, cy + size * 0.25);
    ctx.lineTo(cx + size * 0.30, cy - size * 0.20);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.22, cy);
    ctx.lineTo(cx + size * 0.22, cy);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// Draw: [doc icon] [versionText]  [checkbox]  [statusLabel] — all centred at cx
function drawVersionRow(cx, baselineY, versionText, isDone, statusLabel, color, font) {
  ctx.font = font;
  const gap = 6, iconSz = 14, cbSz = 13;
  const vw = ctx.measureText(versionText).width;
  const sw = ctx.measureText(statusLabel).width;
  const totalW = iconSz + gap + vw + gap * 2 + cbSz + gap + sw;
  let x = cx - totalW / 2;

  drawDocIconAt(x + iconSz / 2, baselineY - 2, iconSz, color);
  x += iconSz + gap;

  ctx.fillStyle = color; ctx.textAlign = 'left';
  ctx.fillText(versionText, x, baselineY);
  x += vw + gap * 2;

  drawCheckbox(x + cbSz / 2, baselineY - cbSz / 2 + 1, cbSz, isDone, color);
  x += cbSz + gap;

  ctx.fillStyle = color;
  ctx.fillText(statusLabel, x, baselineY);
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
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, p.y - 15);
    }
    ctx.restore();
  });
}
