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
    '.w{position:relative;display:block;animation:in .14s ease-out}.w.dn{animation-name:ind}' +
    '@keyframes in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}' +
    '@keyframes ind{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}' +
    '.ar{position:absolute;left:var(--ax,50%);width:10px;height:10px;margin-left:-5px;background:#1E3A5F;transform:rotate(45deg);border-radius:2px;bottom:-4px}' +
    '.w.dn .ar{bottom:auto;top:-4px}' +
    'button{all:initial;position:relative;display:flex;align-items:center;gap:6px;cursor:pointer;box-sizing:border-box;height:30px;padding:0 12px 0 9px;' +
    'border-radius:999px;background:#1E3A5F;color:#fff;font:600 12.5px/1 system-ui,-apple-system,Segoe UI,sans-serif;' +
    'box-shadow:0 6px 18px rgba(15,28,58,.35),0 1px 3px rgba(15,28,58,.25);white-space:nowrap;user-select:none}' +
    'button:hover{background:#2c5282}button:focus-visible{outline:2px solid #96b8ee;outline-offset:2px}' +
    '</style>' +
    '<div class="w"><span class="ar"></span><button type="button" aria-label="Preguntar a Hanzo">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>' +
    '<span>Preguntar a Hanzo</span></button></div>';
  const btn = root.querySelector('button');
  const wrap = root.querySelector('.w');
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
    const w = btn.offsetWidth || 160;
    const h = btn.offsetHeight || 30;
    const gap = 12;
    // Primera línea real de la selección (se ignoran rectángulos vacíos o de bloques enteros)
    const list = Array.prototype.slice.call(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 1 && r.height > 1 && r.height < 120);
    const first = list.length ? list[0] : rect;
    const cx = first.left + Math.min(first.width, 140) / 2;
    const left = Math.min(Math.max(10, cx - w / 2), Math.max(10, window.innerWidth - w - 10));
    let top = first.top - h - gap;
    const below = top < 10;
    if (below) top = Math.min(rect.bottom + gap, Math.max(10, window.innerHeight - h - 10));
    wrap.classList.toggle('dn', below);
    wrap.style.setProperty('--ax', Math.round(Math.min(Math.max(18, cx - left), w - 18)) + 'px');
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  };

  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(safeShow, 30);
  };

  const safeShow = () => { try { show(); } catch (e) { hide(); } };
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
      try { chrome.runtime.sendMessage({ type: 'hanzo-ask', text }).catch(() => {}); } catch (e) { /* extensión recargada */ }
    } catch (e) {
      /* la extensión se recargó: hay que recargar la página */
    }
  });
})();

// Botón fijo "Pregúntale a Hanzo" (arriba a la derecha de la página), como el de Gemini en Chrome.
// Al pulsarlo abre el panel de Hanzo. No lee la página ni envía nada: solo pide abrir el panel.
// La "x" (aparece al pasar el mouse) lo oculta en esta pestaña hasta que la cierres.
(() => {
  if (window.__hanzoPill) return;
  window.__hanzoPill = true;
  if (window.top !== window) return;
  if (/(bank|banco|paypal|stripe|binance|coinbase|wise\.com|pichincha|produbanco|bolivariano|payphone|datafast|kushki|(^|\.)pay\.|checkout)/i.test(location.hostname)) return;
  try { if (sessionStorage.getItem('hanzoPillOff') === '1') return; } catch (e) { /* sin acceso al almacenamiento */ }

  const host = document.createElement('hanzo-pill');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;top:12px;right:18px;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML =
    '<style>' +
    '.p{position:relative;display:flex;align-items:center;animation:in .2s ease-out}' +
    '@keyframes in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.p{animation:none}}' +
    'button{all:initial;box-sizing:border-box;cursor:pointer;user-select:none;-webkit-user-select:none}' +
    '.go{display:flex;align-items:center;gap:8px;height:34px;padding:0 15px 0 8px;border-radius:999px;background:#1E3A5F;color:#fff;' +
    'font:600 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;white-space:nowrap;border:1px solid rgba(255,255,255,.18);' +
    'box-shadow:0 4px 14px rgba(15,28,58,.28),0 1px 2px rgba(15,28,58,.22)}' +
    '.go:hover{background:#2c5282}.go:active{transform:scale(.97)}' +
    '.go:focus-visible,.x:focus-visible{outline:2px solid #96b8ee;outline-offset:2px}' +
    '.ic{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.14)}' +
    '.x{position:absolute;top:-7px;right:-7px;width:18px;height:18px;border-radius:50%;background:#fff;color:#1E3A5F;display:flex;align-items:center;' +
    'justify-content:center;font:700 12px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35);opacity:0;transition:opacity .12s}' +
    '.p:hover .x,.x:focus-visible{opacity:1}' +
    '</style>' +
    '<div class="p"><button type="button" class="go" aria-label="Pregúntale a Hanzo">' +
    '<span class="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></span>' +
    '<span>Pregúntale a Hanzo</span></button>' +
    '<button type="button" class="x" aria-label="Ocultar el botón en esta pestaña" title="Ocultar en esta pestaña">×</button></div>';

  root.querySelector('.go').addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'hanzo-open' }).catch(() => {}); } catch (e) { /* extensión recargada: recarga la página */ }
  });
  root.querySelector('.x').addEventListener('click', () => {
    try { sessionStorage.setItem('hanzoPillOff', '1'); } catch (e) { /* sin almacenamiento */ }
    cerrado = true;
    host.remove();
  });

  let cerrado = false;
  const montar = () => { if (!cerrado && !host.isConnected && document.documentElement) document.documentElement.appendChild(host); };
  montar();
  // Algunas webs reescriben el <html>/<body>: si el botón se cae, se vuelve a poner
  const obs = new MutationObserver(montar);
  obs.observe(document, { childList: true });
  obs.observe(document.documentElement, { childList: true });
})();
