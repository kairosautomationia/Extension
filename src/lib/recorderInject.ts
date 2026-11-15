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
    const text =
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      ((el as HTMLElement).innerText || '').trim() ||
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
    // Privacidad: nunca se guarda el valor de contraseñas ni de datos de pago
    const ac = el.getAttribute('autocomplete') || '';
    const sensitive = el.type === 'password' || /^cc-/.test(ac) || ac === 'one-time-code';
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

  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);

  w.__hanzoRec = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
    delete w.__hanzoRec;
  };
}

export function injectedStop() {
  const w = window as unknown as { __hanzoRec?: () => void };
  if (w.__hanzoRec) w.__hanzoRec();
}
