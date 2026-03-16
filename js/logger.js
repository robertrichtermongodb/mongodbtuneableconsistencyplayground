const logEl = document.getElementById('log');

function log(msg, cls = 'info') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = `[${new Date().toLocaleTimeString()}]  ${msg}`;
  logEl.prepend(el);
}
