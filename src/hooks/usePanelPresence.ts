import { useEffect } from 'react';

/**
 * Avisa al service worker de que el panel está abierto (así agrupa la pestaña activa bajo "Hanzo"
 * y la desagrupa al cerrarlo). Si el service worker se reinicia y el puerto se cae, se reconecta.
 */
export function usePanelPresence() {
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
    let port: chrome.runtime.Port | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const connect = () => {
      try {
        // Al reconectar se usa otro nombre: el service worker no vuelve a agrupar (respeta si el usuario desagrupó)
        port = chrome.runtime.connect({ name: first ? 'hanzo-panel' : 'hanzo-panel-re' });
        first = false;
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError; // leerlo evita el aviso "Unchecked runtime.lastError" en Errores
          port = null;
          if (!closed) retry = setTimeout(connect, 300);
        });
      } catch {
        /* la extensión se recargó: el panel ya no sirve hasta reabrirlo */
      }
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      try {
        port?.disconnect();
      } catch {
        /* ya estaba cerrado */
      }
    };
  }, []);
}
