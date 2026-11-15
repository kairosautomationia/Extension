import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMessage, Attachment, Message, PermissionMode, PlanStep } from '../types';
import { FINAL_ANSWER, READONLY_ANSWER } from '../lib/mockData';

const uid = () => Math.random().toString(36).slice(2, 10);

class Cancelled extends Error {}

const ACTION_STEPS: Omit<PlanStep, 'id' | 'state'>[] = [
  { code: 'read_page()', label: 'Leer la estructura de la página' },
  { code: 'find("button[data-testid=checkout]")', label: 'Localizar el botón de pago' },
  { code: 'click("#submit-btn")', label: 'Confirmar el pago' },
];
const READ_STEPS: Omit<PlanStep, 'id' | 'state'>[] = [
  { code: 'read_page()', label: 'Leer la estructura de la página' },
  { code: 'get_text("main")', label: 'Extraer el contenido principal' },
  { code: 'summarize()', label: 'Preparar el resumen' },
];

/**
 * Simula el ciclo de un agente: plan → (aprobación) → respuesta en streaming.
 * Sustituye `run()` por tu llamada real al modelo / ejecución en el DOM.
 */
export function useAgent(mode: PermissionMode) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const approvalRef = useRef<((ok: boolean) => void) | null>(null);
  const runningRef = useRef(false);

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
      const readonly = mode === 'readonly';
      const steps: PlanStep[] = (readonly ? READ_STEPS : ACTION_STEPS).map((s) => ({
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
        await sleep(900); // "Pensando…"
        for (let i = 0; i < steps.length; i++) {
          const isRisky = !readonly && i === steps.length - 1;

          if (isRisky && mode === 'manual') {
            // Human-in-the-loop: se pausa hasta que el usuario decida.
            patch(id, (m) => ({
              ...m,
              approval: { action: "hacer clic en 'Confirmar pago'", state: 'pending' },
            }));
            const ok = await new Promise<boolean>((resolve) => {
              approvalRef.current = resolve;
            });
            check();
            approvalRef.current = null;
            patch(id, (m) => ({ ...m, approval: m.approval && { ...m.approval, state: ok ? 'approved' : 'rejected' } }));
            if (!ok) {
              setStep(i, 'skipped');
              patch(id, (m) => ({
                ...m,
                plan: m.plan && { ...m.plan, done: true, open: false },
                answer: 'De acuerdo, no realicé ninguna acción. La página se queda exactamente como estaba.',
                streaming: false,
              }));
              return;
            }
          }

          setStep(i, 'running');
          await sleep(750);
          setStep(i, 'done');
        }

        patch(id, (m) => ({ ...m, plan: m.plan && { ...m.plan, done: true, open: false } }));
        await sleep(250);

        // Streaming palabra a palabra
        const words = (readonly ? READONLY_ANSWER : FINAL_ANSWER).split(/(\s+)/);
        let acc = '';
        for (const w of words) {
          acc += w;
          patch(id, (m) => ({ ...m, answer: acc }));
          await sleep(22);
        }
        patch(id, (m) => ({ ...m, streaming: false }));
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
