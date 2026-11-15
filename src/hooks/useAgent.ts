import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMessage, Attachment, Message, PermissionMode, PlanStep } from '../types';
import { readPageContext, streamAgent, type ApiMessage } from '../lib/api';
import {
  MAX_STEPS,
  type ActPlan,
  describeAction,
  inTab,
  injectedAct,
  injectedClear,
  injectedHighlight,
  injectedSnapshot,
  isBlockedHost,
  parseTask,
  requestAct,
  tabState,
} from '../lib/actions';

const uid = () => Math.random().toString(36).slice(2, 10);

class Cancelled extends Error {}

const READ_STEPS: Omit<PlanStep, 'id' | 'state'>[] = [
  { code: 'read_page()', label: 'Leer la pestaña activa' },
  { code: 'get_text("body")', label: 'Extraer el contenido visible' },
  { code: 'ask_model()', label: 'Analizar y redactar la respuesta' },
];

/**
 * Ciclo del agente.
 * - Mensaje normal: lee la pestaña → consulta al modelo (Worker /api/agent) → respuesta en streaming.
 * - "/hacer <tarea>": bucle de acciones (clic, escribir, desplazar) en la pestaña activa, de a UNA acción,
 *   con aprobación según el modo, campos sensibles bloqueados, tope de pasos y botón Detener.
 */
export function useAgent(mode: PermissionMode) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const approvalRef = useRef<((ok: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const modeRef = useRef<PermissionMode>(mode);

  messagesRef.current = messages;
  modeRef.current = mode;

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
      const taskText = parseTask(text);
      const isTask = taskText !== null;
      const baseSteps: Omit<PlanStep, 'id' | 'state'>[] = isTask ? [{ code: 'snapshot()', label: 'Preparar la pestaña' }] : READ_STEPS;
      const steps: PlanStep[] = baseSteps.map((s) => ({
        ...s,
        id: uid(),
        state: 'pending',
      }));
      setMessages((ms) => [
        ...ms,
        { id: uid(), role: 'user', text, attachments },
        // En chat normal los pasos internos van en segundo plano; solo las tareas /hacer muestran el plan.
        { id, role: 'agent', plan: isTask ? { steps, open: true, done: false } : undefined, streaming: true },
      ]);
      setRunning(true);

      const setStep = (i: number, state: PlanStep['state']) =>
        patch(id, (m) => ({
          ...m,
          plan: m.plan && { ...m.plan, steps: m.plan.steps.map((s, k) => (k === i ? { ...s, state } : s)) },
        }));

      const getMode = (): PermissionMode => modeRef.current; // se lee en cada paso: el usuario puede cambiar de modo
      const finishTask = (answer: string) =>
        patch(id, (m) => ({ ...m, answer, streaming: false, plan: m.plan && { ...m.plan, done: true } }));

      const runTask = async (task: string) => {
        if (getMode() === 'readonly') {
          setStep(0, 'skipped');
          finishTask('Estás en modo **Solo lectura**. Cambia a Manual o Automático para que pueda actuar en la página.');
          return;
        }
        if (!task) {
          setStep(0, 'skipped');
          finishTask('Escribe la tarea después de `/hacer`. Ejemplo: `/hacer escribe "zapatos" en el buscador y pulsa buscar`.');
          return;
        }
        setStep(0, 'running');
        const tab0 = await tabState();
        check();
        if (!tab0) {
          setStep(0, 'skipped');
          finishTask('No puedo actuar en esta pestaña. Abre una página web normal (http o https).');
          return;
        }
        if (isBlockedHost(tab0.host)) {
          setStep(0, 'skipped');
          finishTask(`Por seguridad, Hanzo no actúa en **${tab0.host}** (banca y pagos).`);
          return;
        }
        setStep(0, 'done');

        let stepCount = 1;
        const addStep = (code: string, label: string, state: PlanStep['state']) => {
          const i = stepCount++;
          patch(id, (m) => ({
            ...m,
            plan: m.plan && { ...m.plan, steps: [...m.plan.steps, { id: uid(), code, label, state }] },
          }));
          return i;
        };

        const history: string[] = [];
        let final = `Llegué al límite de ${MAX_STEPS} pasos y me detuve por seguridad. Revisa cómo quedó la página.`;
        let bad = 0;
        try {
          for (let n = 0; n < MAX_STEPS; n++) {
            check();
            if (getMode() === 'readonly') {
              final = 'Cambiaste a Solo lectura; me detuve.';
              break;
            }
            const cur = await tabState(tab0.id);
            check();
            if (!cur) {
              final = 'La pestaña ya no está disponible; me detuve.';
              break;
            }
            if (cur.host !== tab0.host) {
              final = `La pestaña cambió a **${cur.host}**. Por seguridad me detuve; vuelve a pedirme la tarea desde ahí.`;
              break;
            }
            const snap = await inTab(tab0.id, injectedSnapshot, []);
            check();
            if (!snap) {
              final = 'No pude leer la página.';
              break;
            }

            const ctrl = new AbortController();
            abortRef.current = ctrl;
            let plan: ActPlan | null = null;
            try {
              plan = await requestAct(
                {
                  task,
                  page: { title: cur.title, url: cur.url },
                  elements: snap.els,
                  history,
                  scroll: { y: snap.scrollY, max: snap.scrollMax },
                },
                ctrl.signal,
              );
            } catch (err) {
              check();
              final = `No pude contactar al modelo: ${err instanceof Error ? err.message : 'error desconocido'}`;
              break;
            }
            check();
            if (!plan) break;

            const a = plan.action;
            if (a.type === 'done' || a.type === 'ask') {
              final = plan.say || (a.type === 'done' ? 'Listo.' : 'Necesito más datos.');
              break;
            }
            const el = a.id !== undefined ? snap.els.find((e) => e.id === a.id) : undefined;
            if (a.type !== 'scroll' && !el) {
              history.push('Acción inválida: ese elemento no existe');
              if (++bad >= 3) {
                final = 'No logré decidir una acción segura. Prueba con una tarea más concreta.';
                break;
              }
              continue;
            }
            const desc = describeAction(a, el);
            if (el && el.risk === 'blocked') {
              addStep(`${a.type}(#${el.id})`, `Bloqueado: ${desc}`, 'skipped');
              history.push(`BLOQUEADO: «${el.label}» es un campo sensible; no puedes usarlo`);
              if (++bad >= 3) {
                final = 'La tarea requiere campos sensibles (contraseña, tarjeta, datos de identidad). Eso lo debes hacer tú.';
                break;
              }
              continue;
            }
            bad = 0;

            const code = a.type === 'scroll' ? `scroll("${a.dir ?? 'down'}")` : `${a.type}(#${a.id})`;
            const si = addStep(code, desc.charAt(0).toUpperCase() + desc.slice(1), 'running');
            const high = el?.risk === 'high';
            const needsApproval = getMode() === 'manual' || high;

            await inTab(tab0.id, injectedHighlight, [el ? el.id : null, desc]);
            if (needsApproval) {
              patch(id, (m) => ({
                ...m,
                approval: { action: desc + (high ? ' (acción sensible)' : ''), state: 'pending' },
              }));
              const ok = await new Promise<boolean>((resolve) => {
                approvalRef.current = resolve;
              });
              approvalRef.current = null;
              check();
              patch(id, (m) => ({ ...m, approval: m.approval && { ...m.approval, state: ok ? 'approved' : 'rejected' } }));
              if (!ok) {
                setStep(si, 'skipped');
                final = 'Rechazaste la acción; detuve la tarea.';
                break;
              }
            } else {
              await sleep(600); // el usuario alcanza a ver qué se va a tocar
            }

            const res = await inTab(tab0.id, injectedAct, [a]);
            check();
            setStep(si, res?.ok ? 'done' : 'skipped');
            history.push(`${desc} → ${res?.ok ? 'OK' : `FALLÓ: ${res?.msg ?? 'sin respuesta'}`}`);
            await sleep(900); // deja que la página reaccione
          }
        } finally {
          inTab(tab0.id, injectedClear, []).catch(() => {});
        }
        finishTask(final);
      };

      try {
        if (taskText !== null) {
          await runTask(taskText);
          return;
        }
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

  /** Abre una conversación guardada (detiene lo que esté en curso). */
  const load = useCallback(
    (list: Message[]) => {
      stop();
      setMessages(list);
    },
    [stop],
  );

  return { messages, running, send, stop, resolveApproval, togglePlan, reset, load };
}
