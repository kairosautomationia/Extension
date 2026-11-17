import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMessage, Attachment, Message, PermissionMode, PlanStep, SavedFlow } from '../types';
import { describeAction as describeRecorded } from '../lib/flows';
import { hostOf, injectedFind, injectedReplayAct, injectedScrollTo, sameUrl, waitReady, type FindRes } from '../lib/replay';
import { readPageContext, streamAgent, type ApiMessage } from '../lib/api';
import { tableToMarkdown } from '../lib/exportDoc';
import { describePc, installHelp, parsePc, PC_MAX_STEPS, PcConn, PcError, pcResultText, pcRisky, requestPc, type PcPlan, type PcSnapshot } from '../lib/pc';
import {
  MAX_STEPS,
  type ActPlan,
  activeTabId,
  describeAction,
  inTab,
  injectedAct,
  injectedClear,
  injectedHighlight,
  injectedSnapshot,
  injectedTables,
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
export function useAgent(mode: PermissionMode, opts: { onCapture?: () => void; onFlowRun?: (flowId: string, result: 'ok' | 'fail', note?: string) => void } = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const approvalRef = useRef<((ok: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const pcRef = useRef<PcConn | null>(null); // conexión con Hanzo PC durante una tarea /pc
  const messagesRef = useRef<Message[]>([]);
  const modeRef = useRef<PermissionMode>(mode);
  const onCaptureRef = useRef(opts.onCapture);
  onCaptureRef.current = opts.onCapture;
  const onFlowRunRef = useRef(opts.onFlowRun);
  onFlowRunRef.current = opts.onFlowRun;

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
    async (text: string, attachments: Attachment[] = [], shown?: string) => {
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
      const pcText = taskText === null ? parsePc(text) : null;
      const isTask = taskText !== null || pcText !== null;
      const baseSteps: Omit<PlanStep, 'id' | 'state'>[] =
        pcText !== null ? [{ code: 'connect("hanzo_pc")', label: 'Conectar con Hanzo PC' }] : isTask ? [{ code: 'snapshot()', label: 'Preparar la pestaña' }] : READ_STEPS;
      const steps: PlanStep[] = baseSteps.map((s) => ({
        ...s,
        id: uid(),
        state: 'pending',
      }));
      setMessages((ms) => [
        ...ms,
        { id: uid(), role: 'user', text: shown ?? text, attachments },
        // En chat normal los pasos internos van en segundo plano; solo las tareas /hacer muestran el plan.
        { id, role: 'agent', plan: isTask ? { steps, open: !shown, done: false } : undefined, streaming: true },
      ]);
      setRunning(true);

      const setStep = (i: number, state: PlanStep['state']) =>
        patch(id, (m) => ({
          ...m,
          plan: m.plan && { ...m.plan, steps: m.plan.steps.map((s, k) => (k === i ? { ...s, state } : s)) },
        }));

      const getMode = (): PermissionMode => modeRef.current; // se lee en cada paso: el usuario puede cambiar de modo
      const finishTask = (answer: string) =>
        // Al completar la tarea el plan se cierra solo; si algún paso quedó sin hacer, se deja abierto para ver cuál
        patch(id, (m) => ({
          ...m,
          answer,
          streaming: false,
          plan: m.plan && { ...m.plan, done: true, open: m.plan.steps.some((s) => s.state === 'skipped') ? m.plan.open : false },
        }));

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
        // Pestaña nueva o interna (chrome://…): no se puede leer, pero sí abrir una web en ella
        const tabId = tab0?.id ?? (await activeTabId());
        check();
        if (tabId === null) {
          setStep(0, 'skipped');
          finishTask('No encuentro una pestaña donde actuar. Abre una pestaña del navegador e inténtalo de nuevo.');
          return;
        }
        let baseHost = tab0?.host ?? '';
        if (tab0 && isBlockedHost(tab0.host)) {
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
            const cur = await tabState(tabId);
            check();
            if (cur && baseHost && cur.host !== baseHost) {
              final = `La pestaña cambió a **${cur.host}**. Por seguridad me detuve; vuelve a pedirme la tarea desde ahí.`;
              break;
            }
            if (cur && !baseHost) baseHost = cur.host;
            if (!cur && baseHost) {
              final = 'La pestaña ya no es una página web; me detuve.';
              break;
            }
            // Desde el primer instante la página muestra que Hanzo está trabajando (borde, barra y cursor), también mientras el modelo piensa
            if (cur) await inTab(tabId, injectedHighlight, [null, '']).catch(() => undefined);
            check();
            // Sin página web (pestaña nueva): no hay elementos y lo único posible es abrir una dirección
            const snap = cur ? await inTab(tabId, injectedSnapshot, []) : { els: [], scrollY: 0, scrollMax: 0 };
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
                  page: { title: cur?.title ?? '', url: cur?.url ?? '' },
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
            if (a.type === 'open') {
              let target: URL | null = null;
              try {
                target = a.url ? new URL(a.url) : null;
              } catch {
                target = null;
              }
              if (!target || (target.protocol !== 'https:' && target.protocol !== 'http:')) {
                history.push('Acción inválida: dirección no permitida');
                if (++bad >= 3) {
                  final = 'No logré decidir una dirección segura. Prueba con una tarea más concreta.';
                  break;
                }
                continue;
              }
              const odesc = describeAction(a);
              if (isBlockedHost(target.hostname)) {
                addStep(`open("${target.hostname}")`, `Bloqueado: ${odesc}`, 'skipped');
                history.push(`BLOQUEADO: ${target.hostname} es banca o pagos; Hanzo no actúa ahí`);
                if (++bad >= 3) {
                  final = `Por seguridad, Hanzo no abre ni actúa en **${target.hostname}** (banca y pagos).`;
                  break;
                }
                continue;
              }
              bad = 0;
              const oi = addStep(`open("${target.hostname}")`, odesc.charAt(0).toUpperCase() + odesc.slice(1), 'running');
              // Cambiar de sitio: en Automático se hace de inmediato; en Manual pide tu aprobación
              let okOpen = true;
              if (getMode() !== 'auto') {
                patch(id, (m) => ({ ...m, approval: { action: odesc, state: 'pending' } }));
                okOpen = await new Promise<boolean>((resolve) => {
                  approvalRef.current = resolve;
                });
                approvalRef.current = null;
                check();
                patch(id, (m) => ({ ...m, approval: m.approval && { ...m.approval, state: okOpen ? 'approved' : 'rejected' } }));
              }
              if (!okOpen) {
                setStep(oi, 'skipped');
                final = 'Rechazaste abrir esa página; detuve la tarea.';
                break;
              }
              await chrome.tabs.update(tabId, { url: target.href });
              await waitReady(tabId);
              check();
              const now = await tabState(tabId);
              setStep(oi, now ? 'done' : 'skipped');
              if (!now) {
                final = 'No pude abrir esa página.';
                break;
              }
              if (isBlockedHost(now.host)) {
                final = `Por seguridad, Hanzo no actúa en **${now.host}** (banca y pagos).`;
                break;
              }
              baseHost = now.host; // abrir fue una decisión aprobada: el sitio nuevo pasa a ser la base
              history.push(`Abrí ${now.host}`);
              await sleep(600);
              continue;
            }
            if (!cur) {
              final = 'Esta pestaña no es una página web; primero hay que abrir una dirección.';
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

            await inTab(tabId, injectedHighlight, [el ? el.id : null, desc]);
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

            const res = await inTab(tabId, injectedAct, [a]);
            check();
            setStep(si, res?.ok ? 'done' : 'skipped');
            history.push(`${desc} → ${res?.ok ? 'OK' : `FALLÓ: ${res?.msg ?? 'sin respuesta'}`}`);
            await sleep(900); // deja que la página reaccione
          }
        } finally {
          inTab(tabId, injectedClear, []).catch(() => {});
        }
        finishTask(final);
      };

      /** "/pc <tarea>": el mismo ciclo que /hacer, pero sobre ventanas de Windows a través de Hanzo PC. */
      const runPc = async (task: string) => {
        if (getMode() === 'readonly') {
          setStep(0, 'skipped');
          finishTask('Estás en modo **Solo lectura**. Cambia a Manual o Automático para que pueda usar apps de escritorio.');
          return;
        }
        if (!task) {
          setStep(0, 'skipped');
          finishTask('Escribe la tarea después de `/pc`. Ejemplo: `/pc abre el bloc de notas y escribe "hola"`.');
          return;
        }
        setStep(0, 'running');
        const conn = new PcConn();
        pcRef.current = conn;
        let info: Record<string, unknown>;
        try {
          conn.connect();
          info = await conn.call('ping', {}, 15000);
          check();
        } catch (e) {
          check();
          conn.close();
          setStep(0, 'skipped');
          const kind = e instanceof PcError ? e.kind : 'closed';
          finishTask(kind === 'missing' || kind === 'forbidden' ? installHelp(kind) : `No pude conectar con Hanzo PC: ${e instanceof Error ? e.message : 'error desconocido'}`);
          return;
        }
        if (info.error) {
          conn.close();
          setStep(0, 'skipped');
          finishTask(String(info.error));
          return;
        }
        setStep(0, 'done');
        const apps = (info.apps as string[]) ?? [];
        const folders = (info.folders as string[]) ?? [];

        let stepCount = 1;
        const addStep = (code: string, label: string, state: PlanStep['state']) => {
          const i = stepCount++;
          patch(id, (m) => ({
            ...m,
            plan: m.plan && { ...m.plan, steps: [...m.plan.steps, { id: uid(), code, label, state }] },
          }));
          return i;
        };
        const approve = async (desc: string) => {
          patch(id, (m) => ({ ...m, approval: { action: desc, state: 'pending' } }));
          const ok = await new Promise<boolean>((resolve) => {
            approvalRef.current = resolve;
          });
          approvalRef.current = null;
          check();
          patch(id, (m) => ({ ...m, approval: m.approval && { ...m.approval, state: ok ? 'approved' : 'rejected' } }));
          return ok;
        };

        const history: string[] = [];
        let final = `Llegué al límite de ${PC_MAX_STEPS} pasos y me detuve por seguridad. Revisa cómo quedó la ventana.`;
        let bad = 0;
        try {
          for (let n = 0; n < PC_MAX_STEPS; n++) {
            check();
            if (getMode() === 'readonly') {
              final = 'Cambiaste a Solo lectura; me detuve.';
              break;
            }
            let snap: PcSnapshot;
            try {
              snap = (await conn.call('snapshot', {}, 25000)) as unknown as PcSnapshot;
            } catch (e) {
              check();
              final = `No pude leer las ventanas: ${e instanceof Error ? e.message : 'error'}`;
              break;
            }
            check();

            const ctrl = new AbortController();
            abortRef.current = ctrl;
            let plan: PcPlan;
            try {
              plan = await requestPc(
                { task, window: snap.window, windows: snap.windows ?? [], elements: snap.els ?? [], apps, folders, history },
                ctrl.signal,
              );
            } catch (err) {
              check();
              final = `No pude contactar al modelo: ${err instanceof Error ? err.message : 'error desconocido'}`;
              break;
            }
            check();

            const a = plan.action;
            if (a.type === 'done' || a.type === 'ask') {
              final = plan.say || (a.type === 'done' ? 'Listo.' : 'Necesito más datos.');
              break;
            }
            const el = a.id !== undefined ? (snap.els ?? []).find((e) => e.id === a.id) : undefined;
            const win = a.window !== undefined ? (snap.windows ?? []).find((w) => w.id === a.window) : undefined;
            if ((a.type === 'click' || a.type === 'type') && !el) {
              history.push('Acción inválida: ese elemento no existe');
              if (++bad >= 3) {
                final = 'No logré decidir una acción segura. Prueba con una tarea más concreta.';
                break;
              }
              continue;
            }
            const desc = describePc(a, el, win);
            if (el?.risk === 'blocked') {
              addStep(`${a.type}(#${el.id})`, `Bloqueado: ${desc}`, 'skipped');
              history.push(`BLOQUEADO: «${el.label}» es un campo de contraseña; no puedes usarlo`);
              if (++bad >= 3) {
                final = 'La tarea requiere un campo de contraseña. Eso lo debes llenar tú.';
                break;
              }
              continue;
            }
            bad = 0;
            const code = a.type === 'click' || a.type === 'type' ? `${a.type}(#${a.id})` : `${a.type}()`;
            const si = addStep(code, desc.charAt(0).toUpperCase() + desc.slice(1), 'running');
            const risky = pcRisky(a, el);
            // Leer o buscar no cambia nada: no pide permiso. Lo demás se aprueba en Manual, y lo sensible siempre.
            const readOnly = a.type === 'find_file' || a.type === 'excel_read';
            if (!readOnly && (getMode() === 'manual' || risky)) {
              if (!(await approve(desc + (risky ? ' (acción sensible)' : '')))) {
                setStep(si, 'skipped');
                final = 'Rechazaste la acción; detuve la tarea.';
                break;
              }
            }
            const args: Record<string, unknown> =
              a.type === 'open'
                ? { app: a.app }
                : a.type === 'focus'
                  ? { window: a.window }
                  : a.type === 'click'
                    ? { el: a.id }
                    : a.type === 'type'
                      ? { el: a.id, text: a.text }
                      : a.type === 'key'
                        ? { keys: a.keys }
                        : a.type === 'find_file'
                          ? { name: a.name }
                          : { path: a.path, cell: a.cell, text: a.text, sheet: a.sheet };
            try {
              const r = await conn.call(a.type, args, a.type === 'open' ? 20000 : 30000);
              check();
              setStep(si, 'done');
              history.push(`${desc} → ${pcResultText(a, r)}`);
            } catch (e) {
              check();
              setStep(si, 'skipped');
              const msg = e instanceof Error ? e.message : 'sin respuesta';
              history.push(`${desc} → FALLÓ: ${msg}`);
              if (e instanceof PcError && e.kind !== 'host') {
                final = `Se perdió la conexión con Hanzo PC: ${msg}`;
                break;
              }
            }
            await sleep(a.type === 'open' ? 800 : 400); // deja que la ventana reaccione
          }
        } finally {
          conn.close();
          if (pcRef.current === conn) pcRef.current = null;
        }
        finishTask(final);
      };

      try {
        if (pcText !== null) {
          await runPc(pcText);
          return;
        }
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
          if (m.local) continue; // lo hecho solo en la extensión (tablas extraídas) no va al modelo
          if (m.role === 'user') history.push({ role: 'user', content: m.text });
          else if (m.answer) history.push({ role: 'assistant', content: m.answer });
        }
        history.push({ role: 'user', content: text });

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        let acc = '';
        // Los fragmentos llegan decenas de veces por segundo: se pintan como mucho una vez por fotograma
        // (evita volver a dibujar todo el chat en cada fragmento y que el panel se sienta pesado).
        let raf = 0;
        const flush = () => {
          raf = 0;
          const text = acc;
          patch(id, (m) => ({ ...m, answer: text }));
        };
        const cancelFlush = () => {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
        };
        try {
          await streamAgent({ messages: history, page, image }, (t) => {
            acc += t;
            if (!raf) raf = requestAnimationFrame(flush);
          }, ctrl.signal);
          cancelFlush();
          if (acc) flush();
        } catch (err) {
          cancelFlush();
          if (acc && token.cancelled) flush(); // al detener se conserva lo ya escrito
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

      // Abrir una página: en Automático se hace de inmediato; en Manual se pide aprobación (los sitios de banca/pagos siguen bloqueados)
      const askOpen = async (text: string) => (modeRef.current === 'auto' ? true : ask(text));

      let final = onlyId ? 'Listo: repetí la acción.' : 'Listo: repetí todas las acciones grabadas.';
      let completed = false;
      let began = false; // llegó a ejecutar al menos un paso
      let wasCancelled = false;
      let tabId: number | null = null;
      try {
        if (getMode() === 'readonly') {
          final = 'Estás en modo **Solo lectura**. Cambia a Manual o Automático para que pueda actuar en la página.';
          return;
        }
        let t0 = await tabState();
        check();
        // Pestaña nueva o interna: si el flujo tiene página de inicio, se abre con tu aprobación
        const startFirst = onlyId ? undefined : flow.startUrl;
        if (!t0 && startFirst && /^https?:/.test(startFirst) && !isBlockedHost(hostOf(startFirst))) {
          const aid = await activeTabId();
          check();
          if (aid !== null) {
            if (!(await askOpen(`abrir ${startFirst} para empezar el flujo`))) {
              final = 'No abrí la página de inicio; detuve la repetición.';
              return;
            }
            await chrome.tabs.update(aid, { url: startFirst });
            await waitReady(aid);
            check();
            t0 = await tabState(aid);
          }
        }
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
          if (!(await askOpen(`abrir ${startUrl} para empezar el flujo`))) {
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
          began = true;

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
              if (!(await askOpen(`abrir ${a.url}`))) {
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
          // Solo cuenta la repetición completa del flujo (no un paso suelto) y solo si no la cancelaste
          if (!onlyId && began) onFlowRunRef.current?.(flow.id, completed ? 'ok' : 'fail', completed ? undefined : final.replace(/\*\*/g, ''));
          patch(id, (m) => ({
            ...m,
            answer: final,
            streaming: false,
            plan: m.plan && {
              ...m.plan,
              done: true,
              open: completed ? false : m.plan.open,
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
    pcRef.current?.close(); // corta al instante la acción de escritorio en curso
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

  // Botón "Detener" de la barra que Hanzo muestra en la página
  useEffect(() => {
    const onMsg = (m: { type?: string }, _s: unknown, reply: (r: boolean) => void) => {
      if (m?.type === 'hanzo-stop') {
        stop();
        reply(true); // confirma a la página que el panel sigue abierto y se encarga de limpiar
      }
    };
    try {
      chrome.runtime.onMessage.addListener(onMsg);
    } catch {
      return;
    }
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [stop]);

  /** Extrae las tablas de la pestaña activa y las muestra como tablas descargables. Todo ocurre en el navegador. */
  const extractTables = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true); // bloquea el envío mientras se leen las tablas, para no perder lo que se escriba
    const id = uid();
    setMessages((ms) => [
      ...ms,
      { id: uid(), role: 'user', text: 'Extraer las tablas de esta página', attachments: [], local: true },
      { id, role: 'agent', streaming: true, local: true },
    ]);
    const done = (answer: string) => patch(id, (m) => ({ ...m, answer, streaming: false }));
    try {
      const tabId = await activeTabId();
      if (tabId === null) return done('No encuentro una pestaña de la que leer. Abre una página con tablas e inténtalo de nuevo.');
      const r = await inTab(tabId, injectedTables, []);
      if (!r) return done('No pude leer esta página. Las páginas internas del navegador (chrome://) y la tienda de extensiones no se pueden leer.');
      if (r.tables.length === 0)
        return done('No encontré tablas en esta página. Si los datos se ven como tabla pero no se extraen, la página los dibuja de otra forma: pídeme que los lea y los ordene.');
      const parts = r.tables.map(
        (t, i) =>
          `## ${t.title || `Tabla ${i + 1}`}\n\n${tableToMarkdown(t.rows)}${t.cut ? `\n\n_Solo se leyeron las primeras ${t.rows.length - 1} filas de esta tabla._` : ''}`,
      );
      const extra = r.found > r.tables.length ? `\n\nHay ${r.found - r.tables.length} tablas más en la página que no se incluyeron (máximo ${r.tables.length}).` : '';
      const host = (await tabState(tabId))?.host;
      done(
        `# Tablas${host ? ` de ${host}` : ' de la página'}\n\nEncontré ${r.found} ${r.found === 1 ? 'tabla' : 'tablas'}. Descárgalas con **Descargar**: en Excel cada una queda en su hoja.\n\n${parts.join('\n\n')}${extra}`,
      );
    } catch {
      done('No pude leer las tablas de esta página.');
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [patch]);

  return { messages, running, send, replay, stop, resolveApproval, togglePlan, reset, load, extractTables };
}
