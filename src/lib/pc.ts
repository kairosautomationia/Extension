/**
 * /pc: Hanzo maneja apps de escritorio de Windows a través de "Hanzo PC", un componente Python local
 * que Chrome arranca por native messaging (ver carpeta pc-host del proyecto).
 */
import { API_BASE, CONNECT_TIMEOUT_MS, TIMEOUT_MSG, withTimeout } from './api';

export const PC_HOST = 'com.kairos.hanzo_pc';
export const PC_MAX_STEPS = 15;

export interface PcEl {
  id: number;
  kind: string;
  label: string;
  value?: string | null;
  risk: 'normal' | 'high' | 'blocked';
}
export interface PcWindow {
  id: number;
  title: string;
  app: string;
}
export interface PcSnapshot {
  window: { title: string; app: string } | null;
  windows: PcWindow[];
  els: PcEl[];
}
export type PcType = 'open' | 'focus' | 'click' | 'type' | 'key' | 'find_file' | 'excel_read' | 'excel_write' | 'done' | 'ask';
export interface PcAction {
  type: PcType;
  app?: string;
  window?: number;
  id?: number;
  text?: string;
  keys?: string;
  name?: string;
  path?: string;
  cell?: string;
  sheet?: string;
}
export interface PcPlan {
  say: string;
  action: PcAction;
}

/** Tarea de escritorio: "/pc …" (también "/escritorio"). Devuelve null si no lo es. */
export function parsePc(t: string): string | null {
  const m = t.match(/^\s*\/(?:pc|escritorio)\b\s*([\s\S]*)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Orden clara de usar una app de escritorio escrita en el chat sin comando ("abre Excel y…").
 * Es estricta a propósito: "¿cómo uso Excel?" sigue siendo una pregunta normal.
 */
export function autoDesktop(t: string): string | null {
  const re =
    /^\s*(?:hanzo[,:]?\s+)?(?:por\s+favor[,]?\s+)?(?:abre|abrir|[aá]breme|inicia|ejecuta|lanza)\s+(?:el\s+|la\s+|un\s+|una\s+|mi\s+)?(?:bloc\s+de\s+notas|notepad|excel|word|paint)\b/i;
  return re.test(t) ? t.trim() : null;
}

/** Error al conectar: falta instalar, ID distinto o el componente se cerró. */
export class PcError extends Error {
  constructor(
    message: string,
    public kind: 'missing' | 'forbidden' | 'closed' | 'timeout' | 'host',
  ) {
    super(message);
  }
}

/** Conexión con Hanzo PC (un proceso por tarea). Cerrarla corta cualquier acción pendiente. */
export class PcConn {
  private port: chrome.runtime.Port | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closedErr: PcError | null = null;

  connect(): void {
    this.port = chrome.runtime.connectNative(PC_HOST);
    this.port.onMessage.addListener((msg: Record<string, unknown>) => {
      const p = this.pending.get(Number(msg.id));
      if (!p) return;
      this.pending.delete(Number(msg.id));
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg);
      else p.reject(new PcError(String(msg.error ?? 'Error en Hanzo PC'), 'host'));
    });
    this.port.onDisconnect.addListener(() => {
      const raw = chrome.runtime.lastError?.message ?? '';
      this.closedErr = /not found/i.test(raw)
        ? new PcError('Hanzo PC no está instalado en esta computadora.', 'missing')
        : /forbidden/i.test(raw)
          ? new PcError('Hanzo PC está instalado para otro ID de extensión.', 'forbidden')
          : new PcError(raw ? `Hanzo PC se cerró: ${raw}` : 'Hanzo PC se cerró.', 'closed');
      this.port = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(this.closedErr);
      }
      this.pending.clear();
    });
  }

  call(op: string, args: Record<string, unknown> = {}, timeoutMs = 20000): Promise<Record<string, unknown>> {
    if (!this.port) return Promise.reject(this.closedErr ?? new PcError('Hanzo PC no está conectado.', 'closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PcError('Hanzo PC no respondió a tiempo.', 'timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port!.postMessage({ ...args, id, op });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(this.closedErr ?? new PcError('Hanzo PC se cerró.', 'closed'));
      }
    });
  }

  close(): void {
    try {
      this.port?.disconnect();
    } catch {
      /* ya cerrado */
    }
    this.port = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new PcError('Detenido.', 'closed'));
    }
    this.pending.clear();
  }
}

/** Instrucciones de instalación con el ID real de esta extensión. */
export function installHelp(kind: PcError['kind']): string {
  const id = chrome.runtime?.id ?? '(ID de la extensión)';
  const head =
    kind === 'forbidden'
      ? 'Hanzo PC está instalado, pero para otro ID de extensión (pasa si moviste la carpeta de la extensión).'
      : 'Para manejar apps de escritorio necesito **Hanzo PC** instalado en esta computadora (una sola vez).';
  return `${head}\n\n1. Abre la carpeta **pc-host** del proyecto.\n2. Doble clic en **instalar.bat**.\n3. Cuando lo pida, pega este ID:\n\n**${id}**\n\nDespués vuelve a pedirme la tarea con /pc.`;
}

/** Pide al Worker la siguiente acción de escritorio (una sola). */
export async function requestPc(
  body: { task: string; window: PcSnapshot['window']; windows: PcWindow[]; elements: PcEl[]; apps: string[]; folders: string[]; history: string[] },
  signal?: AbortSignal,
): Promise<PcPlan> {
  const t = withTimeout(signal, CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/pc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Partial<PcPlan> & { error?: string };
    if (!res.ok || !data.action) throw new Error(data.error ?? `Error ${res.status}`);
    return { say: String(data.say ?? ''), action: data.action };
  } catch (e) {
    if (t.timedOut()) throw new Error(TIMEOUT_MSG);
    throw e;
  } finally {
    t.done();
  }
}

const RISKY_KEYS = new Set(['delete', 'supr', 'alt+f4', 'ctrl+w', 'shift+delete', 'ctrl+d', 'ctrl+x']);

/** Acciones que siempre piden aprobación, aunque el modo sea Automático. */
export function pcRisky(a: PcAction, el?: PcEl): boolean {
  if (a.type === 'excel_write') return true;
  if (a.type === 'key') return RISKY_KEYS.has((a.keys ?? '').toLowerCase());
  return el?.risk === 'high';
}

export function describePc(a: PcAction, el?: PcEl, win?: PcWindow): string {
  const name = el ? `«${el.label || el.kind}»` : 'un elemento';
  switch (a.type) {
    case 'open':
      return `abrir ${a.app}`;
    case 'focus':
      return `cambiar a la ventana «${win?.title ?? a.window}»`;
    case 'click':
      return `hacer clic en ${name}`;
    case 'type':
      return `escribir «${(a.text ?? '').slice(0, 80)}» en ${name}`;
    case 'key':
      return `pulsar ${(a.keys ?? '').toUpperCase()}`;
    case 'find_file':
      return `buscar el archivo «${a.name}»`;
    case 'excel_read':
      return `leer ${fileName(a.path)}`;
    case 'excel_write':
      return `escribir «${(a.text ?? '').slice(0, 60)}» en la celda ${a.cell} de ${fileName(a.path)}`;
    default:
      return 'terminar';
  }
}

const fileName = (p?: string) => (p ?? '').split(/[\\/]/).pop() || 'el archivo';

/** Resultado de una acción, resumido para el historial que ve el modelo. */
export function pcResultText(a: PcAction, r: Record<string, unknown>): string {
  if (a.type === 'find_file') {
    const files = (r.files as string[]) ?? [];
    return files.length ? `encontrados: ${files.join(' | ')}` : 'ningún archivo coincide';
  }
  if (a.type === 'excel_read') {
    const rows = ((r.rows as string[][]) ?? []).map((row) => row.join(' | ')).join(' / ');
    return `hoja «${r.sheet}» (${r.total_rows} filas; hojas: ${((r.sheets as string[]) ?? []).join(', ')}): ${rows}`.slice(0, 1400);
  }
  if (a.type === 'open' || a.type === 'focus') return `ventana «${String(r.title ?? '')}»`;
  return 'OK';
}
