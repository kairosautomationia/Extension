import { useEffect, useRef } from 'react';

interface Pending {
  text: string;
  t: number;
}

/**
 * Recibe el texto que el usuario eligió con la burbuja "Preguntar a Hanzo" de la página
 * (el service worker lo deja en chrome.storage.session y abre el panel).
 */
export function useSelectionAsk(onText: (text: string) => void) {
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return;
    let lastT = 0;
    const take = async () => {
      try {
        const r = (await chrome.storage.session.get('hanzoPending')) as { hanzoPending?: Pending };
        const p = r.hanzoPending;
        if (!p || p.t === lastT) return;
        lastT = p.t;
        await chrome.storage.session.remove('hanzoPending');
        if (Date.now() - p.t > 30000) return; // un encargo viejo no se ejecuta solo
        if (typeof p.text === 'string' && p.text.trim()) cb.current(p.text);
      } catch {
        /* sin acceso al almacenamiento */
      }
    };
    void take();
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && changes.hanzoPending) void take();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
}
