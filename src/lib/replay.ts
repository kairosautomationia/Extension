/**
 * Repetición de acciones grabadas sobre la pestaña activa.
 *
 * Las funciones `injected*` se INYECTAN en la página con chrome.scripting.executeScript:
 * deben ser autocontenidas (no pueden usar nada de fuera de su cuerpo).
 * El riesgo (normal / alto / bloqueado) lo calcula la extensión en la página, nunca el modelo.
 */
import type { Risk } from './actions';

export interface FindRes {
  found: boolean;
  risk: Risk;
  label: string;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Misma URL ignorando el #fragmento. */
export function sameUrl(a: string, b: string): boolean {
  const cut = (u: string) => u.split('#')[0];
  return cut(a) === cut(b);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera a que la pestaña termine de cargar (máx. `ms`). */
export async function waitReady(tabId: number, ms = 10000): Promise<boolean> {
  const t0 = Date.now();
  await pause(250); // da tiempo a que empiece una navegación recién provocada
  while (Date.now() - t0 < ms) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete') return true;
    } catch {
      return false;
    }
    await pause(250);
  }
  return false;
}

/**
 * Busca el elemento grabado (por selector; si no coincide, por su etiqueta) y lo marca con data-hanzo-id="0".
 * Calcula su riesgo. Si el selector apunta a algo con otra etiqueta, no se fía y busca por etiqueta.
 */
export function injectedFind(a: { selector: string; label: string; type: string }): FindRes {
  const SENSITIVE = /(contrase|passw|clave|tarjeta|card|cvv|cvc|iban|cuenta banc|ssn|c[eé]dula|pasaporte|passport|otp|verificaci)/i;
  const RISKY = /(pagar|pago|comprar|compra|enviar|eliminar|borrar|confirmar|publicar|suscrib|finalizar|pedido|checkout|submit|\bpay\b|\bbuy\b|delete|remove|\bsend\b|order|\bpost\b|publish|confirm|cerrar sesi|sign out|log ?out|transfer)/i;

  document.querySelectorAll('[data-hanzo-id]').forEach((e) => e.removeAttribute('data-hanzo-id'));
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const labelOf = (el: Element): string =>
    (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      (el.tagName === 'SELECT' ? '' : (el as HTMLElement).innerText?.trim()) ||
      (el as HTMLInputElement).labels?.[0]?.innerText?.trim() ||
      el.getAttribute('name') ||
      el.tagName.toLowerCase()
    )
      .replace(/\s+/g, ' ')
      .slice(0, 60);
  const want = norm(a.label || '');
  const agrees = (el: Element) => {
    if (!want) return true;
    const got = norm(labelOf(el));
    return got === want || got.includes(want) || want.includes(got);
  };

  let el: Element | null = null;
  if (a.selector) {
    try {
      el = document.querySelector(a.selector);
    } catch {
      el = null;
    }
    // Un #id o data-testid es estable; los demás selectores se confirman con la etiqueta
    const stable = a.type === 'submit' || /^#/.test(a.selector) || /^\[data-testid/.test(a.selector);
    if (el && !stable && !agrees(el)) el = null;
  }
  if (!el && want) {
    const cands = Array.from(
      document.querySelectorAll(
        'a,button,input,select,textarea,summary,label,form,[role=button],[role=link],[role=tab],[role=menuitem],[contenteditable]',
      ),
    );
    el = cands.find((c) => norm(labelOf(c)) === want && (c as HTMLElement).getBoundingClientRect().width > 0) || null;
  }
  if (!el) return { found: false, risk: 'normal', label: a.label };

  const input = el as HTMLInputElement;
  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? (input.type || 'text').toLowerCase() : '';
  const isField = tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
  const auto = el.getAttribute('autocomplete') || '';
  const label = labelOf(el);
  const hint = [label, input.name || '', input.id || '', auto].join(' ');

  let risk: Risk = 'normal';
  if (isField && (type === 'password' || type === 'file' || SENSITIVE.test(hint) || /^cc-/.test(auto))) risk = 'blocked';
  else if (a.type === 'submit' || type === 'submit' || (tag === 'button' && (el as HTMLButtonElement).type === 'submit' && !!el.closest('form')) || (!isField && RISKY.test(label))) risk = 'high';

  el.setAttribute('data-hanzo-id', '0');
  return { found: true, risk, label };
}

/** Ejecuta UNA acción grabada sobre el elemento marcado por injectedFind. */
export function injectedReplayAct(a: { type: string; value?: string }): { ok: boolean; msg: string } {
  const SENSITIVE = /(contrase|passw|clave|tarjeta|card|cvv|cvc|iban|cuenta banc|ssn|c[eé]dula|pasaporte|passport|otp|verificaci)/i;
  const w = window as unknown as { __hanzoBox?: HTMLElement };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;

  const el = document.querySelector<HTMLElement>('[data-hanzo-id="0"]');
  if (!el) return { ok: false, msg: 'El elemento ya no existe en la página' };
  const input = el as HTMLInputElement;
  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? (input.type || 'text').toLowerCase() : '';
  const isField = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  const auto = el.getAttribute('autocomplete') || '';
  const hint = [input.name || '', input.id || '', el.getAttribute('aria-label') || '', input.placeholder || '', auto].join(' ');
  if (isField && (type === 'password' || type === 'file' || SENSITIVE.test(hint) || /^cc-/.test(auto))) {
    return { ok: false, msg: 'Campo sensible: bloqueado por seguridad' };
  }
  el.scrollIntoView({ block: 'center', inline: 'center' });

  if (a.type === 'click') {
    // Los enlaces se abren en la misma pestaña: Hanzo solo trabaja en la pestaña activa.
    if (tag === 'a') (el as HTMLAnchorElement).target = '_self';
    el.click();
    return { ok: true, msg: 'Clic hecho' };
  }

  if (a.type === 'submit') {
    const form = (el.tagName === 'FORM' ? el : el.closest('form')) as HTMLFormElement | null;
    if (!form) return { ok: false, msg: 'No hay formulario que enviar' };
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return { ok: true, msg: 'Formulario enviado' };
  }

  if (a.type === 'key') {
    el.focus();
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return { ok: true, msg: 'Tecla pulsada' };
  }

  if (a.type === 'select' || a.type === 'input') {
    const text = String(a.value ?? '').slice(0, 500);
    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      const want = text.trim().toLowerCase();
      const opts = Array.from(sel.options);
      const opt =
        opts.find((o) => o.value === text) ||
        opts.find((o) => o.text.trim().toLowerCase() === want) ||
        opts.find((o) => o.text.toLowerCase().includes(want));
      if (!opt) return { ok: false, msg: 'No existe esa opción en la lista' };
      sel.value = opt.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, msg: 'Opción elegida' };
    }
    if (type === 'checkbox' || type === 'radio') {
      const wantOn = text === 'marcado';
      if (input.checked !== wantOn) input.click();
      return { ok: true, msg: wantOn ? 'Marcado' : 'Desmarcado' };
    }
    const textTypes = ['text', 'search', 'email', 'tel', 'url', 'number', ''];
    if (tag === 'textarea' || (tag === 'input' && textTypes.indexOf(type) >= 0)) {
      el.focus();
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) return { ok: false, msg: 'No se pudo escribir en el campo' };
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, msg: 'Texto escrito' };
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, msg: 'Texto escrito' };
    }
    return { ok: false, msg: 'Este elemento no admite texto' };
  }

  return { ok: false, msg: 'Acción no válida' };
}

/** Lleva la página a la posición de desplazamiento grabada. */
export function injectedScrollTo(y: number): boolean {
  window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
  return true;
}
