import { isBlockedHost } from './blocked';

// URL del Worker de Hanzo en Cloudflare. Se puede sobreescribir con VITE_API_URL al compilar.
const DEFAULT_API = 'https://extension.kairosautomation-ia.workers.dev';
const BASE = (((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API)).replace(/\/$/, '');

export const API_BASE = BASE;

/** Si el servidor no responde en este tiempo, se corta en vez de dejar la tarea colgada. */
export const CONNECT_TIMEOUT_MS = 40000;
/** Durante la respuesta en streaming: máximo de silencio entre fragmentos. */
const IDLE_TIMEOUT_MS = 30000;
export const TIMEOUT_MSG = 'El modelo tardó demasiado en responder. Inténtalo de nuevo.';

/** Une la señal del usuario (Detener) con un tiempo máximo. `timedOut()` dice si cortó el tiempo y no el usuario. */
export function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  let hit = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (next: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      hit = true;
      ctrl.abort();
    }, next);
  };
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  arm(ms);
  return {
    signal: ctrl.signal,
    timedOut: () => hit,
    arm,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface PageContext {
  title?: string;
  url?: string;
  text?: string;
}

export type ConnState = { state: 'checking' } | { state: 'ok'; tools: number } | { state: 'no-key' } | { state: 'bad-key' } | { state: 'error' };

/** Comprueba la conexión del conector Composio a través del Worker. */
export async function checkComposio(signal?: AbortSignal): Promise<ConnState> {
  try {
    const res = await fetch(`${BASE}/api/composio`, { signal });
    const j = (await res.json()) as { ok?: boolean; tools?: number; reason?: string };
    if (j.ok) return { state: 'ok', tools: j.tools ?? 0 };
    return j.reason === 'no-key' ? { state: 'no-key' } : j.reason === 'bad-key' ? { state: 'bad-key' } : { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

/** Lee el texto visible de la pestaña activa (solo dentro de la extensión). */
export async function readPageContext(): Promise<PageContext | undefined> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.scripting?.executeScript) return undefined;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return undefined;
    // Banca y pagos: el contenido de la página no se lee ni se envía; el modelo solo recibe este aviso
    const host = new URL(tab.url).hostname;
    if (isBlockedHost(host)) {
      return { title: '', url: host, text: 'Por seguridad, Hanzo no lee el contenido de páginas de banca y pagos. Si necesitas ayuda con esta página, copia aquí el texto que quieras comentar.' };
    }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 16000),
    });
    return { title: tab.title, url: tab.url, text: (res?.result as string) ?? '' };
  } catch {
    return undefined;
  }
}

/** Llama al Worker y entrega el texto a medida que llega (SSE). */
export async function streamAgent(
  body: { messages: ApiMessage[]; page?: PageContext; image?: string },
  onToken: (t: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const t = withTimeout(signal, CONNECT_TIMEOUT_MS);
  try {
    await readStream(body, onToken, t);
  } catch (e) {
    if (t.timedOut()) throw new Error(TIMEOUT_MSG);
    throw e;
  } finally {
    t.done();
  }
}

async function readStream(
  body: { messages: ApiMessage[]; page?: PageContext; image?: string },
  onToken: (t: string) => void,
  t: ReturnType<typeof withTimeout>,
): Promise<void> {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: t.signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Error ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* sin cuerpo JSON */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    t.arm(IDLE_TIMEOUT_MS); // si el modelo se queda en silencio, se corta en vez de esperar para siempre
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data) as { response?: string; choices?: { delta?: { content?: string } }[] };
        const t = j.response ?? j.choices?.[0]?.delta?.content;
        if (t) onToken(t);
      } catch {
        /* fragmento incompleto */
      }
    }
  }
}
