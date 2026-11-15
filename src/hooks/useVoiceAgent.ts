import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation } from '@elevenlabs/client';

/** Agente de voz de Hanzo en ElevenLabs. El ID del agente es público; la clave secreta nunca va en la extensión. */
const AGENT_ID = 'agent_4901m7fpft5yeg1vtkr0n8eqb7n2';

export type VoiceState = 'off' | 'connecting' | 'listening' | 'speaking';

interface Session {
  endSession: () => Promise<void>;
  sendContextualUpdate?: (t: string) => void;
}

/**
 * Conversación de voz con el agente. Su herramienta `pedir_a_hanzo` entrega lo que el usuario pide
 * al mismo chat de Hanzo, así que las aprobaciones y los límites de seguridad son exactamente los de siempre.
 */
export function useVoiceAgent(onInstruction: (text: string) => void, context: () => string) {
  const [state, setState] = useState<VoiceState>('off');
  const [error, setError] = useState<{ msg: string; n: number } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const cbRef = useRef(onInstruction);
  cbRef.current = onInstruction;
  const ctxRef = useRef(context);
  ctxRef.current = context;

  const fail = useCallback((msg: string) => setError((e) => ({ msg, n: (e?.n ?? 0) + 1 })), []);

  const stop = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setState('off');
    try {
      await s?.endSession();
    } catch {
      /* ya estaba cerrada */
    }
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current || sessionRef.current) return;
    busyRef.current = true;
    setState('connecting');
    try {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // El panel lateral a veces no puede mostrar el aviso de permiso: se pide una vez en una pestaña normal
        try {
          void chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') });
        } catch {
          /* sin acceso a pestañas */
        }
        fail('Falta el permiso del micrófono. Permítelo en la pestaña que se abrió y vuelve a pulsar el botón.');
        setState('off');
        return;
      }

      const opts = {
        agentId: AGENT_ID,
        connectionType: 'webrtc',
        clientTools: {
          pedir_a_hanzo: async (p: { instruccion?: string; instruction?: string; text?: string }) => {
            const t = String(p?.instruccion ?? p?.instruction ?? p?.text ?? '').trim();
            if (!t) return 'No recibí ninguna instrucción.';
            cbRef.current(t);
            return 'Instrucción enviada a Hanzo.';
          },
        },
        onConnect: () => setState('listening'),
        onDisconnect: () => {
          sessionRef.current = null;
          setState('off');
        },
        onError: (m: unknown) => {
          fail(typeof m === 'string' && m ? `Voz: ${m}` : 'El agente de voz tuvo un problema.');
        },
        onModeChange: (m: { mode?: string }) => setState(m?.mode === 'speaking' ? 'speaking' : 'listening'),
      };
      const conv = (await Conversation.startSession(opts as never)) as unknown as Session;
      sessionRef.current = conv;
      try {
        conv.sendContextualUpdate?.(ctxRef.current());
      } catch {
        /* el contexto es opcional */
      }
    } catch {
      sessionRef.current = null;
      setState('off');
      fail('No se pudo conectar el agente de voz. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      busyRef.current = false;
    }
  }, [fail]);

  const toggle = useCallback(() => {
    if (state === 'off') void start();
    else void stop();
  }, [state, start, stop]);

  useEffect(
    () => () => {
      void sessionRef.current?.endSession().catch(() => undefined);
    },
    [],
  );

  return { state, error, toggle };
}
