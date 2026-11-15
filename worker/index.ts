// Worker de Hanzo: expone /api/agent y habla con Workers AI (un solo modelo).
// Las claves nunca viajan a la extensión; el binding `AI` vive solo aquí.

const MODEL = '@cf/google/gemma-4-26b-a4b-it';

const SYSTEM = `Eres Hanzo, un agente de IA que vive en el panel lateral del navegador.
Respondes siempre en español, claro y directo.
Recibes el contexto de la pestaña activa (título, URL y texto visible) y, a veces, una captura de pantalla.
Usa solo ese contexto para responder; si algo no aparece, dilo en vez de inventarlo.
En esta versión solo puedes LEER y analizar la página. No puedes hacer clic, escribir ni enviar nada:
si te piden una acción, explica los pasos que el usuario debería seguir y no afirmes haberla ejecutado.
Da respuestas breves, con listas cuando ayuden.`;

interface Env {
  AI: { run(model: string, input: unknown): Promise<unknown> };
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
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
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
    const parts: Part[] = [{ type: 'text', text: last.content + context }];
    if (body.image && body.image.startsWith('data:image/')) {
      parts.push({ type: 'image_url', image_url: { url: body.image } });
    }

    const messages = [
      { role: 'system', content: SYSTEM },
      ...history.slice(0, -1),
      { role: last.role, content: parts },
    ];

    try {
      const stream = await env.AI.run(MODEL, { messages, stream: true, max_tokens: 1200 });
      return new Response(stream as ReadableStream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error del modelo';
      return json({ error: msg }, 502);
    }
  },
};
