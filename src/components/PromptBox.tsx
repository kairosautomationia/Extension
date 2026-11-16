import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowUp, AudioLines, Camera, Check, ChevronDown, ExternalLink, FileText, Globe, Link2, Loader2, Mic, MousePointerClick, Paperclip, Plus, Square, X } from 'lucide-react';
import { BRANDS } from '../lib/brands';
import { AI_TARGETS, askInAi } from '../lib/aiLinks';
import type { VoiceState } from '../hooks/useVoiceAgent';
import type { Attachment, RecordedAction, TabInfo } from '../types';
import { describeAction } from '../lib/flows';
import { splitCommand } from '../lib/actions';
import { useClickOutside } from '../hooks/useClickOutside';
import { useDictation } from '../hooks/useDictation';

const LINE = 20; // px por línea (text-sm / leading-5)
const MIN_H = LINE * 2;
const MAX_H = LINE * 6;

const uid = () => Math.random().toString(36).slice(2, 10);


/** Comandos tipo skill: al escribir "/" aparecen y, una vez elegidos, se resaltan en azul. */
const COMMANDS = [{ name: '/hacer', desc: 'Actúa en la página: clic, escribir y desplazar' }];

const menuAnim = {
  initial: { opacity: 0, y: 6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.97 },
  transition: { duration: 0.12 },
};

const PLACEHOLDER_SHOT =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#EFECE6"/><rect x="14" y="14" width="212" height="14" rx="4" fill="#1E3A5F" opacity=".7"/><rect x="14" y="42" width="130" height="90" rx="6" fill="#E5E3DD"/><rect x="156" y="42" width="70" height="40" rx="6" fill="#E5E3DD"/></svg>`,
  );

interface Props {
  tab: TabInfo;
  running: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  /** Texto externo para precargar (p.ej. sugerencias). */
  draftSeed?: { text: string; n: number };
  recording: boolean;
  recSecs: number;
  recActions: RecordedAction[];
  recError: string | null;
  onToggleRecord: () => void;
  /** Sube cada vez que una repetición grabada pide una captura de pantalla. */
  captureSignal?: number;
  /** Se llama cuando el usuario hizo una captura (para anotarla si se está grabando). */
  onCaptured?: () => void;
  /** Agente de voz: estado, último error y botón. */
  voice?: VoiceState;
  voiceError?: { msg: string; n: number } | null;
  onVoiceToggle?: () => void;
}

function openLink(url: string) {
  try {
    void chrome.tabs.create({ url });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export default function PromptBox({ tab, running, onSend, onStop, draftSeed, recording, recSecs, recActions, recError, onToggleRecord, captureSignal = 0, onCaptured, voice = 'off', voiceError = null, onVoiceToggle }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tabLinked, setTabLinked] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const plusRef = useRef<HTMLDivElement>(null);
  const skillsRef = useRef<HTMLDivElement>(null);
  const voiceMenuRef = useRef<HTMLDivElement>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [voiceHover, setVoiceHover] = useState(false); // la flecha aparece al acercarte al micrófono
  const [chevFlash, setChevFlash] = useState(false); // y unos segundos después de elegir un modo
  useEffect(() => {
    if (!chevFlash) return;
    const t = setTimeout(() => setChevFlash(false), 2200);
    return () => clearTimeout(t);
  }, [chevFlash]);
  // Qué hace el botón del micrófono: dictar (voz a texto) o conversar con el agente de voz
  const [voiceMode, setVoiceMode] = useState<'dictado' | 'agente'>(() => {
    try {
      return localStorage.getItem('hanzo.voiceMode') === 'agente' ? 'agente' : 'dictado';
    } catch {
      return 'dictado';
    }
  });
  const dictBaseRef = useRef('');
  useClickOutside(voiceMenuRef, () => setVoiceMenuOpen(false), voiceMenuOpen);
  useClickOutside(plusRef, () => setPlusOpen(false), plusOpen);
  useClickOutside(skillsRef, () => setSkillsOpen(false), skillsOpen);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dict = useDictation(
    (fin, interim) => setText(`${dictBaseRef.current}${dictBaseRef.current ? (fin + interim).replace(/^\s+/, '') : fin + interim}`),
    (msg) => flash(msg),
  );
  const micOn = voiceMode === 'dictado' ? dict.listening : voice !== 'off'; // micrófono encendido
  const showChev = voiceHover || voiceMenuOpen || chevFlash || micOn;
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preview) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setPreview(null);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [preview]);

  // Autoajuste de altura: 2 líneas mín. / 6 máx.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_H), MAX_H)}px`;
  }, [text]);

  useEffect(() => {
    if (draftSeed?.n) {
      setText(draftSeed.text);
      taRef.current?.focus();
    }
  }, [draftSeed]);

  const submit = () => {
    const t = text.trim();
    if (!t || running) return;
    dict.stop();
    onSend(t, attachments);
    setText('');
    setAttachments([]);
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  };
  useEffect(() => {
    if (voiceError) flash(voiceError.msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceError]);

  /** Captura el área visible de la pestaña activa (no incluye el panel lateral). */
  const capture = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      let url: string;
      if (typeof chrome !== 'undefined' && chrome.tabs?.captureVisibleTab) {
        url = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
      } else {
        url = PLACEHOLDER_SHOT; // solo en `vite dev`, fuera de la extensión
      }
      setAttachments((a) => [...a, { id: uid(), kind: 'screenshot', name: `Captura de ${tab.host}`, url }]);
      onCaptured?.();
    } catch {
      flash('No se pudo capturar esta pestaña. Chrome no permite capturar páginas internas (chrome://) ni la tienda de extensiones.');
    } finally {
      setCapturing(false);
    }
  };

  // Una repetición grabada que incluye una captura la dispara aquí
  const captureRef = useRef(capture);
  captureRef.current = capture;
  useEffect(() => {
    if (captureSignal > 0) void captureRef.current();
  }, [captureSignal]);

  const onFiles = (files: FileList | null) => {
    Array.from(files ?? []).forEach((f) => {
      const isImg = f.type.startsWith('image/');
      const add = (url?: string) =>
        setAttachments((a) => [...a, { id: uid(), kind: isImg ? 'image' : 'file', name: f.name, url }]);
      if (isImg) {
        const r = new FileReader();
        r.onload = () => add(r.result as string);
        r.readAsDataURL(f);
      } else add();
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const canSend = text.trim().length > 0;

  // Menú de comandos: aparece al escribir "/" al inicio, antes del primer espacio
  const typed = text.toLowerCase();
  const menu = text.startsWith('/') && !/\s/.test(text) ? COMMANDS.filter((c) => c.name.startsWith(typed)) : [];
  const pickCommand = (name: string) => {
    setText(name + ' ');
    taRef.current?.focus();
  };
  const cmd = splitCommand(text);

  return (
    <div className="relative shrink-0 p-3">
      <AnimatePresence>
        {menu.length > 0 && (
          <m.div
            {...menuAnim}
            role="listbox"
            aria-label="Comandos"
            className="absolute inset-x-3 bottom-full z-40 mb-1 rounded-xl border border-line bg-card p-1.5 shadow-pop"
          >
            <p className="px-2.5 pb-1.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-mute">Habilidades</p>
            {menu.map((c) => (
              <button
                key={c.name}
                role="option"
                aria-selected
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickCommand(c.name)}
                className="flex w-full items-center gap-3 rounded-lg bg-blue-500/10 p-2.5 text-left"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  <MousePointerClick size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-tight text-blue-600 dark:text-blue-400">{c.name}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-mute">{c.desc}</span>
                </span>
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
      <div className={`rounded-2xl p-px shadow-float transition-colors ${running ? 'run-border' : 'bg-line focus-within:bg-accent/60'}`}>
      <div className="rounded-[15px] bg-card">
        <AnimatePresence initial={false}>
          {recording && (
            <m.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="border-b border-line px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="breathe h-2 w-2 rounded-full bg-red-500" />
                  <span className="font-medium">Grabando</span>
                  <span className="font-mono text-mute">
                    {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
                  </span>
                  <span className="ml-auto text-mute">
                    {recActions.length} {recActions.length === 1 ? 'acción' : 'acciones'}
                  </span>
                </div>
                <p className="mt-1 truncate text-mute">
                  {recActions.length ? describeAction(recActions[recActions.length - 1]) : 'Usa la página, voy anotando tus pasos.'}
                </p>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        {/* Contexto */}
        {(tabLinked || attachments.length > 0 || capturing) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {tabLinked && (
              <span className="flex max-w-full items-center gap-1 rounded-md bg-bubble py-1 pl-2 pr-1 text-xs text-ink">
                {tab.favIconUrl ? (
                  <img src={tab.favIconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" />
                ) : (
                  <Globe size={12} className="shrink-0 text-mute" />
                )}
                <span className="truncate">{tab.host}</span>
                <button
                  onClick={() => setTabLinked(false)}
                  aria-label="Desvincular pestaña"
                  className="grid h-4 w-4 place-items-center rounded text-mute hover:bg-line hover:text-ink"
                >
                  <X size={11} />
                </button>
              </span>
            )}
            {attachments.map((a) => (
              <span key={a.id} className="relative">
                {a.url ? (
                  <button onClick={() => setPreview(a)} aria-label={`Ver ${a.name}`} className="block rounded-md">
                    <img src={a.url} alt={a.name} className="h-12 w-20 rounded-md border border-line object-cover" />
                  </button>
                ) : (
                  <span className="flex h-7 items-center gap-1 rounded-md bg-bubble px-2 text-xs">
                    <FileText size={12} className="text-mute" />
                    <span className="max-w-[90px] truncate">{a.name}</span>
                  </span>
                )}
                <button
                  onClick={() => setAttachments((x) => x.filter((i) => i.id !== a.id))}
                  aria-label={`Quitar ${a.name}`}
                  className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-ink text-paper"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {capturing && <span aria-label="Capturando pantalla" className="h-12 w-20 animate-pulse rounded-md bg-bubble" />}
          </div>
        )}

        {(notice ?? recError) && (
          <p role="status" className="mx-3 mt-2 text-xs text-red-600 dark:text-red-400">
            {notice ?? recError}
          </p>
        )}

        {!tabLinked && (
          <button
            onClick={() => setTabLinked(true)}
            className="mx-3 mt-2.5 text-xs text-accent-ink underline-offset-2 hover:underline"
          >
            Vincular pestaña actual
          </button>
        )}

        <div className="relative">
          {/* Con un comando escrito, el texto se dibuja aquí (comando en azul) y el cuadro real queda transparente */}
          {cmd && (
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="whitespace-pre-wrap break-words px-3 pb-1 pt-2.5 text-sm text-ink"
                style={{ lineHeight: `${LINE}px`, transform: `translateY(${-scrollTop}px)` }}
              >
                {cmd.head}
                <span className="rounded bg-blue-500/15 font-medium text-blue-600 shadow-[0_0_0_2px_rgb(59_130_246/0.15)] dark:text-blue-400">
                  {cmd.cmd}
                </span>
                {cmd.rest}
                {'\u200b'}
              </div>
            </div>
          )}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (menu.length > 0 && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                e.preventDefault();
                pickCommand(menu[0].name);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Escribe una instrucción o tarea para esta página..."
            style={{ minHeight: MIN_H, maxHeight: MAX_H, lineHeight: `${LINE}px` }}
            className={`block w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm placeholder:text-mute/70 focus:outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              cmd ? 'mirror-ta text-transparent caret-ink' : 'text-ink'
            }`}
          />
        </div>

        {/* Herramientas */}
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <div ref={plusRef} className="relative">
            <button
              onClick={() => setPlusOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              aria-label={plusOpen ? 'Cerrar menú' : 'Añadir'}
              className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-bubble hover:text-ink"
            >
              <m.span animate={{ rotate: plusOpen ? 45 : 0 }} className="grid place-items-center">
                <Plus size={20} />
              </m.span>
            </button>
            <AnimatePresence>
              {plusOpen && (
                <m.div
                  {...menuAnim}
                  role="menu"
                  className="absolute bottom-10 left-0 z-40 w-56 rounded-xl border border-line bg-card p-1 shadow-pop"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setPlusOpen(false);
                      fileRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-[13px] hover:bg-paper"
                  >
                    <Paperclip size={16} className="text-mute" /> Seleccionar archivos
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setPlusOpen(false);
                      capture();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-[13px] hover:bg-paper"
                  >
                    <Camera size={16} className="text-mute" /> Captura de pantalla
                  </button>
                </m.div>
              )}
            </AnimatePresence>
          </div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />

          <button
            onClick={onToggleRecord}
            aria-pressed={recording}
            title={recording ? 'Detener y guardar la grabación' : 'Grabar mis acciones en la página'}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ${
              recording
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : 'text-mute hover:bg-bubble hover:text-ink'
            }`}
          >
            {recording ? (
              <Square size={11} fill="currentColor" className="text-red-500" />
            ) : (
              <span className="h-3 w-3 rounded-full bg-red-500" />
            )}
            {recording ? 'Detener' : 'Grabar'}
          </button>

          <div className="ml-auto flex items-center gap-1">
            <div ref={skillsRef} className="relative">
              <button
                onClick={() => setSkillsOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={skillsOpen}
                aria-label="Vínculos"
                title="Vínculos"
                className={`grid h-8 w-8 place-items-center rounded-full text-mute transition-colors hover:bg-bubble hover:text-ink ${skillsOpen ? 'bg-bubble text-ink' : ''}`}
              >
                <Link2 size={16} />
              </button>
              <AnimatePresence>
                {skillsOpen && (
                  <m.div
                    {...menuAnim}
                    role="dialog"
                    aria-label="Vínculos"
                    className="absolute bottom-10 right-0 z-40 w-64 rounded-xl border border-line bg-card p-1.5 shadow-pop"
                  >
                    <p className="px-2.5 pb-1.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-mute">Abrir en una pestaña nueva</p>
                    <div className="max-h-72 space-y-0.5 overflow-y-auto pr-0.5">
                      {BRANDS.map(({ name, url, color, d, gradient }) => {
                        // Si hay texto escrito (y no es una tarea /hacer), los asistentes de IA lo reciben directamente
                        const sendsText = !!AI_TARGETS[name] && text.trim().length > 0 && !/^\s*\//.test(text);
                        return (
                        <button
                          key={name}
                          onClick={() => {
                            setSkillsOpen(false);
                            if (sendsText) {
                              const t = text;
                              void askInAi(name, t).then((msg) => {
                                if (msg) flash(msg);
                              });
                              setText('');
                            } else openLink(url);
                          }}
                          className="group flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-paper"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-black/5">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill={gradient ? `url(#g-${name})` : color} aria-hidden="true">
                              {gradient && (
                                <defs>
                                  <linearGradient id={`g-${name}`} x1="0" y1="0" x2="1" y2="1">
                                    {gradient.map((c, i) => (
                                      <stop key={c} offset={i / (gradient.length - 1)} stopColor={c} />
                                    ))}
                                  </linearGradient>
                                </defs>
                              )}
                              <path d={d} />
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{name}</span>
                          {sendsText && <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">Enviar texto</span>}
                          <ExternalLink size={13} className="shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                        );
                      })}
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            </div>

            <div
              ref={voiceMenuRef}
              className="relative flex items-center rounded-xl"
              onMouseEnter={() => setVoiceHover(true)}
              onMouseLeave={() => setVoiceHover(false)}
              onFocusCapture={() => setVoiceHover(true)}
              onBlurCapture={() => setVoiceHover(false)}
            >
              {/* Fondo de la pastilla: se despliega desde el micrófono hacia la izquierda */}
              <AnimatePresence>
                {showChev && (
                  <m.span
                    aria-hidden
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.08 }}
                    className="pointer-events-none absolute inset-0 rounded-xl bg-ink/[0.06]"
                  />
                )}
              </AnimatePresence>
              {/* El hueco de la flecha crece al aparecer y empuja Vínculos a la izquierda; el micrófono no se mueve */}
              <m.div
                className="relative grid h-8 place-items-center overflow-hidden"
                initial={false}
                animate={{ width: showChev ? 32 : 0 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
              >
                <AnimatePresence>
                  {showChev && (
                    <m.button
                      type="button"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.08 }}
                      onClick={() => setVoiceMenuOpen((o) => !o)}
                      aria-haspopup="menu"
                      aria-expanded={voiceMenuOpen}
                      aria-label="Elegir entre dictado y agente de voz"
                      title="Dictado o agente de voz"
                      className={`grid h-8 w-8 place-items-center rounded-xl text-mute transition-colors hover:text-ink ${voiceMenuOpen ? 'bg-ink/[0.16] text-ink' : 'bg-ink/[0.10]'}`}
                    >
                      <ChevronDown size={14} className={`transition-transform duration-200 ${voiceMenuOpen ? 'rotate-180' : ''}`} />
                    </m.button>
                  )}
                </AnimatePresence>
              </m.div>
              <AnimatePresence>
                {voiceMenuOpen && (
                  <m.div
                    role="menu"
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.97 }}
                    transition={{ duration: 0.14 }}
                    className="absolute bottom-10 right-0 z-40 w-60 rounded-xl border border-line bg-card p-1 shadow-pop"
                  >
                    {(
                      [
                        { id: 'dictado', label: 'Dictado', hint: 'Convierte tu voz en texto', Icon: Mic },
                        { id: 'agente', label: 'Agente de voz', hint: 'Conversa y le pides tareas', Icon: AudioLines },
                      ] as const
                    ).map(({ id, label, hint, Icon }) => (
                      <button
                        key={id}
                        role="menuitemradio"
                        aria-checked={voiceMode === id}
                        onClick={() => {
                          if (id !== voiceMode) {
                            dict.stop();
                            if (voice !== 'off') onVoiceToggle?.();
                            setVoiceMode(id);
                            setChevFlash(true);
                            try {
                              localStorage.setItem('hanzo.voiceMode', id);
                            } catch {
                              /* sin almacenamiento */
                            }
                          }
                          setVoiceMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-paper"
                      >
                        <Icon size={16} className="shrink-0 text-mute" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{label}</span>
                          <span className="block text-[11.5px] leading-snug text-mute">{hint}</span>
                        </span>
                        {voiceMode === id && <Check size={15} className="shrink-0 text-accent" />}
                      </button>
                    ))}
                  </m.div>
                )}
              </AnimatePresence>
              <m.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  setChevFlash(true); // al seleccionar el icono se despliega la flecha
                  if (voiceMode === 'agente') {
                    dict.stop();
                    onVoiceToggle?.();
                  } else if (dict.listening) dict.stop();
                  else {
                    if (voice !== 'off') onVoiceToggle?.(); // el agente de voz usa el mismo micrófono
                    const cur = text;
                    dictBaseRef.current = cur && !/\s$/.test(cur) ? `${cur} ` : cur;
                    void dict.start();
                  }
                }}
                aria-label={
                  voiceMode === 'dictado'
                    ? dict.listening ? 'Terminar el dictado' : 'Dictar con el micrófono'
                    : voice === 'off' ? 'Hablar con el agente de voz' : 'Terminar la conversación de voz'
                }
                aria-pressed={voiceMode === 'dictado' ? dict.listening : voice !== 'off'}
                title={voiceMode === 'dictado' ? (dict.listening ? 'Te escucho: habla y se escribe (pulsa para terminar)' : 'Dictar: voz a texto') : voice === 'off' ? 'Agente de voz' : voice === 'connecting' ? 'Conectando…' : voice === 'speaking' ? 'Hanzo está hablando (pulsa para terminar)' : 'Te escucho (pulsa para terminar)'}
                className={`relative grid h-8 w-8 place-items-center rounded-xl transition-colors ${
                  (voiceMode === 'dictado' ? !dict.listening : voice === 'off') ? (showChev ? 'text-ink' : 'text-mute hover:bg-accent-soft hover:text-accent-ink') : 'text-ink'
                }`}
              >
                {((voiceMode === 'agente' && (voice === 'listening' || voice === 'speaking')) || (voiceMode === 'dictado' && dict.listening)) && (
                  <m.span
                    aria-hidden
                    className="absolute inset-1 rounded-lg bg-ink/[0.12]"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.7, 0.2, 0.7] }}
                    transition={{ duration: voice === 'speaking' ? 0.9 : 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                {voiceMode === 'agente' && voice === 'connecting' ? (
                  <Loader2 size={16} className="relative animate-spin" />
                ) : voiceMode === 'dictado' ? (
                  <Mic size={17} strokeWidth={2} className="relative" />
                ) : (
                  <AudioLines size={17} strokeWidth={2} className="relative" />
                )}
              </m.button>
            </div>

            {running ? (
              <button
                onClick={onStop}
                aria-label="Detener"
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                aria-label="Enviar"
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      <AnimatePresence>
        {preview?.url && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreview(null)}
            className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-ink/70 p-4"
          >
            <img src={preview.url} alt={preview.name} className="max-h-full max-w-full rounded-lg shadow-pop" />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
