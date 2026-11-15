import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMessage, Attachment, Message, PermissionMode, PlanStep, SavedFlow } from '../types';
import { describeAction as describeRecorded } from '../lib/flows';
import { hostOf, injectedFind, injectedReplayAct, injectedScrollTo, sameUrl, waitReady, type FindRes } from '../lib/replay';
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
export function useAgent(mode: PermissionMode, opts: { onCapture?: () => void } = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const approvalRef = useRef<((ok: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const modeRef = useRef<PermissionMode>(mode);
  const onCaptureRef = useRef(opts.onCapture);
  onCaptureRef.current = opts.onCapture;

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


  /**
   * Repite acciones grabadas (todo el flujo, o una sola si se da `onlyId`) en la pestaña activa.
   * Pulsar "Repetir" es el permiso para los pasos normales; los sensibles (enviar, pagar, borrar…)
   * siempre piden aprobación, y los campos de contraseña o pago los completa la persona.
   */
  const replay = useCallback(
    async (flow: SavedFlow, onlyId?: string) => {
      if (runningRef.current) return;
      const list = onlyId ? flow.actions.filter((a) => a.id === onlyId) : flow.actions;
      if (list.length === 0) return;
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

      const getMode = (): PermissionMode => modeRef.current; // el usuario puede cambiar de modo a mitad
      const id = uid();
      const steps: PlanStep[] = list.map((a) => ({
        id: uid(),
        code: `${a.type}()`,
        label: describeRecorded(a),
        state: 'pending',
      }));
      setMessages((ms) => [
        ...ms,
        {
          id: uid(),
          role: 'user',
          text: onlyId ? `▶ Repetir: ${describeRecorded(list[0])}` : `▶ Repetir «${flow.title}»`,
          attachments: [],
        },
        { id, role: 'agent', replay: true, plan: { steps, open: true, done: false }, streaming: true },
      ]);
      setRunning(true);

      const setStep = (i: number, state: PlanStep['state']) =>
        patch(id, (m) => ({
          ...m,
          plan: m.plan && { ...m.plan, steps: m.plan.steps.map((s, k) => (k === i ? { ...s, state } : s)) },
        }));
      const ask = async (text: string) => {
        patch(id, (m) => ({ ...m, approval: { action: text, state: 'pending' } }));
        const ok = await new Promise<boolean>((resolve) => {
          approvalRef.current = resolve;
        });
        approvalRef.current = null;
        check();
        patch(id, (m) => ({ ...m, approval: m.approval && { ...m.approval, state: ok ? 'approved' : 'rejected' } }));
        return ok;
      };

      let final = onlyId ? 'Listo: repetí la acción.' : 'Listo: repetí todas las acciones grabadas.';
      let completed = false;
      let wasCancelled = false;
      let tabId: number | null = null;
      try {
        if (getMode() === 'readonly') {
          final = 'Estás en modo **Solo lectura**. Cambia a Manual o Automático para que pueda actuar en la página.';
          return;
        }
        const t0 = await tabState();
        check();
        if (!t0) {
          final = 'No puedo actuar en esta pestaña. Abre una página web normal (http o https).';
          return;
        }
        tabId = t0.id;
        if (isBlockedHost(t0.host)) {
          final = `Por seguridad, Hanzo no actúa en **${t0.host}** (banca y pagos).`;
          return;
        }

        // Punto de partida: solo se cambia de sitio con tu aprobación.
        const startHost = hostOf(onlyId ? list[0].url : flow.startUrl ?? list[0].url);
        if (startHost && startHost !== hostOf(t0.url)) {
          const startUrl = onlyId ? list[0].url : flow.startUrl ?? list[0].url;
          if (onlyId || isBlockedHost(startHost)) {
            final = isBlockedHost(startHost)
              ? `Por seguridad, Hanzo no actúa en **${startHost}** (banca y pagos).`
              : `Esta acción se grabó en **${startHost}**. Abre esa página y vuelve a pulsarla.`;
            return;
          }
          if (!(await ask(`abrir ${startUrl} para empezar el flujo`))) {
            final = 'No abrí la página de inicio; detuve la repetición.';
            return;
          }
          await chrome.tabs.update(t0.id, { url: startUrl });
          await waitReady(t0.id);
          check();
        }

        const tid = t0.id;
        let finished = true;
        for (let i = 0; i < list.length; i++) {
          check();
          if (getMode() === 'readonly') {
            final = 'Cambiaste a Solo lectura; me detuve.';
            finished = false;
            break;
          }
          const a = list[i];
          const prev = i > 0 ? list[i - 1] : undefined;
          const desc = describeRecorded(a);
          setStep(i, 'running');

          const cur = await tabState(tid);
          check();
          if (!cur) {
            final = 'La pestaña ya no está disponible; me detuve.';
            finished = false;
            break;
          }
          if (isBlockedHost(cur.host)) {
            final = `Por seguridad, Hanzo no actúa en **${cur.host}** (banca y pagos).`;
            finished = false;
            break;
          }

          if (a.type === 'capture') {
            onCaptureRef.current?.();
            setStep(i, 'done');
            await sleep(700);
            continue;
          }
          if (a.type === 'scroll') {
            await inTab(tid, injectedScrollTo, [Number(a.value) || 0]);
            setStep(i, 'done');
            await sleep(500);
            continue;
          }
          if (a.type === 'navigate') {
            if (!sameUrl(cur.url, a.url)) await waitReady(tid, 4000); // quizá el clic anterior ya está navegando
            const now = await tabState(tid);
            check();
            if (now && sameUrl(now.url, a.url)) {
              setStep(i, 'done');
              continue;
            }
            const target = hostOf(a.url);
            if (!target || isBlockedHost(target)) {
              final = `Por seguridad no abro ${target || 'esa dirección'}; me detuve.`;
              setStep(i, 'skipped');
              finished = false;
              break;
            }
            if (!now || target !== hostOf(now.url)) {
              if (!(await ask(`abrir ${a.url}`))) {
                final = 'Rechazaste abrir otra página; detuve la repetición.';
                setStep(i, 'skipped');
                finished = false;
                break;
              }
            }
            await chrome.tabs.update(tid, { url: a.url });
            await waitReady(tid);
            check();
            setStep(i, 'done');
            await sleep(500);
            continue;
          }

          // Acciones sobre un elemento: la página debe ser la que se grabó
          if (hostOf(a.url) && hostOf(a.url) !== hostOf(cur.url)) {
            final = `La página cambió a **${hostOf(cur.url)}** (se grabó en ${hostOf(a.url)}). Por seguridad me detuve.`;
            setStep(i, 'skipped');
            finished = false;
            break;
          }
          // Un envío que provocó el clic o Enter anterior ya se hizo con ese paso: no se repite
          if (a.type === 'submit' && prev && (prev.type === 'click' || prev.type === 'key') && a.t - prev.t < 1000) {
            setStep(i, 'done');
            continue;
          }

          let f: FindRes | undefined;
          for (let k = 0; k < 12; k++) {
            check();
            try {
              f = await inTab(tid, injectedFind, [{ selector: a.selector, label: a.label, type: a.type }]);
            } catch {
              f = undefined; // la página aún está cargando
            }
            if (f?.found) break;
            await sleep(500);
          }
          if (!f?.found) {
            final = `No encontré «${a.label || 'el elemento'}» en esta página. Abre la página donde empezó la grabación${
              flow.startUrl ? ` (${flow.startUrl})` : ''
            } y vuelve a intentarlo.`;
            setStep(i, 'skipped');
            finished = false;
            break;
          }

          await inTab(tid, injectedHighlight, [0, desc]);
          if (f.risk === 'blocked') {
            // Contraseñas, tarjetas, identidad: nunca se rellenan; lo hace la persona
            const ok = await ask(`que completes tú el campo «${f.label}» (dato sensible: no se guarda ni lo toco). Hazlo en la página y aprueba para continuar`);
            await inTab(tid, injectedClear, []).catch(() => {});
            if (!ok) {
              final = 'Detuve la repetición porque no se completó el campo sensible.';
              setStep(i, 'skipped');
              finished = false;
              break;
            }
            setStep(i, 'done');
            await sleep(400);
            continue;
          }
          if (f.risk === 'high' || a.type === 'submit') {
            if (!(await ask(`${desc} (acción sensible)`))) {
              final = 'Rechazaste la acción; detuve la repetición.';
              setStep(i, 'skipped');
              finished = false;
              break;
            }
          } else {
            await sleep(450); // alcanzas a ver qué se va a tocar
          }

          const res = await inTab(tid, injectedReplayAct, [{ type: a.type, value: a.value }]);
          check();
          if (!res?.ok) {
            final = `No pude ${desc.charAt(0).toLowerCase()}${desc.slice(1)}: ${res?.msg ?? 'sin respuesta'}.`;
            setStep(i, 'skipped');
            finished = false;
            break;
          }
          setStep(i, 'done');
          await sleep(500);
          await waitReady(tid, 8000); // si la acción abrió otra página, se espera a que cargue
          check();
        }
        completed = finished;
      } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
        wasCancelled = true;
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
        if (tabId !== null) inTab(tabId, injectedClear, []).catch(() => {});
        if (!wasCancelled) {
          patch(id, (m) => ({
            ...m,
            answer: final,
            streaming: false,
            plan: m.plan && {
              ...m.plan,
              done: true,
              steps: completed
                ? m.plan.steps
                : m.plan.steps.map((s) => (s.state === 'running' || s.state === 'pending' ? { ...s, state: 'skipped' } : s)),
            },
          }));
        }
        if (cancelRef.current === token) {
          runningRef.current = false;
          setRunning(false);
        }
      }
    },
    [patch],
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

  return { messages, running, send, replay, stop, resolveApproval, togglePlan, reset, load };
}
