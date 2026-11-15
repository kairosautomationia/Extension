// URL del Worker de Hanzo en Cloudflare. Se puede sobreescribir con VITE_API_URL al compilar.
const DEFAULT_API = 'https://extension.kairosautomation-ia.workers.dev';
const BASE = ((import.meta.env.VITE_API_URL || DEFAULT_API)).replace(/\/$/, '');
export const API_BASE = BASE;
/** Lee el texto visible de la pestaña activa (solo dentro de la extensión). */
export async function readPageContext() {
    try {
        if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.scripting?.executeScript)
            return undefined;
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id || !tab.url || !/^https?:/.test(tab.url))
            return undefined;
        const [res] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').slice(0, 16000),
        });
        return { title: tab.title, url: tab.url, text: res?.result ?? '' };
    }
    catch {
        return undefined;
    }
}
/** Llama al Worker y entrega el texto a medida que llega (SSE). */
export async function streamAgent(body, onToken, signal) {
    const res = await fetch(`${BASE}/api/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!res.ok || !res.body) {
        let msg = `Error ${res.status}`;
        try {
            msg = (await res.json()).error ?? msg;
        }
        catch {
            /* sin cuerpo JSON */
        }
        throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:'))
                continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]')
                continue;
            try {
                const j = JSON.parse(data);
                const t = j.response ?? j.choices?.[0]?.delta?.content;
                if (t)
                    onToken(t);
            }
            catch {
                /* fragmento incompleto */
            }
        }
    }
}
