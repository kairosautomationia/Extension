import type { RecordedAction, SavedFlow } from '../types';

export function describeAction(a: RecordedAction): string {
  switch (a.type) {
    case 'click':
      return `Clic en "${a.label}"`;
    case 'input':
      return `Escribir "${a.value ?? ''}" en "${a.label}"`;
    case 'select':
      return `Elegir "${a.value ?? ''}" en "${a.label}"`;
    case 'submit':
      return 'Enviar formulario';
    case 'key':
      return `Pulsar ${a.value ?? 'Enter'}${a.label ? ` en "${a.label}"` : ''}`;
    case 'scroll':
      return 'Desplazar la página';
    case 'capture':
      return 'Captura de pantalla';
    case 'navigate':
      try {
        const u = new URL(a.url);
        return `Ir a ${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
      } catch {
        return `Ir a ${a.url}`;
      }
  }
}

export function flowToPrompt(f: SavedFlow): string {
  const steps = f.actions.map((a, i) => `${i + 1}. ${describeAction(a)}`).join('\n');
  return `Repite este flujo en ${f.host}:\n${steps}`;
}

const KEY = 'hanzo.flows';
export const MAX_FLOWS = 200;
export const MAX_ACTIONS = 80;
const TYPES: RecordedAction['type'][] = ['click', 'input', 'select', 'submit', 'navigate', 'key', 'scroll', 'capture'];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const uid = () => Math.random().toString(36).slice(2, 10);

/** Normaliza una lista de etiquetas: sin vacías ni repetidas, máximo 5 de 20 caracteres. */
export function cleanTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const out: string[] = [];
  for (const t of raw) {
    const v = str(t, 40).replace(/^#/, '').trim().slice(0, 20);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= 5) break;
  }
  return out;
}

function cleanAction(x: unknown): RecordedAction | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (!TYPES.includes(a.type as RecordedAction['type'])) return null;
  const out: RecordedAction = {
    id: str(a.id, 24) || uid(),
    type: a.type as RecordedAction['type'],
    selector: str(a.selector, 400),
    label: str(a.label, 200),
    url: str(a.url, 600),
    t: typeof a.t === 'number' && Number.isFinite(a.t) ? a.t : Date.now(),
  };
  if (typeof a.value === 'string') out.value = a.value.slice(0, 2000);
  return out;
}

/** Valida un flujo que viene de fuera (archivo importado o almacenamiento): descarta lo que no tenga la forma esperada. */
export function cleanFlow(x: unknown): SavedFlow | null {
  if (!x || typeof x !== 'object') return null;
  const f = x as Record<string, unknown>;
  if (!Array.isArray(f.actions)) return null;
  const actions = f.actions.slice(0, MAX_ACTIONS).map(cleanAction).filter((a): a is RecordedAction => !!a);
  if (actions.length === 0) return null;
  const flow: SavedFlow = {
    id: str(f.id, 24) || uid(),
    title: str(f.title, 60).trim() || 'Flujo sin nombre',
    host: str(f.host, 120),
    createdAt: typeof f.createdAt === 'number' && Number.isFinite(f.createdAt) ? f.createdAt : Date.now(),
    actions,
  };
  const startUrl = str(f.startUrl, 600);
  if (/^https?:/i.test(startUrl)) flow.startUrl = startUrl;
  const description = str(f.description, 140).trim();
  if (description) flow.description = description;
  const tags = cleanTags(f.tags);
  if (tags.length) flow.tags = tags;
  if (typeof f.runs === 'number' && f.runs > 0 && Number.isFinite(f.runs)) flow.runs = Math.floor(f.runs);
  if (typeof f.lastRunAt === 'number' && Number.isFinite(f.lastRunAt)) flow.lastRunAt = f.lastRunAt;
  if (f.lastResult === 'ok' || f.lastResult === 'fail') flow.lastResult = f.lastResult;
  const note = str(f.lastNote, 200);
  if (note) flow.lastNote = note;
  return flow;
}

export function cleanFlows(list: unknown): SavedFlow[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: SavedFlow[] = [];
  for (const x of list) {
    const f = cleanFlow(x);
    if (!f) continue;
    while (seen.has(f.id)) f.id = uid();
    seen.add(f.id);
    out.push(f);
    if (out.length >= MAX_FLOWS) break;
  }
  return out;
}

export function loadFlows(): SavedFlow[] {
  try {
    return cleanFlows(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

const hasStore = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

/**
 * Guarda la biblioteca en dos sitios: localStorage (lectura inmediata al abrir el panel)
 * y chrome.storage.local (copia de respaldo del navegador). Devuelve false si no se pudo guardar.
 */
export function persistFlows(flows: SavedFlow[]): boolean {
  let ok = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(flows));
  } catch {
    ok = false;
  }
  if (hasStore()) {
    try {
      void chrome.storage.local.set({ [KEY]: flows }).catch(() => undefined);
      ok = true; // el respaldo basta para no perderlos
    } catch {
      /* sin respaldo */
    }
  }
  return ok;
}

/** Si localStorage quedó vacío pero hay respaldo en chrome.storage.local, lo recupera. */
export async function restoreFlows(): Promise<SavedFlow[]> {
  if (!hasStore()) return [];
  try {
    const r = (await chrome.storage.local.get(KEY)) as Record<string, unknown>;
    return cleanFlows(r[KEY]);
  } catch {
    return [];
  }
}

/** Archivo de exportación: un JSON con la versión y los flujos. */
export function exportFlows(flows: SavedFlow[]): string {
  return JSON.stringify({ hanzo: 'flujos', version: 1, exportedAt: Date.now(), flows }, null, 2);
}

/** Lee un archivo exportado (o una lista suelta de flujos). Los flujos importados reciben ids nuevos. */
export function parseImport(text: string): SavedFlow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : (data as { flows?: unknown })?.flows;
  return cleanFlows(list).map((f) => ({ ...f, id: uid() }));
}
