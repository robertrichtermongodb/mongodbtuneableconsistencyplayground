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
  return null;
}

function draw() {
  const W = canvas.getBoundingClientRect().width;
  const H = canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, W, H);

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
    ctx.fillStyle = '#263848'; ctx.font = '12px system-ui';
    ctx.fillText('doc #1  \u00B7  no writes yet', cx, midY);
    ctx.restore(); return;
  }

  const twoRows = latestId > majorityCommitId;
  const boxW = 270, boxH = twoRows ? 66 : 48;
  const bx = cx - boxW / 2, by = midY - boxH / 2;

  ctx.fillStyle = '#0D1F30';
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 8); ctx.fill();
  ctx.strokeStyle = twoRows ? '#F5A623' : '#00ED64';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 8); ctx.stroke();

  ctx.fillStyle = '#3D5A70'; ctx.font = '9px system-ui';
  ctx.fillText('doc #1', cx, by + 14);

  if (!twoRows) {
    ctx.fillStyle = '#00ED64'; ctx.font = 'bold 17px system-ui';
    ctx.fillText(`v${latestId}  \u25C9  durable`, cx, by + 36);
  } else {
    const commLabel = majorityCommitId > 0 ? `v${majorityCommitId}` : 'none';
    ctx.font = '13px system-ui';
    ctx.fillStyle = '#00ED64';
    ctx.fillText(`committed  ${commLabel}  \u25C9  durable`, cx, by + 32);
    ctx.fillStyle = '#F5A623';
    ctx.fillText(`latest  v${latestId}  \u25CE  in-flight`, cx, by + 52);
  }

  ctx.restore();
}

function drawRSBox() {
  const pad = 38;
  const xs  = [state.nodes.s1.x, state.nodes.primary.x, state.nodes.s2.x];
  const bx  = Math.min(...xs) - NR - pad;
  const bw  = Math.max(...xs) + NR + pad - bx;
  const by  = state.nodes.primary.y - NR - 24;
  const bh  = NR * 2 + 58;
  ctx.save();
  ctx.strokeStyle = '#26384A'; ctx.lineWidth = 1.5; ctx.setLineDash([6,4]);
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.stroke();
  ctx.setLineDash([]);
  const isz = 17, ix = bx+12+isz/2, iy = by+9+isz/2;
  drawIcon(ICON_RS, ix, iy, isz, '#3D5A70');
  ctx.fillStyle = '#3D5A70'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('Replica Set  \u00B7  3-node P-S-S  \u00B7  majority = 2', bx+12+isz+6, by+17);
  ctx.restore();
}

function drawReplicationLinks() {
  const p = state.nodes.primary;
  ['s1','s2'].forEach(k => {
    const s = state.nodes[k];
    const hovered = hoverTarget && hoverTarget.type === 'link' && hoverTarget.key === k;
    ctx.save();
    ctx.strokeStyle = hovered ? '#5A8AAA' : s.alive ? '#2A4055' : '#3A2020';
    ctx.lineWidth = hovered ? 2.5 : 1.5; ctx.setLineDash([4,5]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(s.x, s.y); ctx.stroke();
    ctx.setLineDash([]);
    // Break icon when secondary is down
    if (!s.alive) {
      const mx = (p.x + s.x) / 2, my = (p.y + s.y) / 2;
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#2A0E0E'; ctx.fill();
      ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#FF6B6B'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('\u00D7', mx, my);
      ctx.textBaseline = 'alphabetic';
    } else if (hovered) {
      const mx = (p.x + s.x) / 2, my = (p.y + s.y) / 2;
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
  ctx.save();
  ctx.strokeStyle = '#3A5A2A'; ctx.lineWidth = 1; ctx.setLineDash([3,4]);
  ctx.beginPath();
  ctx.moveTo(state.writeClient.x, state.writeClient.y + CR);
  ctx.lineTo(p.x, p.y - NR);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}

function drawReadClientLine() {
  const rc       = document.getElementById('sel-rc')?.value || 'majority';
  const readPref = document.getElementById('sel-readpref')?.value || 'primary';
  const tKey     = resolveReadTarget(rc, readPref);
  if (!tKey) return;
  const t = state.nodes[tKey];
  ctx.save();
  ctx.strokeStyle = t.alive ? '#2A4A5A' : '#1E2A35';
  ctx.lineWidth = 1; ctx.setLineDash([3,4]);
  ctx.beginPath();
  ctx.moveTo(state.readClient.x, state.readClient.y + CR);
  ctx.lineTo(t.x, t.y - NR);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}

function drawNode(node, role) {
  const nodeKey = Object.keys(state.nodes).find(k => state.nodes[k] === node);
  const hovered = hoverTarget && hoverTarget.type === 'node' && hoverTarget.key === nodeKey;

  ctx.save();

  // Hover glow ring (drawn before alpha for down nodes so it's always visible)
  if (hovered) {
    ctx.beginPath(); ctx.arc(node.x, node.y, NR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = node.alive ? '#FF6B6B44' : '#00ED6444';
    ctx.lineWidth = 3; ctx.stroke();
  }

  if (!node.alive) ctx.globalAlpha = 0.22;
  const defStroke = role === 'primary' ? '#C87A10' : '#3A70A0';
  const stroke    = PHASE_STROKE[node.phase] || defStroke;
  ctx.beginPath(); ctx.arc(node.x, node.y, NR, 0, Math.PI*2);
  ctx.fillStyle = PHASE_FILL[node.phase] || PHASE_FILL.idle; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = node.phase !== 'idle' ? 3 : 1.8; ctx.stroke();

  const leafColor =
    !node.alive             ? '#2A3D50' :
    node.phase === 'acked'  ? '#00ED64' :
    node.phase === 'serving'? '#00ED64' :
    node.phase === 'active' ? '#4DCC90' :
    node.phase === 'reading'? '#7EC8E3' :
    node.phase === 'error'  ? '#FF6B6B' :
    role === 'primary'      ? '#C87A10' : '#4A90D9';
  drawIcon(ICON_LEAF, node.x, node.y - 20, 30, leafColor, 24);
  drawNodeDocBadge(node);

  ctx.fillStyle = '#D8E8F3'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(node.label, node.x, node.y + 30);
  const badge = node.alive ? node.phase : 'DOWN';
  ctx.fillStyle = !node.alive ? '#FF6B6B' : node.phase === 'acked' || node.phase === 'serving' ? '#00ED64' : node.phase === 'error' ? '#FF6B6B' : '#3D5570';
  ctx.font = '10px system-ui';
  ctx.fillText(badge, node.x, node.y + 43);
  ctx.restore();

  // Health toggle dot (drawn at full opacity, outside the save/restore for dead nodes)
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
  let vText, color;
  if (vid === 0) {
    vText = 'none  \u2014'; color = '#3D5570';
  } else if (vid <= state.doc.majorityCommitId) {
    vText = `v${vid}  \u25C9`; color = '#00ED64';
  } else {
    vText = `v${vid}  \u25CE`; color = '#F5A623';
  }
  ctx.fillStyle = '#3D5570'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('doc #1', node.x, node.y + 3);
  ctx.fillStyle = color; ctx.font = 'bold 11px system-ui';
  ctx.fillText(vText, node.x, node.y + 16);
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
  const stroke = c.phase === 'received' ? '#00ED64' : c.phase === 'error' ? '#FF6B6B' : '#7EC8E3';
  const fill   = c.phase === 'received' ? '#0A2518' : c.phase === 'error' ? '#2A0E0E' : '#0F2535';
  ctx.save();
  ctx.beginPath(); ctx.arc(c.x, c.y, CR, 0, Math.PI*2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#D8E8F3'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Read', c.x, c.y - 4); ctx.fillText('Client', c.x, c.y + 11);
  ctx.fillStyle = '#7EC8E3'; ctx.font = '9px system-ui';
  ctx.fillText('rc:' + document.getElementById('sel-rc').value, c.x, c.y + CR + 14);
  if (c.lastReceivedVersion !== null) {
    const v = c.lastReceivedVersion;
    const vStr = v.id > 0 ? `v${v.id}` : 'none';
    const suffix = v.dirty ? ' \u26A0' : v.id > 0 ? ' \u2713' : '';
    ctx.fillStyle = v.dirty ? '#F5A623' : v.id > 0 ? '#00ED64' : '#90AEBF';
    ctx.font = '9px system-ui';
    ctx.fillText(`got ${vStr}${suffix}`, c.x, c.y + CR + 27);
  }
  ctx.restore();
}

function drawDocIcon(x, y, color) {
  const w = 11, h = 14, fold = 4;
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
  ctx.fillStyle = color + '60'; ctx.fill();
  ctx.strokeStyle = '#0F1923'; ctx.lineWidth = 0.5;
  ctx.stroke();
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
