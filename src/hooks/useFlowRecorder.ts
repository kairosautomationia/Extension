import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordedAction, SavedFlow, TabInfo } from '../types';
import { injectedStart, injectedStop } from '../lib/recorderInject';
import { loadFlows, persistFlows } from '../lib/flows';

const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_RECORDED = 80; // tope de acciones por grabación
const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.scripting?.executeScript;

// Acciones de ejemplo, solo para la vista previa fuera de la extensión (`vite dev`)
const DEV_SAMPLE: Omit<RecordedAction, 'id' | 't' | 'url'>[] = [
  { type: 'click', selector: '#add-to-cart', label: 'Añadir al carrito' },
  { type: 'input', selector: '#postal', label: 'Código postal', value: '28013' },
  { type: 'select', selector: '#envio', label: 'Envío', value: 'Estándar' },
  { type: 'click', selector: '#checkout', label: 'Continuar al pago' },
];

export function useFlowRecorder(tab: TabInfo) {
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState<RecordedAction[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flows, setFlows] = useState<SavedFlow[]>(loadFlows);
  const [savedKey, setSavedKey] = useState(0); // sube cada vez que se guarda un flujo

  const actionsRef = useRef<RecordedAction[]>([]);
  const tabIdRef = useRef<number | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const startUrlRef = useRef('');

  const push = useCallback((a: Omit<RecordedAction, 'id'>) => {
    const list = actionsRef.current;
    const last = list[list.length - 1];
    // El envío que provoca un clic o Enter ya queda cubierto por ese clic o Enter (evita enviar dos veces al repetir)
    if (a.type === 'submit' && last && (last.type === 'click' || last.type === 'key') && a.t - last.t < 1000) return;
    if (list.length >= MAX_RECORDED && !(last && a.type === 'scroll' && last.type === 'scroll')) return;
    // Varias ediciones seguidas del mismo campo (o desplazamientos seguidos) cuentan como una sola acción
    const merge =
      !!last &&
      ((a.type === 'input' && last.type === 'input' && last.selector === a.selector) ||
        (a.type === 'scroll' && last.type === 'scroll'));
    const next = merge ? [...list.slice(0, -1), { ...a, id: last.id }] : [...list, { ...a, id: uid() }];
    actionsRef.current = next;
    setActions(next);
  }, []);

  // Cronómetro
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const start = useCallback(async () => {
    setError(null);
    actionsRef.current = [];
    setActions([]);
    setSecs(0);

    if (!hasChrome()) {
      // Simulación para la vista previa
      let i = 0;
      const t = setInterval(() => {
        push({ ...DEV_SAMPLE[i % DEV_SAMPLE.length], url: 'https://ejemplo.com/', t: Date.now() });
        i++;
      }, 1500);
      cleanupRef.current = () => clearInterval(t);
      setRecording(true);
      return;
    }

    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!active?.id || !/^https?:/.test(active.url ?? '')) {
        setError('No se puede grabar en esta pestaña. Abre una página web normal (http o https).');
        return;
      }
      const tabId = active.id;
      tabIdRef.current = tabId;
      startUrlRef.current = active.url ?? '';
      await chrome.scripting.executeScript({ target: { tabId }, func: injectedStart });

      let lastUrl = active.url ?? '';
      const onMessage = (
        msg: { type?: string; action?: Omit<RecordedAction, 'id'> },
        sender: chrome.runtime.MessageSender,
      ) => {
        if (msg?.type === 'hanzo-action' && msg.action && sender.tab?.id === tabId) push(msg.action);
      };
      // Al navegar, la página nueva pierde el script: se registra el salto y se vuelve a inyectar
      const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, t: chrome.tabs.Tab) => {
        if (id !== tabId || info.status !== 'complete' || !t.url || t.url === lastUrl) return;
        lastUrl = t.url;
        push({ type: 'navigate', selector: '', label: t.title ?? '', url: t.url, t: Date.now() });
        chrome.scripting.executeScript({ target: { tabId }, func: injectedStart }).catch(() => {});
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.tabs.onUpdated.addListener(onUpdated);
      cleanupRef.current = () => {
        chrome.runtime.onMessage.removeListener(onMessage);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };
      setRecording(true);
    } catch {
      setError('No se pudo iniciar la grabación en esta página.');
    }
  }, [push]);

  const stop = useCallback(async () => {
    cleanupRef.current();
    cleanupRef.current = () => {};
    setRecording(false);

    if (hasChrome() && tabIdRef.current != null) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tabIdRef.current }, func: injectedStop });
      } catch {
        /* la pestaña se cerró */
      }
    }

    const list = actionsRef.current;
    if (list.length === 0) {
      setError('No se registró ninguna acción.');
      return;
    }
    const host = tabRef.current.host || 'la página';
    const flow: SavedFlow = {
      id: uid(),
      title: `Flujo en ${host}`,
      host,
      createdAt: Date.now(),
      startUrl: startUrlRef.current || list[0]?.url,
      actions: list,
    };
    setFlows((f) => {
      const next = [flow, ...f];
      persistFlows(next);
      return next;
    });
    setSavedKey((k) => k + 1);
  }, []);

  /** Una captura de pantalla hecha mientras se graba cuenta como una acción más. */
  const addCapture = useCallback(() => {
    if (!recordingRef.current) return;
    push({ type: 'capture', selector: '', label: 'Captura de pantalla', url: tabRef.current.url, t: Date.now() });
  }, [push]);

  const toggle = useCallback(() => (recording ? stop() : start()), [recording, start, stop]);

  const removeFlow = useCallback((id: string) => {
    setFlows((f) => {
      const next = f.filter((x) => x.id !== id);
      persistFlows(next);
      return next;
    });
  }, []);

  // Si el panel se cierra grabando, se limpia
  useEffect(() => () => cleanupRef.current(), []);

  // El aviso de error se borra solo
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  return { recording, actions, secs, error, flows, savedKey, toggle, removeFlow, addCapture };
}
