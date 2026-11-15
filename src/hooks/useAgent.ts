import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMessage, Attachment, Message, PermissionMode, PlanStep } from '../types';
import { readPageContext, streamAgent, type ApiMessage } from '../lib/api';

const uid = () => Math.random().toString(36).slice(2, 10);

class Cancelled extends Error {}

const READ_STEPS: Omit<PlanStep, 'id' | 'state'>[] = [
  { code: 'read_page()', label: 'Leer la pestaña activa' },
  { code: 'get_text("body")', label: 'Extraer el contenido visible' },
  { code: 'ask_model()', label: 'Analizar y redactar la respuesta' },
];

/**
 * Ciclo del agente: lee la pestaña → consulta al modelo (Worker /api/agent) → respuesta en streaming.
 * Por ahora solo lee y analiza; las acciones sobre el DOM (clic, escribir) quedan para la siguiente fase.
 */
export function useAgent(mode: PermissionMode) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const approvalRef = useRef<((ok: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  messagesRef.current = messages;

  // Cancela cualquier ejecución en curso al desmontar.
  useEffect(() => {
    const token = cancelRef;
    return () => {
      token.current.cancelled = true;
      approvalRef.current?.(false);
    };
  }, []);

  const patch = useCallback((id: string, fn: (m: AgentMessage) => AgentMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === 'agent' ? fn(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      if (runningRef.current) return; // un solo agente activo a la vez
      runningRef.current = true;
      const token = { cancelled: false };
      cancelRef.current = token;
      const check = () => {
        if (token.cancelled) throw new Cancelled();
      };
      const sleep = async (ms: number) => {
        await new Promise((r) => setTimeout(r, ms));
        check();
      };

      const id = uid();
      // En esta versión el agente solo lee y analiza la página (sin acciones sobre el DOM).
      const steps: PlanStep[] = READ_STEPS.map((s) => ({
        ...s,
        id: uid(),
        state: 'pending',
      }));
      setMessages((ms) => [
        ...ms,
        { id: uid(), role: 'user', text, attachments },
        { id, role: 'agent', plan: { steps, open: true, done: false }, streaming: true },
      ]);
      setRunning(true);

      const setStep = (i: number, state: PlanStep['state']) =>
        patch(id, (m) => ({
          ...m,
          plan: m.plan && { ...m.plan, steps: m.plan.steps.map((s, k) => (k === i ? { ...s, state } : s)) },
        }));

      try {
        await sleep(300); // "Pensando…"
        setStep(0, 'running');
        const page = await readPageContext();
        check();
        setStep(0, 'done');
        setStep(1, 'running');
        await sleep(150);
        setStep(1, 'done');
        setStep(2, 'running');

        const image = [...attachments].reverse().find((a) => a.url && a.kind !== 'file')?.url;
        const history: ApiMessage[] = [];
        for (const m of messagesRef.current) {
          if (m.role === 'user') history.push({ role: 'user', content: m.text });
          else if (m.answer) history.push({ role: 'assistant', content: m.answer });
        }
        history.push({ role: 'user', content: text });

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        let acc = '';
        try {
          await streamAgent({ messages: history, page, image }, (t) => {
            acc += t;
            patch(id, (m) => ({ ...m, answer: acc }));
          }, ctrl.signal);
        } catch (err) {
          check();
          const msg = err instanceof Error ? err.message : 'Error desconocido';
          acc = acc || `No pude contactar al modelo: ${msg}`;
          patch(id, (m) => ({ ...m, answer: acc }));
        }
        check();
        setStep(2, 'done');
        patch(id, (m) => ({ ...m, plan: m.plan && { ...m.plan, done: true, open: false }, streaming: false }));
      } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
        patch(id, (m) => ({
          ...m,
          streaming: false,
          stopped: true,
          approval: m.approval?.state === 'pending' ? { ...m.approval, state: 'rejected' } : m.approval,
          plan: m.plan && {
            ...m.plan,
            steps: m.plan.steps.map((s) => (s.state === 'running' || s.state === 'pending' ? { ...s, state: 'skipped' } : s)),
          },
        }));
      } finally {
        if (cancelRef.current === token) {
          runningRef.current = false;
          setRunning(false);
        }
      }
    },
    [mode, patch],
  );

  const stop = useCallback(() => {
    cancelRef.current.cancelled = true;
    abortRef.current?.abort();
    approvalRef.current?.(false);
    approvalRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }, []);

  const resolveApproval = useCallback((ok: boolean) => approvalRef.current?.(ok), []);

  const togglePlan = useCallback(
    (id: string) => patch(id, (m) => ({ ...m, plan: m.plan && { ...m.plan, open: !m.plan.open } })),
    [patch],
  );

  const reset = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  return { messages, running, send, stop, resolveApproval, togglePlan, reset };
}
