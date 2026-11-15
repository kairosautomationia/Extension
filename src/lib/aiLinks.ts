// Enviar lo que el usuario escribió en la barra de Hanzo directamente a otro asistente (ChatGPT, Claude, Gemini, Perplexity).
// - ChatGPT y Perplexity admiten el texto en la dirección (?q=) y lo envían solos.
// - Claude y Gemini no tienen un parámetro fiable: se abre la web, se escribe el texto en su cuadro y se pulsa Enviar.
//   Si no se encuentra el cuadro (la web cambió), el texto queda en el portapapeles para pegarlo.

export type AiTarget = { name: string; mode: 'url' | 'inject'; build: (q: string) => string };

export const AI_TARGETS: Record<string, AiTarget> = {
  ChatGPT: { name: 'ChatGPT', mode: 'url', build: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  Perplexity: { name: 'Perplexity', mode: 'url', build: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}` },
  Claude: { name: 'Claude', mode: 'inject', build: () => 'https://claude.ai/new' },
  Gemini: { name: 'Gemini', mode: 'inject', build: () => 'https://gemini.google.com/app' },
};

export const MAX_ASK_LEN = 1800; // límite razonable para direcciones largas y para el cuadro de las webs

/**
 * Se ejecuta DENTRO de la página del asistente (chrome.scripting.executeScript). Debe ser autocontenida.
 * Devuelve 'sent' | 'filled' | 'nofound'.
 */
export async function injectedAsk(text: string): Promise<'sent' | 'filled' | 'nofound'> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const visible = (e: Element) => {
    const r = (e as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const findInput = (): HTMLElement | null => {
    const sels = [
      'div.ProseMirror[contenteditable="true"]', // Claude
      'rich-textarea div.ql-editor[contenteditable="true"]', // Gemini
      'div.ql-editor[contenteditable="true"]',
      'textarea',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    for (const s of sels) {
      const el = Array.from(document.querySelectorAll<HTMLElement>(s)).find(visible);
      if (el) return el;
    }
    return null;
  };
  const findSend = (): HTMLButtonElement | null => {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(visible);
    return (
      btns.find((b) => /send|enviar|submit/i.test(b.getAttribute('aria-label') ?? '') && !b.disabled) ??
      btns.find((b) => /send|enviar/i.test(b.className) && !b.disabled) ??
      null
    );
  };

  let input: HTMLElement | null = null;
  for (let i = 0; i < 40 && !input; i++) {
    input = findInput();
    if (!input) await sleep(250);
  }
  if (!input) return 'nofound';

  input.focus();
  if (input instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  }
  await sleep(400);
  const current = input instanceof HTMLTextAreaElement ? input.value : input.innerText;
  if (!current || !current.trim()) return 'nofound';

  for (let i = 0; i < 12; i++) {
    const b = findSend();
    if (b) {
      b.click();
      return 'sent';
    }
    await sleep(250);
  }
  return 'filled'; // el texto quedó escrito; el usuario solo pulsa Enviar
}

/** Abre el asistente con el texto. Devuelve un aviso para mostrar al usuario. */
export async function askInAi(brand: string, rawText: string): Promise<string> {
  const target = AI_TARGETS[brand];
  const text = rawText.trim().slice(0, MAX_ASK_LEN);
  if (!target || !text) return '';
  if (target.mode === 'url') {
    await chrome.tabs.create({ url: target.build(text) });
    return `Enviado a ${target.name}.`;
  }
  // Red de seguridad: el texto queda también en el portapapeles
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* sin permiso: se sigue igualmente */
  }
  const tab = await chrome.tabs.create({ url: target.build(text) });
  const tabId = tab.id;
  if (tabId === undefined) return `Abrí ${target.name}; pega tu texto (Ctrl+V).`;
  await new Promise<void>((resolve) => {
    const t = setTimeout(done, 15000);
    function done() {
      clearTimeout(t);
      chrome.tabs.onUpdated.removeListener(onUpd);
      resolve();
    }
    const onUpd = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(onUpd);
  });
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: injectedAsk, args: [text] });
    const r = res?.result;
    if (r === 'sent') return `Enviado a ${target.name}.`;
    if (r === 'filled') return `Texto escrito en ${target.name}; pulsa Enviar.`;
  } catch {
    /* la web no permitió escribir */
  }
  return `No pude escribirlo en ${target.name}. Tu texto está copiado: pégalo con Ctrl+V.`;
}
