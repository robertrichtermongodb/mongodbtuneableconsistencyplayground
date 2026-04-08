const logEl = document.getElementById('event-log');

function log(msg, cls = 'info') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = `[${new Date().toLocaleTimeString()}]  ${msg}`;
  logEl.prepend(el);
}

function logStep(title, explainHtml, cls = 'info') {
  const el = document.createElement('div');
  el.className = `log-step ${cls}`;
  const ts = new Date().toLocaleTimeString();
  el.innerHTML =
    `<details class="log-details">` +
    `<summary>[${ts}]  \u25B6 ${title}</summary>` +
    `<div class="log-explain">${explainHtml}</div>` +
    `</details>`;
  logEl.prepend(el);
}
