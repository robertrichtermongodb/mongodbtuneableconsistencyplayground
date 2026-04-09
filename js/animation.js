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
