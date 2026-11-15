/**
 * Acciones sobre la pestaña activa (clic, escribir, desplazar) con límites de seguridad.
 *
 * Las funciones `injected*` se INYECTAN en la página con chrome.scripting.executeScript:
 * deben ser autocontenidas (no pueden usar nada de fuera de su cuerpo).
 */
import { API_BASE } from './api';

export type Risk = 'normal' | 'high' | 'blocked';

export interface PageEl {
  id: number;
  tag: string;
  kind: string;
  label: string;
  value?: string;
  risk: Risk;
}
export interface Snapshot {
  els: PageEl[];
  scrollY: number;
  scrollMax: number;
}
export interface ActAction {
  type: 'click' | 'type' | 'scroll' | 'done' | 'ask';
  id?: number;
  text?: string;
  dir?: 'down' | 'up';
}
export interface ActPlan {
  say: string;
  action: ActAction;
}

export const MAX_STEPS = 12;

/** Tarea explícita: "/hacer …" (también "/accion" o "/acción"). Devuelve null si no lo es. */
export function parseTask(t: string): string | null {
  const m = t.match(/^\s*\/(?:hacer|accion|acci[oó]n)\b\s*([\s\S]*)$/i);
  return m ? m[1].trim() : null;
}

/** Separa el comando del resto: "/hacer abre X" → { head:'', cmd:'/hacer', rest:' abre X' }. */
export function splitCommand(t: string): { head: string; cmd: string; rest: string } | null {
  const m = t.match(/^(\s*)(\/(?:hacer|accion|acci[oó]n))(?=\s|$)([\s\S]*)$/i);
  return m ? { head: m[1], cmd: m[2], rest: m[3] } : null;
}

/** Sitios donde Hanzo nunca actúa (banca y pagos). */
export function isBlockedHost(host: string): boolean {
  return /(bank|banco|paypal|stripe|binance|coinbase|wise\.com|pichincha|produbanco|bolivariano|payphone|datafast|kushki|(^|\.)pay\.|checkout)/i.test(host);
}

export function describeAction(a: ActAction, el?: PageEl): string {
  const name = el ? `«${el.label || el.kind}»` : 'un elemento';
  if (a.type === 'click') return `hacer clic en ${name}`;
  if (a.type === 'type') return `escribir «${(a.text ?? '').slice(0, 80)}» en ${name}`;
  if (a.type === 'scroll') return a.dir === 'up' ? 'desplazar la página hacia arriba' : 'desplazar la página hacia abajo';
  return 'terminar';
}

export interface TabState {
  id: number;
  url: string;
  title: string;
  host: string;
}

/** Estado de una pestaña; null si no es una página web normal (http/https). */
export async function tabState(tabId?: number): Promise<TabState | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting?.executeScript) return null;
    const tab = tabId === undefined ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] : await chrome.tabs.get(tabId);
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return null;
    return { id: tab.id, url: tab.url, title: tab.title ?? '', host: new URL(tab.url).hostname };
  } catch {
    return null;
  }
}

export async function inTab<A extends unknown[], R>(tabId: number, func: (...a: A) => R, args: A): Promise<R | undefined> {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result as unknown as R | undefined;
}

/** Pide al Worker la siguiente acción (una sola). */
export async function requestAct(
  body: {
    task: string;
    page: { title: string; url: string };
    elements: PageEl[];
    history: string[];
    scroll: { y: number; max: number };
  },
  signal?: AbortSignal,
): Promise<ActPlan> {
  const res = await fetch(`${API_BASE}/api/act`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ActPlan> & { error?: string };
  if (!res.ok || !data.action) throw new Error(data.error ?? `Error ${res.status}`);
  return { say: String(data.say ?? ''), action: data.action };
}

/* ---------------- Funciones inyectadas en la página ---------------- */

/** Lista los elementos interactivos visibles y les pone un número (data-hanzo-id). */
export function injectedSnapshot(): Snapshot {
  const SENSITIVE = /(contrase|passw|clave|tarjeta|card|cvv|cvc|iban|cuenta banc|ssn|c[eé]dula|pasaporte|passport|otp|verificaci)/i;
  const RISKY = /(pagar|pago|comprar|compra|enviar|eliminar|borrar|confirmar|publicar|suscrib|finalizar|pedido|checkout|submit|\bpay\b|\bbuy\b|delete|remove|\bsend\b|order|\bpost\b|publish|confirm|cerrar sesi|sign out|log ?out|transfer)/i;

  document.querySelectorAll('[data-hanzo-id]').forEach((e) => e.removeAttribute('data-hanzo-id'));
  const nodes = document.querySelectorAll<HTMLElement>(
    'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[role="menuitem"],[contenteditable="true"],[contenteditable=""]',
  );
  const els: PageEl[] = [];
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  for (const el of Array.from(nodes)) {
    if (els.length >= 60) break;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
    const input = el as HTMLInputElement;
    if (input.disabled) continue;

    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (input.type || 'text').toLowerCase() : '';
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    const auto = el.getAttribute('autocomplete') || '';
    const label = (
      el.getAttribute('aria-label') ||
      el.innerText ||
      input.placeholder ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      input.name ||
      (tag === 'input' ? input.value : '') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    let risk: Risk = 'normal';
    const hint = [label, input.name || '', input.id || '', auto].join(' ');
    if (isField && (type === 'password' || type === 'file' || SENSITIVE.test(hint) || /^cc-/.test(auto))) risk = 'blocked';
    else if (type === 'submit' || (tag === 'button' && (el as HTMLButtonElement).type === 'submit' && !!el.closest('form')) || (!isField && RISKY.test(label))) risk = 'high';

    const item: PageEl = { id: els.length, tag, kind: tag === 'input' ? type : el.getAttribute('role') || tag, label, risk };
    if (isField && risk !== 'blocked' && tag !== 'select') {
      const v = (tag === 'input' || tag === 'textarea' ? input.value : el.innerText) || '';
      if (v) item.value = v.slice(0, 40);
    }
    el.setAttribute('data-hanzo-id', String(item.id));
    els.push(item);
  }

  return {
    els,
    scrollY: Math.round(window.scrollY),
    scrollMax: Math.max(0, Math.round(document.documentElement.scrollHeight - window.innerHeight)),
  };
}

/** Dibuja un recuadro naranja con etiqueta sobre el elemento (id null = solo quita el recuadro). */
export function injectedHighlight(id: number | null, text: string): boolean {
  const w = window as unknown as { __hanzoBox?: HTMLElement };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;
  if (id === null) return true;
  const el = document.querySelector<HTMLElement>('[data-hanzo-id="' + id + '"]');
  if (!el) return false;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.setAttribute('data-hanzo-overlay', '1');
  box.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ff5a1f;border-radius:6px;box-shadow:0 0 0 4px rgba(255,90,31,.25);';
  box.style.left = Math.round(r.left - 4) + 'px';
  box.style.top = Math.round(r.top - 4) + 'px';
  box.style.width = Math.round(r.width + 8) + 'px';
  box.style.height = Math.round(r.height + 8) + 'px';
  const tag = document.createElement('div');
  tag.textContent = text.slice(0, 70);
  tag.style.cssText =
    'position:absolute;left:0;background:#ff5a1f;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:5px 8px;border-radius:5px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;';
  tag.style.top = r.top < 34 ? Math.round(r.height + 14) + 'px' : '-30px';
  box.appendChild(tag);
  document.documentElement.appendChild(box);
  w.__hanzoBox = box;
  return true;
}

/** Quita el recuadro y los números que Hanzo puso en la página. */
export function injectedClear(): boolean {
  const w = window as unknown as { __hanzoBox?: HTMLElement };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;
  document.querySelectorAll('[data-hanzo-id]').forEach((e) => e.removeAttribute('data-hanzo-id'));
  return true;
}

/** Ejecuta UNA acción. Vuelve a comprobar en la página que el campo no sea sensible. */
export function injectedAct(a: ActAction): { ok: boolean; msg: string } {
  const SENSITIVE = /(contrase|passw|clave|tarjeta|card|cvv|cvc|iban|cuenta banc|ssn|c[eé]dula|pasaporte|passport|otp|verificaci)/i;
  const w = window as unknown as { __hanzoBox?: HTMLElement };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;

  if (a.type === 'scroll') {
    window.scrollBy(0, (a.dir === 'up' ? -1 : 1) * Math.round(window.innerHeight * 0.8));
    return { ok: true, msg: 'Desplazado' };
  }

  const el = document.querySelector<HTMLElement>('[data-hanzo-id="' + a.id + '"]');
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

  if (a.type === 'click') {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    // Los enlaces se abren en la misma pestaña: Hanzo solo trabaja en la pestaña activa.
    if (tag === 'a') (el as HTMLAnchorElement).target = '_self';
    el.click();
    return { ok: true, msg: 'Clic hecho' };
  }

  if (a.type === 'type') {
    const text = String(a.text ?? '').slice(0, 500);
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      const want = text.trim().toLowerCase();
      const opts = Array.from(sel.options);
      const opt = opts.find((o) => o.text.trim().toLowerCase() === want) || opts.find((o) => o.text.toLowerCase().includes(want));
      if (!opt) return { ok: false, msg: 'No existe esa opción en la lista' };
      sel.value = opt.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, msg: 'Opción elegida' };
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
