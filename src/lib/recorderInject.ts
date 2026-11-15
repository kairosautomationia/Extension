/**
 * Funciones que se INYECTAN en la página con chrome.scripting.executeScript.
 * Deben ser autocontenidas: no pueden referenciar nada fuera de su cuerpo.
 */

export function injectedStart() {
  const w = window as unknown as { __hanzoRec?: () => void };
  if (w.__hanzoRec) return; // ya está grabando en esta página

  const esc = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  const selectorOf = (el: Element): string => {
    if (el.id) return '#' + esc(el.id);
    const tid = el.getAttribute('data-testid');
    if (tid) return '[data-testid="' + tid + '"]';
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 4) {
      if (cur.id) {
        parts.unshift('#' + esc(cur.id));
        break;
      }
      let part = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const me = cur;
        const same = Array.from(parent.children).filter((c) => c.tagName === me.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(me) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };

  const labelOf = (el: Element): string => {
    // En un <select>, innerText sería la lista entera de opciones: se usa su <label> o su nombre
    const text =
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      (el.tagName === 'SELECT' ? '' : ((el as HTMLElement).innerText || '').trim()) ||
      ((el as HTMLInputElement).labels?.[0]?.innerText || '').trim() ||
      el.getAttribute('name') ||
      el.tagName.toLowerCase();
    return text.replace(/\s+/g, ' ').slice(0, 60);
  };

  const send = (a: Record<string, unknown>) => {
    try {
      chrome.runtime.sendMessage({ type: 'hanzo-action', action: { ...a, url: location.href, t: Date.now() } });
    } catch {
      /* la extensión se recargó */
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target || !target.closest) return;
    const el =
      target.closest('a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem]') ||
      target;
    // Los campos de texto, selects y casillas se registran con "change", no con el clic
    if (el.matches('textarea,select,input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image])')) return;
    send({ type: 'click', selector: selectorOf(el), label: labelOf(el) });
  };

  const onChange = (e: Event) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || !el.tagName) return;
    // Privacidad: nunca se guarda el valor de contraseñas, datos de pago ni identidad
    const ac = el.getAttribute('autocomplete') || '';
    const hint = [labelOf(el), el.name || '', el.id || '', ac].join(' ');
    const sensitive =
      el.type === 'password' ||
      el.type === 'file' ||
      /^cc-/.test(ac) ||
      ac === 'one-time-code' ||
      /(contrase|passw|clave|tarjeta|card|cvv|cvc|iban|cuenta banc|ssn|c[eé]dula|pasaporte|passport|otp|verificaci)/i.test(hint);
    const isToggle = el.type === 'checkbox' || el.type === 'radio';
    send({
      type: el.tagName === 'SELECT' ? 'select' : 'input',
      selector: selectorOf(el),
      label: labelOf(el),
      value: sensitive ? '******' : isToggle ? (el.checked ? 'marcado' : 'desmarcado') : String(el.value).slice(0, 200),
    });
  };

  const onSubmit = (e: Event) => {
    const el = e.target as Element;
    send({ type: 'submit', selector: selectorOf(el), label: 'Enviar formulario' });
  };

  // Enter fuera de un formulario (dentro de uno ya lo cubre "submit"; en botones y enlaces ya lo cubre el clic)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const el = e.target as Element | null;
    if (!el || !el.tagName || el.matches('textarea,button,a,summary,select,[role=button],[role=link]')) return;
    if (el.closest('form')) return;
    send({ type: 'key', selector: selectorOf(el), label: labelOf(el), value: 'Enter' });
  };

  // Desplazamiento: se anota la posición final cuando la página deja de moverse
  let scrollTimer: number | undefined;
  const onScroll = () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      send({ type: 'scroll', selector: '', label: 'Desplazar', value: String(Math.round(window.scrollY)) });
    }, 500);
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, { passive: true });

  w.__hanzoRec = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll);
    window.clearTimeout(scrollTimer);
    delete w.__hanzoRec;
  };
}

export function injectedStop() {
  const w = window as unknown as { __hanzoRec?: () => void };
  if (w.__hanzoRec) w.__hanzoRec();
}
