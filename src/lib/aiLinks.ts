// Enviar lo que el usuario escribió en la barra de Hanzo directamente a otro asistente (ChatGPT, Claude, Gemini, Perplexity).
// - ChatGPT y Perplexity admiten el texto en la dirección (?q=); aun así se comprueba que se haya enviado y, si no, se pulsa Enviar.
// - Claude y Gemini no tienen un parámetro fiable: se abre la web, se escribe el texto en su cuadro y se pulsa Enviar.
//   Si no se encuentra el cuadro (la web cambió o falta iniciar sesión), el texto queda en el portapapeles para pegarlo.

export type AiTarget = { name: string; build: (q: string) => string };

export const AI_TARGETS: Record<string, AiTarget> = {
  ChatGPT: { name: 'ChatGPT', build: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  Perplexity: { name: 'Perplexity', build: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}` },
  Claude: { name: 'Claude', build: () => 'https://claude.ai/new' },
  Gemini: { name: 'Gemini', build: () => 'https://gemini.google.com/app' },
};

export const MAX_ASK_LEN = 1800; // límite razonable para direcciones largas y para el cuadro de las webs

/**
 * Se ejecuta DENTRO de la página del asistente (chrome.scripting.executeScript). Debe ser autocontenida.
 * Garantiza que el texto quede ENVIADO: si la web ya lo envió sola (ChatGPT/Perplexity con ?q=) no hace nada más;
 * si el texto quedó escrito, pulsa Enviar; si el cuadro está vacío, lo escribe y envía.
 * Devuelve 'sent' | 'filled' | 'nofound'.
 */
export async function injectedAsk(text: string, startUrl: string): Promise<'sent' | 'filled' | 'nofound'> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const startPath = (() => {
    try {
      return new URL(startUrl).pathname;
    } catch {
      return '';
    }
  })();
  const visible = (e: Element) => {
    const r = (e as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const findInput = (): HTMLElement | null => {
    const sels = [
      '#prompt-textarea', // ChatGPT
      'div.ProseMirror[contenteditable="true"]', // Claude
      'rich-textarea div.ql-editor[contenteditable="true"]', // Gemini
      'div.ql-editor[contenteditable="true"]',
      '#ask-input', // Perplexity
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
      btns.find((b) => b.getAttribute('data-testid') === 'send-button' && !b.disabled) ??
      btns.find((b) => /send|enviar|submit/i.test(b.getAttribute('aria-label') ?? '') && !b.disabled) ??
      btns.find((b) => /send|enviar/i.test(b.className) && !b.disabled) ??
      null
    );
  };
  const valueOf = (el: HTMLElement) => (el instanceof HTMLTextAreaElement ? el.value : el.innerText) || '';
  const probe = text.slice(0, 20).toLowerCase();
  const wentToLogin = () => /login|log-in|signin|sign-in|auth|accounts\.google/i.test(location.href);
  const started = () => location.pathname !== startPath && !wentToLogin(); // la web abrió la conversación
  const pressEnter = (el: HTMLElement) => {
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  };
  const submit = async (el: HTMLElement): Promise<'sent' | 'filled'> => {
    for (let i = 0; i < 12; i++) {
      if (started()) return 'sent';
      const b = findSend();
      if (b) {
        b.click();
        return 'sent';
      }
      await sleep(250);
    }
    pressEnter(el); // último recurso: Enter en el cuadro
    await sleep(800);
    return started() ? 'sent' : 'filled';
  };

  for (let i = 0; i < 50; i++) {
    if (wentToLogin()) return 'nofound';
    if (started()) return 'sent';
    const input = findInput();
    if (input) {
      const cur = valueOf(input).trim().toLowerCase();
      if (cur && cur.startsWith(probe)) return submit(input); // el texto ya está escrito (prefill): solo falta enviar
      if (!cur && i >= 10) {
        // pasaron ~2,5 s y el cuadro sigue vacío: se escribe y se envía
        input.focus();
        if (input instanceof HTMLTextAreaElement) {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, text);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          document.execCommand('selectAll', false);
          document.execCommand('insertText', false, text);
        }
        await sleep(400);
        if (!valueOf(input).trim()) return 'nofound';
        return submit(input);
      }
    }
    await sleep(250);
  }
  return 'nofound';
}

/** Abre el asistente con el texto y lo envía. Devuelve un aviso para mostrar al usuario. */
export async function askInAi(brand: string, rawText: string): Promise<string> {
  const target = AI_TARGETS[brand];
  const text = rawText.trim().slice(0, MAX_ASK_LEN);
  if (!target || !text) return '';
  // Red de seguridad: el texto queda también en el portapapeles
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* sin permiso: se sigue igualmente */
  }
  const url = target.build(text);
  const tab = await chrome.tabs.create({ url });
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
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: injectedAsk, args: [text, url] });
    const r = res?.result;
    if (r === 'sent') return `Enviado a ${target.name}.`;
    if (r === 'filled') return `Texto escrito en ${target.name}; pulsa Enter si no se envió.`;
  } catch {
    /* la web no permitió escribir */
  }
  return `No pude enviarlo en ${target.name} (¿falta iniciar sesión?). Tu texto está copiado: pégalo con Ctrl+V.`;
}
