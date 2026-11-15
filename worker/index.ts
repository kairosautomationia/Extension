// Worker de Hanzo: expone /api/agent y habla con Workers AI (un solo modelo).
// Las claves nunca viajan a la extensión; el binding `AI` vive solo aquí.

const MODEL = '@cf/google/gemma-4-26b-a4b-it';

const SYSTEM = `Eres Hanzo, un agente de IA que vive en el panel lateral del navegador.
Respondes siempre en español, claro y directo.
Recibes el contexto de la pestaña activa (título, URL y texto visible) y, a veces, una captura de pantalla.
A veces también recibes contenido leído de una URL o resultados de búsqueda web: úsalos y cita las URLs de donde sale cada dato.
Usa solo ese contexto para responder; si algo no aparece, dilo en vez de inventarlo.
En esta versión solo puedes LEER y analizar la página. No puedes hacer clic, escribir ni enviar nada:
si te piden una acción, explica los pasos que el usuario debería seguir y no afirmes haberla ejecutado.
Da respuestas breves, con listas cuando ayuden.`;

interface Env {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  GEEKFLARE_KEY?: string; // secreto del Worker (wrangler secret put GEEKFLARE_KEY)
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}
interface Body {
  messages: ChatMsg[];
  page?: { title?: string; url?: string; text?: string };
  image?: string; // data URL (captura o imagen adjunta)
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// ---------- Web (Geekflare): leer URLs y buscar en internet ----------
const GEEKFLARE = 'https://api.geekflare.com';

async function geekflare(env: Env, path: string, payload: unknown): Promise<unknown> {
  const r = await fetch(GEEKFLARE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.GEEKFLARE_KEY as string },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Geekflare ${r.status}`);
  return (await r.json()) as { data?: unknown };
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;
// Pide buscar en internet: "busca…", "investiga…", "en internet/la web/google"
const SEARCH_RE = /^\s*(busca|buscar|búscame|buscame|investiga|investigar|googlea)\b|\b(en internet|en la web|en google)\b/i;

async function webContext(env: Env, text: string): Promise<string> {
  if (!env.GEEKFLARE_KEY) return '';
  try {
    const m = text.match(URL_RE);
    if (m) {
      const res = (await geekflare(env, '/web-scraping', { url: m[0], format: 'markdown', renderJS: true, blockAds: true })) as { data?: unknown };
      const d = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
      return `\n\n[Contenido leído de ${m[0]}]\n${d.slice(0, 14000)}`;
    }
    if (SEARCH_RE.test(text)) {
      const query = text.replace(/^\s*(busca|buscar|búscame|buscame|investiga|investigar|googlea)\s+(en internet|en la web|en google)?\s*/i, '').trim().slice(0, 300) || text.slice(0, 300);
      const res = (await geekflare(env, '/search', { query, limit: 6, source: 'web', format: 'json' })) as { data?: unknown };
      const items = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      if (items.length === 0) return '\n\n[Búsqueda web] Sin resultados.';
      const lines = items
        .slice(0, 6)
        .map((it, i) => `${i + 1}. ${String(it.title ?? '')} — ${String(it.url ?? it.link ?? '')}\n   ${String(it.snippet ?? it.description ?? '').slice(0, 400)}`);
      return `\n\n[Resultados de búsqueda web para "${query}"]\n${lines.join('\n')}`;
    }
  } catch (e) {
    return `\n\n[Aviso: no se pudo consultar la web (${e instanceof Error ? e.message : 'error'}). Dilo al usuario y responde solo con lo que ya tienes.]`;
  }
  return '';
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/status' && request.method === 'GET') return json({ ok: true, web: !!env.GEEKFLARE_KEY });
    if (url.pathname !== '/api/agent' || request.method !== 'POST') return json({ error: 'No encontrado' }, 404);

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: 'Faltan mensajes' }, 400);

    const history = body.messages.slice(-12).map((m) => ({
      role: m.role,
      content: String(m.content ?? '').slice(0, 8000),
    }));

    const p = body.page;
    const context = p
      ? `\n\n[Pestaña activa]\nTítulo: ${p.title ?? ''}\nURL: ${p.url ?? ''}\nTexto visible:\n${(p.text ?? '').slice(0, 16000)}`
      : '';

    // El contexto de la página y la imagen se anexan al último mensaje del usuario.
    const last = history[history.length - 1];
    const web = last.role === 'user' ? await webContext(env, last.content) : '';
    const parts: Part[] = [{ type: 'text', text: last.content + context + web }];
    if (body.image && body.image.startsWith('data:image/')) {
      parts.push({ type: 'image_url', image_url: { url: body.image } });
    }

    const messages = [
      { role: 'system', content: SYSTEM },
      ...history.slice(0, -1),
      { role: last.role, content: parts },
    ];

    try {
      const stream = await env.AI.run(MODEL, {
        messages,
        stream: true,
        max_tokens: 1200,
        temperature: 0.3,
        // Sin razonamiento largo: respuestas rápidas para un panel de chat.
        chat_template_kwargs: { enable_thinking: false },
      });
      return new Response(stream as ReadableStream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error del modelo';
      return json({ error: msg }, 502);
    }
  },
};
