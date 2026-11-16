import { useCallback, useEffect, useRef, useState } from 'react';

// Dictado: voz a texto con el reconocimiento de voz de Chrome (gratis, sin pasar por el Worker).
interface RecAlt {
  transcript: string;
}
interface RecResult {
  isFinal: boolean;
  0: RecAlt;
}
interface RecEvent {
  resultIndex: number;
  results: ArrayLike<RecResult>;
}
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecCtor = new () => Rec;

const getCtor = (): RecCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const DICTATION_LANG = 'es-EC';

const ERRORS: Record<string, string> = {
  'not-allowed': 'Falta el permiso del micrófono. Permítelo en la pestaña que se abrió y vuelve a pulsar el micrófono.',
  'service-not-allowed': 'Chrome no permite el dictado en este momento.',
  network: 'No hay conexión para transcribir. Revisa tu internet.',
  'audio-capture': 'No encuentro un micrófono. Conecta uno e inténtalo de nuevo.',
};

/** onText recibe lo ya confirmado y lo que se está diciendo ahora (provisional). */
export function useDictation(onText: (final: string, interim: string) => void, onError: (msg: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<Rec | null>(null);
  const finalRef = useRef('');
  const cbRef = useRef(onText);
  cbRef.current = onText;
  const errRef = useRef(onError);
  errRef.current = onError;
  const supported = getCtor() !== null;

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ya estaba detenido */
    }
  }, []);

  const start = useCallback(async () => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        void chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
      } catch {
        /* sin acceso a pestañas */
      }
      errRef.current(ERRORS['not-allowed']);
      return;
    }
    const rec = new Ctor();
    rec.lang = DICTATION_LANG;
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      cbRef.current(finalRef.current, interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // silencio o corte normal: sin aviso
      errRef.current(ERRORS[e.error] ?? 'No pude transcribir. Inténtalo de nuevo.');
    };
    rec.onend = () => {
      cbRef.current(finalRef.current, '');
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      errRef.current('No pude iniciar el dictado. Inténtalo de nuevo.');
    }
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* nada */
      }
    },
    [],
  );

  return { listening, supported, start, stop };
}
