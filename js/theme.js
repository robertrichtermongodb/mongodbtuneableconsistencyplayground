// ═══════════════════════════════════════
// DESIGN TOKENS & THEME
// ═══════════════════════════════════════

const THEMES = {
  dark: {
    // ── Surfaces ──
    pageBg:       '#0F1923',
    canvasBg:     '#0E1C2A',
    cardBg:       '#182535',
    inputBg:      '#0A1E2B',
    overlayBg:    'rgba(13,31,48,0.92)',
    popupScrim:   'rgba(0,0,0,0.7)',
    popupBg:      '#182535',
    popupShadow:  '0 8px 32px rgba(0,0,0,0.5)',
    badgeBg:      '#0D1F30',

    // ── Borders ──
    border:       '#26384A',
    borderSubtle: '#1E2D3A',
    borderMuted:  '#1E3346',
    badgeDivider: '#1A3048',
    rsBoxBorder:  '#3A5878',

    // ── Text ──
    text:         '#D8E8F3',
    textBright:   '#ffffff',
    textSecondary:'#90AEBF',
    textTertiary: '#6A8A9F',
    textMuted:    '#5A7A8A',
    textDim:      '#3D5570',
    textDimmer:   '#4A6880',
    textHint:     '#5A7A98',
    footerText:   '#3D5A6A',
    footerLink:   '#4E7A90',
    footerLinkHov:'#7AAABF',
    footerBorder: '#1E2D3A',
    ledgerTitle:  '#7A9AB8',
    phaseSep:     '#2A3E50',

    // ── Accents (semantic) ──
    green:        '#00ED64',
    greenHover:   '#00c050',
    greenDarkBg:  '#0A2010',
    greenMidBg:   '#0A2518',
    greenActiveBg:'#0D2820',
    greenPillBg:  'rgba(0,237,100,0.10)',

    amber:        '#F5A623',
    amberAlpha40: '#F5A62340',
    amberAlpha88: '#F5A62388',
    amberPillBg:  'rgba(245,166,35,0.15)',
    amberDarkBg:  '#2A1A08',

    blue:         '#7EC8E3',
    blueHover:    '#5ab8d8',
    blueAlpha40:  '#7EC8E340',
    blueDarkBg:   '#0F2535',
    blueActiveBg: '#0A1E30',
    blueActiveMid:'#0A2018',

    red:          '#FF6B6B',
    redDarkBg:    '#2A0E0E',
    redPillBg:    'rgba(255,107,107,0.12)',

    purple:       '#B07AFF',
    purpleLt:     '#C090FF',
    purpleLtHov:  '#D0A8FF',
    purpleHint:   '#7040AA',
    purpleDarkBg: '#1A0E30',
    purpleHoverBg:'#2A1850',
    purpleCandBg: '#1A1030',

    // ── Buttons ──
    btnSecBg:     '#1A2E40',
    btnSecDisBg:  '#1A2530',
    btnSecDisBrd: '#1E2D3A',
    btnSecOnBg:   '#0A2535',

    // ── Canvas: node phase fills ──
    phaseIdle:    '#182535',
    phaseWaiting: '#182535',
    phaseRecovBg: '#0A1A30',

    // ── Canvas: links ──
    linkDefault:  '#4A7090',
    linkSecSec:   '#3A5A70',
    linkHover:    '#7AAAC8',
    linkBroken:   '#4A2020',
    linkHoverMid: '#5A8AAA',
    linkDeadMid:  '#7A2020',

    wLinkOk:      '#6AAA40',
    wLinkHover:   '#A0D060',
    wLinkHoverMid:'#5A8A5A',
    wLinkHoverTxt:'#8ABA5A',

    rLinkOk:      '#4A88AA',
    rLinkDead:    '#2A3A48',
    rLinkHover:   '#70B8D8',
    rLinkHoverMid:'#3A6A8A',

    // ── Canvas: RS box ──
    rsBoxText:    '#6A8AA8',

    // ── Canvas: nodes ──
    nodeText:     '#D8E8F3',
    nodeStrokePri:'#E09A20',
    nodeStrokeSec:'#5A98C8',
    nodeDeadLeaf: '#2A3D50',
    leafPriIdle:  '#E09A20',
    leafSecIdle:  '#5AAAE8',
    leafActive:   '#4DCC90',

    // ── Canvas: clients ──
    clientText:   '#D8E8F3',
    clientIdleBg: '#0F2030',

    // ── Canvas: particles ──
    particleLabel:'#ffffff',
    docStroke:    '#0F1923',

    // ── Canvas: hover indicators ──
    hoverKillHint:'#FF6B6B44',
    hoverRevHint: '#00ED6444',

    // ── Particle/data flow colors (write-machine.js, read-steps.js) ──
    flowWrite:    '#F5A623',
    flowRepl:     '#4A90D9',
    flowAck:      '#00ED64',
    flowErr:      '#FF6B6B',
    flowRead:     '#7EC8E3',
    flowDim:      '#3D5570',
  },

  light: {
    pageBg:       '#F0F4F8',
    canvasBg:     '#E8EEF4',
    cardBg:       '#FFFFFF',
    inputBg:      '#F0F4F8',
    overlayBg:    'rgba(255,255,255,0.94)',
    popupScrim:   'rgba(0,0,0,0.35)',
    popupBg:      '#FFFFFF',
    popupShadow:  '0 8px 32px rgba(0,0,0,0.12)',
    badgeBg:      '#F0F4F8',

    border:       '#C8D4E0',
    borderSubtle: '#D8E0E8',
    borderMuted:  '#C0CCD8',
    badgeDivider: '#D0D8E4',
    rsBoxBorder:  '#9AB0C8',

    text:         '#1A2A3A',
    textBright:   '#0A1520',
    textSecondary:'#4A6070',
    textTertiary: '#5A7080',
    textMuted:    '#7A8A98',
    textDim:      '#9AACB8',
    textDimmer:   '#7A8FA0',
    textHint:     '#7A8FA0',
    footerText:   '#8A9AA8',
    footerLink:   '#4A7A90',
    footerLinkHov:'#2A5A70',
    footerBorder: '#D8E0E8',
    ledgerTitle:  '#5A7090',
    phaseSep:     '#C0CCD8',

    green:        '#00B850',
    greenHover:   '#009A40',
    greenDarkBg:  '#E0F8E8',
    greenMidBg:   '#D8F5E0',
    greenActiveBg:'#D0F0D8',
    greenPillBg:  'rgba(0,184,80,0.12)',

    amber:        '#D08A10',
    amberAlpha40: '#D08A1040',
    amberAlpha88: '#D08A1088',
    amberPillBg:  'rgba(208,138,16,0.15)',
    amberDarkBg:  '#FFF4E0',

    blue:         '#2090C0',
    blueHover:    '#1878A8',
    blueAlpha40:  '#2090C040',
    blueDarkBg:   '#E0F0F8',
    blueActiveBg: '#D8ECF4',
    blueActiveMid:'#D8F0E8',

    red:          '#D04040',
    redDarkBg:    '#FCE8E8',
    redPillBg:    'rgba(208,64,64,0.12)',

    purple:       '#8050D0',
    purpleLt:     '#9A70E0',
    purpleLtHov:  '#7A50C0',
    purpleHint:   '#A080D0',
    purpleDarkBg: '#F0E8FC',
    purpleHoverBg:'#E8E0F8',
    purpleCandBg: '#F0E8FC',

    btnSecBg:     '#E8EEF4',
    btnSecDisBg:  '#F0F4F8',
    btnSecDisBrd: '#D8E0E8',
    btnSecOnBg:   '#E0F4E8',

    phaseIdle:    '#F0F4F8',
    phaseWaiting: '#F0F4F8',
    phaseRecovBg: '#E0F0FC',

    linkDefault:  '#7AA0C0',
    linkSecSec:   '#98B8D0',
    linkHover:    '#4080A8',
    linkBroken:   '#D0A0A0',
    linkHoverMid: '#6090A8',
    linkDeadMid:  '#C08080',

    wLinkOk:      '#50A040',
    wLinkHover:   '#408030',
    wLinkHoverMid:'#70A070',
    wLinkHoverTxt:'#408030',

    rLinkOk:      '#5090B0',
    rLinkDead:    '#B0C0CC',
    rLinkHover:   '#3080A8',
    rLinkHoverMid:'#5090A8',

    rsBoxText:    '#5A80A0',

    nodeText:     '#1A2A3A',
    nodeStrokePri:'#C08020',
    nodeStrokeSec:'#4080B0',
    nodeDeadLeaf: '#B0C0D0',
    leafPriIdle:  '#C08020',
    leafSecIdle:  '#3090D0',
    leafActive:   '#30A060',

    clientText:   '#1A2A3A',
    clientIdleBg: '#E8F0F8',

    particleLabel:'#1A2A3A',
    docStroke:    '#FFFFFF',

    hoverKillHint:'#D0404044',
    hoverRevHint: '#00B85044',

    flowWrite:    '#D08A10',
    flowRepl:     '#3080C0',
    flowAck:      '#00B850',
    flowErr:      '#D04040',
    flowRead:     '#2090C0',
    flowDim:      '#9AACB8',
  },
};

let THEME = THEMES.light;

function applyTheme(name) {
  const theme = THEMES[name];
  if (!theme) return;
  THEME = theme;

  const root = document.documentElement;
  root.setAttribute('data-theme', name);

  for (const [key, val] of Object.entries(theme)) {
    root.style.setProperty('--' + key, val);
  }

  localStorage.setItem('tcp-theme', name);

  // Update toggle icon if it exists
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = name === 'dark' ? '\u2600' : '\u263E';

  if (typeof draw === 'function') draw();
}

function getThemeName() {
  return localStorage.getItem('tcp-theme') || 'light';
}

function toggleTheme() {
  applyTheme(getThemeName() === 'dark' ? 'light' : 'dark');
}

// Apply immediately on load to prevent FOUC
applyTheme(getThemeName());
