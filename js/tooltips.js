// ═══════════════════════════════════════
// CUSTOM TOOLTIP COMPONENT
// ═══════════════════════════════════════

const tipEl = document.createElement('div');
tipEl.className = 'tip';
tipEl.innerHTML = '<div class="tip-title"></div><div class="tip-body"></div><div class="tip-arrow"></div>';
document.body.appendChild(tipEl);

let tipTimer = null;
let tipTarget = null;
const TIP_DELAY = 420;

function renderTipContent(raw) {
  const parts = raw.split('\n\n');
  const titleEl = tipEl.querySelector('.tip-title');
  const bodyEl  = tipEl.querySelector('.tip-body');
  if (parts.length > 1) {
    titleEl.textContent = parts[0];
    titleEl.style.display = '';
    bodyEl.innerHTML = parts.slice(1).join('<br><br>');
  } else {
    titleEl.style.display = 'none';
    bodyEl.innerHTML = raw.replace(/\n/g, '<br>');
  }
}

function positionTooltip(el) {
  const tipRect = tipEl.getBoundingClientRect();
  const elRect  = el.getBoundingClientRect();
  let top  = elRect.top - tipRect.height - 10;
  let left = elRect.left + elRect.width / 2 - tipRect.width / 2;

  if (top < 4) {
    top = elRect.bottom + 10;
    tipEl.classList.add('below');
  }
  left = Math.max(6, Math.min(left, window.innerWidth - tipRect.width - 6));
  tipEl.style.top  = top + 'px';
  tipEl.style.left = left + 'px';

  const arrowEl = tipEl.querySelector('.tip-arrow');
  const arrowX  = elRect.left + elRect.width / 2 - left;
  arrowEl.style.left = Math.max(12, Math.min(arrowX, tipRect.width - 12)) + 'px';
  arrowEl.style.marginLeft = '0';
}

function showTip(el) {
  const raw = el.getAttribute('data-tip') || '';
  if (!raw) return;
  renderTipContent(raw);
  tipEl.classList.remove('below');
  tipEl.classList.add('visible');
  positionTooltip(el);
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTimer = null;
  tipTarget = null;
  tipEl.classList.remove('visible');
}

document.addEventListener('mouseenter', e => {
  if (!e.target || !e.target.closest) return;
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  if (tipTarget === el) return;
  hideTip();
  tipTarget = el;
  tipTimer = setTimeout(() => showTip(el), TIP_DELAY);
}, true);

document.addEventListener('mouseleave', e => {
  if (!e.target || !e.target.closest) return;
  const el = e.target.closest('[data-tip]');
  if (el && el === tipTarget) hideTip();
}, true);

document.addEventListener('click', () => hideTip(), true);
document.addEventListener('scroll', () => hideTip(), true);

// ═══════════════════════════════════════
// TOOLTIP DEFINITIONS
// ═══════════════════════════════════════

const DROPDOWN_TIPS = TEXTS.dropdowns;
const BUTTON_TIPS  = TEXTS.buttons;

function syncTooltips() {
  for (const [id, map] of Object.entries(DROPDOWN_TIPS)) {
    const el = document.getElementById(id);
    if (el) {
      el.removeAttribute('title');
      el.setAttribute('data-tip', map[el.value] || '');
    }
  }
}

function initButtonTips() {
  for (const [id, text] of Object.entries(BUTTON_TIPS)) {
    const el = document.getElementById(id);
    if (el) {
      el.removeAttribute('title');
      el.setAttribute('data-tip', text);
    }
  }
}
