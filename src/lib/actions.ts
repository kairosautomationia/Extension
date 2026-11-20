/**
 * Acciones sobre la pestaña activa (clic, escribir, desplazar) con límites de seguridad.
 *
 * Las funciones `injected*` se INYECTAN en la página con chrome.scripting.executeScript:
 * deben ser autocontenidas (no pueden usar nada de fuera de su cuerpo).
 */
import { API_BASE, CONNECT_TIMEOUT_MS, TIMEOUT_MSG, withTimeout } from './api';

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
  type: 'click' | 'type' | 'scroll' | 'open' | 'done' | 'ask';
  id?: number;
  text?: string;
  url?: string;
  dir?: 'down' | 'up';
}
export interface ActPlan {
  say: string;
  action: ActAction;
  /** Lo nuevo e importante que el modelo leyó en esta vista (solo en tareas de lectura). */
  notes?: string;
}

/** ¿La tarea pide información de la página (resumir, leer, analizar…) y no solo hacer clics? */
export function wantsRead(task: string): boolean {
  return /(resum|\blee\b|\bleer\b|lectura|analiz|extra[eé]|extraer|\bdime\b|cu[eé]ntame|qu[eé] (dice|hay|trae|es|ofrece)|explica|revisa|compar|cu[aá]nt[oa]s?|lista(r)? |informaci[oó]n|datos |perfil|describe|encuentra|busca (en|dentro)|\bresumen\b)/i.test(task);
}

/** Mismo sitio (ignora subdominios: linkedin.com y www.linkedin.com cuentan igual). */
export function sameSite(a: string, b: string): boolean {
  // Dominios como empresa.com.ec o sitio.gob.ec usan tres partes
  const base = (h: string) => {
    const p = h.toLowerCase().replace(/^www\./, '').split('.');
    return p.slice(p.length > 2 && /^(com|gob|gov|edu|org|net|co|ac|mil)$/.test(p[p.length - 2]) ? -3 : -2).join('.');
  };
  return a === b || base(a) === base(b);
}

/** Pasos seguidos antes de preguntar si sigue; tope absoluto por tarea. */
export const STEP_BLOCK = 20;
export const MAX_STEPS = 60;

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

/** Sitios donde Hanzo nunca actúa (banca y pagos); la lista vive en `blocked.ts` para compartirla con `api.ts`. */
export { isBlockedHost } from './blocked';

export function describeAction(a: ActAction, el?: PageEl): string {
  const name = el ? `«${el.label || el.kind}»` : 'un elemento';
  if (a.type === 'click') return `hacer clic en ${name}`;
  if (a.type === 'type') return `escribir «${(a.text ?? '').slice(0, 80)}» en ${name}`;
  if (a.type === 'open') return `abrir ${(a.url ?? '').slice(0, 80)}`;
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

/** Id de la pestaña activa aunque no sea una página web (nueva pestaña, chrome://…). */
export async function activeTabId(): Promise<number | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ?? null;
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
    /** Tarea de lectura: el modelo recibe el texto visible y las notas acumuladas. */
    read?: boolean;
    view?: string;
    notes?: string[];
    /** Cierre de una tarea de lectura: el Worker redacta la respuesta final con las notas. */
    finalize?: boolean;
  },
  signal?: AbortSignal,
): Promise<ActPlan> {
  const t = withTimeout(signal, CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Partial<ActPlan> & { error?: string };
    if (!res.ok || !data.action) throw new Error(data.error ?? `Error ${res.status}`);
    return { say: String(data.say ?? ''), action: data.action, notes: typeof data.notes === 'string' ? data.notes : undefined };
  } catch (e) {
    if (t.timedOut()) throw new Error(TIMEOUT_MSG);
    throw e;
  } finally {
    t.done();
  }
}

/* ---------------- Funciones inyectadas en la página ---------------- */

/** Lee las tablas visibles de la página (solo lectura): cada una con su título y sus filas de texto. */
export function injectedTables(): { tables: { title: string; rows: string[][]; cut: boolean }[]; found: number } {
  const MAX_TABLES = 12;
  const MAX_ROWS = 2000;
  const MAX_COLS = 40;
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 400);
  const all = Array.from(document.querySelectorAll('table')).filter((t) => !t.closest('[data-hanzo-overlay]') && !t.parentElement?.closest('table'));
  const tables: { title: string; rows: string[][]; cut: boolean }[] = [];
  let found = 0;
  for (const t of all) {
    const st = getComputedStyle(t);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const rows: string[][] = [];
    let cut = false;
    for (const tr of Array.from(t.querySelectorAll('tr'))) {
      if (tr.closest('table') !== t) continue;
      if (rows.length >= MAX_ROWS + 1) {
        cut = true;
        break;
      }
      const row: string[] = [];
      for (const c of Array.from(tr.children)) {
        if (c.tagName !== 'TD' && c.tagName !== 'TH') continue;
        const span = Math.min(Math.max((c as HTMLTableCellElement).colSpan || 1, 1), 10);
        row.push(clean((c as HTMLElement).innerText || c.textContent || ''));
        for (let k = 1; k < span; k++) row.push('');
        if (row.length >= MAX_COLS) break;
      }
      if (row.some((x) => x)) rows.push(row.slice(0, MAX_COLS));
    }
    // Tablas de maquetación (una fila o una columna) no son datos
    if (rows.length < 2 || Math.max(...rows.map((r) => r.length)) < 2) continue;
    found++;
    if (tables.length >= MAX_TABLES) continue;
    let title = clean(t.querySelector('caption')?.textContent ?? '');
    for (let el: Element | null = t, hops = 0; !title && el && hops < 6; el = el.parentElement, hops++) {
      let p = el.previousElementSibling;
      for (let n = 0; p && n < 6; p = p.previousElementSibling, n++) {
        if (/^H[1-6]$/.test(p.tagName)) {
          title = clean(p.textContent ?? '');
          break;
        }
      }
    }
    tables.push({ title: title.slice(0, 60), rows, cut });
  }
  return { tables, found };
}

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
    if (el.closest('[data-hanzo-overlay]')) continue; // la barra de Hanzo no es parte de la página
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

  // Posición de lectura: la ventana o, si la página scrollea dentro de un panel (apps tipo Gmail/LinkedIn), ese panel
  const root = document.scrollingElement || document.documentElement;
  let sy = Math.round(window.scrollY);
  let smax = Math.max(0, Math.round(root.scrollHeight - window.innerHeight));
  if (smax <= 8) {
    let best: HTMLElement | null = null;
    let bs = 0;
    document.querySelectorAll<HTMLElement>('main,div,section,ul,[role="main"],[role="feed"]').forEach((e) => {
      const s = e.scrollHeight - e.clientHeight;
      if (s < 80 || e.clientHeight < 200 || s <= bs || e.closest('[data-hanzo-overlay]')) return;
      const oy = getComputedStyle(e).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') return;
      const r = e.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) return;
      best = e;
      bs = s;
    });
    if (best) {
      const b = best as HTMLElement;
      sy = Math.round(b.scrollTop);
      smax = Math.max(0, Math.round(b.scrollHeight - b.clientHeight));
    }
  }
  return { els, scrollY: sy, scrollMax: smax };
}

/** Texto que se ve ahora en pantalla (solo lectura): sirve para que el modelo analice lo que va viendo al desplazarse. */
export function injectedReadView(max: number): string {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let out: string[] = [];
  let len = 0;
  const range = document.createRange();
  const okCache = new Map<Element, boolean>();
  const visible = (el: Element | null): boolean => {
    if (!el) return false;
    const c = okCache.get(el);
    if (c !== undefined) return c;
    let ok = true;
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|TEMPLATE|INPUT|TEXTAREA|SELECT)$/i.test(el.tagName) || el.closest('[data-hanzo-overlay]')) ok = false;
    else {
      const cs = getComputedStyle(el);
      ok = cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    }
    okCache.set(el, ok);
    return ok;
  };
  // Se lee primero el contenido principal (<main>): deja fuera menús laterales, anuncios y sugerencias
  const collect = (root: Element) => {
  out = [];
  len = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let prevBlock: Element | null = null;
  for (let n = walker.nextNode(); n && len < max; n = walker.nextNode()) {
    const t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    const el = n.parentElement;
    if (!visible(el)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const block = el && (el.closest('p,li,h1,h2,h3,h4,h5,h6,tr,section,article,div') || el);
    if (out.length && block === prevBlock) out[out.length - 1] += ' ' + t;
    else out.push(t);
    prevBlock = block;
    len += t.length + 1;
  }
  };
  const main = document.querySelector('main, [role="main"]');
  if (main) collect(main);
  if (!main || len < 120) collect(document.body);
  // Líneas repetidas (menús, contadores) solo una vez
  const seen = new Set<string>();
  return out
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .join('\n')
    .slice(0, max);
}

type HzUi = { root: HTMLElement; cursor: HTMLElement; x: number; y: number; ttl?: ReturnType<typeof setTimeout> };

/** Dibuja un recuadro azul (celeste, como el grupo de pestañas Hanzo) con etiqueta sobre el elemento (id null = solo quita el recuadro). */
export function injectedHighlight(id: number | null, text: string): boolean {
  const w = window as unknown as { __hanzoBox?: HTMLElement };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;
  // Capa "Hanzo está trabajando": borde luminoso, barra con botón Detener y cursor animado
  const u = window as unknown as { __hanzoUi?: HzUi };
  if (!u.__hanzoUi || !u.__hanzoUi.root.isConnected) {
    const root = document.createElement('div');
    root.setAttribute('data-hanzo-overlay', '1');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const st = document.createElement('style');
    st.textContent =
      '@keyframes hz-glow{0%,100%{box-shadow:inset 0 0 0 2px rgba(74,163,255,.85),inset 0 0 28px rgba(74,163,255,.35)}50%{box-shadow:inset 0 0 0 2px rgba(74,163,255,.55),inset 0 0 14px rgba(74,163,255,.18)}}' +
      '@keyframes hz-dot{0%,100%{opacity:1}50%{opacity:.35}}' +
      '@keyframes hz-in{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '@keyframes hz-ripple{from{transform:translate(-50%,-50%) scale(.2);opacity:.85}to{transform:translate(-50%,-50%) scale(1.9);opacity:0}}' +
      '@keyframes hz-halo{0%,100%{transform:translate(-50%,-50%) scale(.85);opacity:.55}50%{transform:translate(-50%,-50%) scale(1.2);opacity:.2}}';
    root.appendChild(st);
    const glow = document.createElement('div');
    glow.style.cssText = 'position:absolute;inset:0;animation:hz-glow 2.4s ease-in-out infinite;';
    root.appendChild(glow);
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:999px;background:#0f1c3a;color:#fff;font:500 13px/1 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(15,28,58,.35);pointer-events:auto;animation:hz-in .18s ease-out;white-space:nowrap;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#4aa3ff;animation:hz-dot 1.2s ease-in-out infinite;';
    const label = document.createElement('span');
    label.textContent = 'Hanzo está trabajando en esta página';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Detener';
    btn.style.cssText =
      'all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font:600 12px/1 system-ui,sans-serif;';
    btn.onmouseenter = () => (btn.style.background = 'rgba(255,255,255,.22)');
    btn.onmouseleave = () => (btn.style.background = 'rgba(255,255,255,.12)');
    btn.onclick = () => {
      label.textContent = 'Deteniendo…';
      const quitar = () => {
        const ui = (window as unknown as { __hanzoUi?: HzUi }).__hanzoUi;
        if (ui) clearTimeout(ui.ttl);
        root.remove();
        (window as unknown as { __hanzoUi?: HzUi }).__hanzoUi = undefined;
      };
      try {
        // Si el panel ya no está abierto nadie escucha: la capa se retira sola para no quedar pegada en la página
        const p = chrome.runtime.sendMessage({ type: 'hanzo-stop' });
        // El panel responde true; si nadie responde (panel cerrado) o falla el envío, la capa se retira
        if (p && typeof p.then === 'function') p.then((r: unknown) => { if (!r) quitar(); }, quitar);
        else quitar();
      } catch {
        quitar(); // extensión recargada
      }
    };
    bar.append(dot, label, btn);
    root.appendChild(bar);
    const x0 = Math.round(window.innerWidth * 0.5);
    const y0 = Math.round(window.innerHeight * 0.62);
    const cursor = document.createElement('div');
    cursor.setAttribute('data-hz-cursor', '1');
    cursor.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;transform:translate(' + x0 + 'px,' + y0 + 'px);';
    cursor.innerHTML =
      '<div style="position:absolute;left:0;top:0;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,rgba(74,163,255,.55),rgba(74,163,255,0) 70%);animation:hz-halo 1.8s ease-in-out infinite;"></div>' +
      '<div data-hz-arrow="1" style="position:absolute;left:0;top:0;transform-origin:0 0;filter:drop-shadow(0 3px 5px rgba(11,37,69,.38));">' +
      '<svg width="22" height="30" viewBox="-1.5 -1.5 17 23" style="display:block"><defs><linearGradient id="hzg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#2f7ff0"/></linearGradient></defs>' +
      '<path d="M0 0 L0 17.2 L4.5 13.1 L7.5 19.8 L10.3 18.6 L7.4 12.1 L13.4 12.1 Z" fill="url(#hzg)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>' +
      '<div style="position:absolute;left:17px;top:22px;padding:4px 9px;border-radius:999px;background:linear-gradient(135deg,#5db4ff,#2f7ff0);color:#fff;font:600 11px/1 system-ui,-apple-system,sans-serif;letter-spacing:.2px;white-space:nowrap;box-shadow:0 4px 12px rgba(47,127,240,.45);">Hanzo</div>';
    root.appendChild(cursor);
    document.documentElement.appendChild(root);
    u.__hanzoUi = { root, cursor, x: x0, y: y0 };
  }

  // Seguro: si el panel se cierra o falla a mitad de una tarea, esta capa se retira sola (cada paso la renueva)
  clearTimeout(u.__hanzoUi.ttl);
  u.__hanzoUi.ttl = setTimeout(() => {
    const cur = (window as unknown as { __hanzoUi?: HzUi }).__hanzoUi;
    cur?.root.remove();
    (window as unknown as { __hanzoUi?: HzUi }).__hanzoUi = undefined;
    (window as unknown as { __hanzoBox?: HTMLElement }).__hanzoBox?.remove();
  }, 120000);

  if (id === null) return true;
  const el = document.querySelector<HTMLElement>('[data-hanzo-id="' + id + '"]');
  if (!el) return false;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  // El cursor de Hanzo viaja en arco suave hasta el elemento
  {
    const ui = u.__hanzoUi;
    const tx = Math.round(r.left + Math.min(r.width / 2, 40));
    const ty = Math.round(r.top + r.height / 2);
    const dx = tx - ui.x;
    const dy = ty - ui.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 2) {
      const dur = Math.min(620, Math.max(320, dist * 0.8));
      const mx = ui.x + dx * 0.5 - dy * 0.14;
      const my = ui.y + dy * 0.5 + dx * 0.14;
      const anim = ui.cursor.animate(
        [
          { transform: 'translate(' + ui.x + 'px,' + ui.y + 'px)' },
          { transform: 'translate(' + Math.round(mx) + 'px,' + Math.round(my) + 'px)', offset: 0.5 },
          { transform: 'translate(' + tx + 'px,' + ty + 'px)' },
        ],
        { duration: dur, easing: 'cubic-bezier(.45,0,.15,1)', fill: 'forwards' },
      );
      const cur = ui.cursor;
      anim.onfinish = () => {
        cur.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
        anim.cancel();
      };
    }
    ui.x = tx;
    ui.y = ty;
  }
  const box = document.createElement('div');
  box.setAttribute('data-hanzo-overlay', '1');
  box.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #4aa3ff;border-radius:6px;box-shadow:0 0 0 4px rgba(74,163,255,.30);';
  box.style.left = Math.round(r.left - 4) + 'px';
  box.style.top = Math.round(r.top - 4) + 'px';
  box.style.width = Math.round(r.width + 8) + 'px';
  box.style.height = Math.round(r.height + 8) + 'px';
  const tag = document.createElement('div');
  tag.textContent = text.slice(0, 70);
  tag.style.cssText =
    'position:absolute;left:0;background:#4aa3ff;color:#0b2545;font:600 12px/1 system-ui,sans-serif;padding:5px 8px;border-radius:5px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;';
  tag.style.top = r.top < 34 ? Math.round(r.height + 14) + 'px' : '-30px';
  box.appendChild(tag);
  document.documentElement.appendChild(box);
  w.__hanzoBox = box;
  return true;
}

/** Quita el recuadro y los números que Hanzo puso en la página. */
export function injectedClear(): boolean {
  const w = window as unknown as { __hanzoBox?: HTMLElement; __hanzoUi?: HzUi };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;
  if (w.__hanzoUi) clearTimeout((w.__hanzoUi as HzUi).ttl);
  w.__hanzoUi?.root.remove();
  w.__hanzoUi = undefined;
  document.querySelectorAll('[data-hanzo-id]').forEach((e) => e.removeAttribute('data-hanzo-id'));
  return true;
}

/** Ejecuta UNA acción. Vuelve a comprobar en la página que el campo no sea sensible. */
export function injectedAct(a: ActAction): { ok: boolean; msg: string } {
  const SENSITIVE = /(contrase|passw|clave|tarjeta|card|cvv|cvc|iban|cuenta banc|ssn|c[eé]dula|pasaporte|passport|otp|verificaci)/i;
  const w = window as unknown as { __hanzoBox?: HTMLElement; __hanzoUi?: HzUi };
  w.__hanzoBox?.remove();
  w.__hanzoBox = undefined;
  // Clic del cursor de Hanzo: se hunde y suelta dos ondas
  if (w.__hanzoUi && (a.type === 'click' || a.type === 'type')) {
    const ui = w.__hanzoUi;
    ui.cursor
      .querySelector('[data-hz-arrow]')
      ?.animate([{ transform: 'scale(1)' }, { transform: 'scale(.78)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    [0, 110].forEach((delay, i) => {
      const rip = document.createElement('div');
      rip.style.cssText =
        'position:absolute;width:' + (i ? 46 : 34) + 'px;height:' + (i ? 46 : 34) + 'px;border-radius:50%;opacity:0;border:2px solid rgba(74,163,255,' + (i ? '.55' : '.95') + ');background:rgba(74,163,255,' + (i ? '0' : '.18') + ');animation:hz-ripple .6s ease-out ' + delay + 'ms forwards;';
      rip.style.left = ui.x + 'px';
      rip.style.top = ui.y + 'px';
      ui.root.appendChild(rip);
      setTimeout(() => rip.remove(), 800);
    });
  }

  if (a.type === 'scroll') {
    const dy = (a.dir === 'up' ? -1 : 1) * Math.round(window.innerHeight * 0.8);
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight - window.innerHeight > 8) {
      window.scrollBy(0, dy);
    } else {
      // La página scrollea dentro de un panel: se desplaza el panel más largo que se ve
      let best: HTMLElement | null = null;
      let bs = 0;
      document.querySelectorAll<HTMLElement>('main,div,section,ul,[role="main"],[role="feed"]').forEach((e) => {
        const s = e.scrollHeight - e.clientHeight;
        if (s < 80 || e.clientHeight < 200 || s <= bs || e.closest('[data-hanzo-overlay]')) return;
        const oy = getComputedStyle(e).overflowY;
        if (oy !== 'auto' && oy !== 'scroll') return;
        const r = e.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= window.innerHeight) return;
        best = e;
        bs = s;
      });
      if (best) (best as HTMLElement).scrollBy(0, dy);
      else window.scrollBy(0, dy);
    }
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
