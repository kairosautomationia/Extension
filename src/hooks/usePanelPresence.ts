import { useEffect } from 'react';

/** Avisa al service worker de que el panel está abierto (así agrupa la pestaña activa bajo "Hanzo"). */
export function usePanelPresence() {
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: 'hanzo-panel' });
    } catch {
      /* la extensión se recargó */
    }
    return () => {
      try {
        port?.disconnect();
      } catch {
        /* ya estaba cerrado */
      }
    };
  }, []);
}
