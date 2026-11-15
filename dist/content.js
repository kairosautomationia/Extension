// Burbuja "Preguntar a Hanzo" al seleccionar texto en una página.
// Solo lee la selección para mostrar la burbuja; el texto se envía a Hanzo únicamente si pulsas la burbuja.
(() => {
  if (window.__hanzoBubble) return;
  window.__hanzoBubble = true;

  // Mismos sitios donde Hanzo nunca actúa (banca y pagos): aquí la burbuja no aparece
  if (/(bank|banco|paypal|stripe|binance|coinbase|wise\.com|pichincha|produbanco|bolivariano|payphone|datafast|kushki|(^|\.)pay\.|checkout)/i.test(location.hostname)) return;

  const host = document.createElement('hanzo-bubble');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;display:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML =
    '<style>' +
    'button{all:initial;display:flex;align-items:center;gap:6px;cursor:pointer;box-sizing:border-box;height:30px;padding:0 12px 0 9px;' +
    'border-radius:999px;background:#1E3A5F;color:#fff;font:600 12.5px/1 system-ui,-apple-system,Segoe UI,sans-serif;' +
    'box-shadow:0 6px 18px rgba(15,28,58,.35),0 1px 3px rgba(15,28,58,.25);white-space:nowrap;user-select:none}' +
    'button:hover{background:#2c5282}button:focus-visible{outline:2px solid #96b8ee;outline-offset:2px}' +
    '</style>' +
    '<button type="button" aria-label="Preguntar a Hanzo">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>' +
    '<span>Preguntar a Hanzo</span></button>';
  const btn = root.querySelector('button');
  let current = '';

  const hide = () => {
    host.style.display = 'none';
    current = '';
  };

  const show = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return hide();
    // Nunca sobre campos de contraseña
    const a = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (a && a.closest && a.closest('input[type=password]')) return hide();
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return hide();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return hide();
    current = text.slice(0, 1000);
    if (!host.isConnected) document.documentElement.appendChild(host);
    host.style.display = 'block';
    const w = 160;
    const h = 30;
    let left = Math.min(Math.max(8, rect.right - w / 2), window.innerWidth - w - 8);
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  };

  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(show, 30);
  };

  document.addEventListener('mouseup', (e) => {
    if (e.composedPath && e.composedPath().indexOf(host) >= 0) return;
    schedule();
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') schedule();
    else if (e.key === 'Escape') hide();
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (e.composedPath && e.composedPath().indexOf(host) >= 0) return;
    hide();
  }, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);

  // mousedown dentro de la burbuja no debe borrar la selección
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    const text = current;
    hide();
    if (!text) return;
    try {
      chrome.runtime.sendMessage({ type: 'hanzo-ask', text });
    } catch (e) {
      /* la extensión se recargó: hay que recargar la página */
    }
  });
})();
