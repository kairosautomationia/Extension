// URL del Worker de Hanzo en Cloudflare. Se puede sobreescribir con VITE_API_URL al compilar.
const DEFAULT_API = 'https://extension.kairosautomation-ia.workers.dev';
const BASE = (((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API)).replace(/\/$/, '');

export const API_BASE = BASE;

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
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
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
