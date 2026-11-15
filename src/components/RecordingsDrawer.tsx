import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  Camera,
  ChevronRight,
  Keyboard,
  ListChecks,
  MousePointerClick,
  MoveVertical,
  Navigation,
  Pencil,
  Play,
  Send,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { RecordedAction, SavedFlow } from '../types';
import { describeAction } from '../lib/flows';
import { whenLabel } from '../lib/history';

const ICONS: Record<RecordedAction['type'], LucideIcon> = {
  click: MousePointerClick,
  input: Keyboard,
  select: ListChecks,
  submit: Send,
  navigate: Navigation,
  key: Keyboard,
  scroll: MoveVertical,
  capture: Camera,
};

interface Props {
  open: boolean;
  onClose: () => void;
  flows: SavedFlow[];
  busy: boolean;
  onReplay: (flow: SavedFlow, actionId?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

/** Historial de grabaciones: panel propio (a la derecha), separado del historial de conversaciones. */
export default function RecordingsDrawer({ open, onClose, flows, busy, onReplay, onRename, onDelete, onClearAll }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    setConfirmId(null);
    setConfirmAll(false);
    setEditId(null);
  }, [open]);

  // Más reciente primero; el número (#) cuenta desde la grabación más antigua
  const { groups, numberOf } = useMemo(() => {
    const asc = [...flows].sort((a, b) => a.createdAt - b.createdAt);
    const numberOf = new Map(asc.map((f, i) => [f.id, i + 1]));
    const groups: { label: string; items: SavedFlow[] }[] = [];
    for (const f of [...asc].reverse()) {
      const label = whenLabel(f.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(f);
      else groups.push({ label, items: [f] });
    }
    return { groups, numberOf };
  }, [flows]);

  const saveName = (f: SavedFlow) => {
    const t = draft.trim().slice(0, 60);
    if (t && t !== f.title) onRename(f.id, t);
    setEditId(null);
  };

  const replay = (f: SavedFlow, actionId?: string) => {
    onClose();
    onReplay(f, actionId);
  };

  const btn = 'h-7 rounded-md px-2 text-xs font-medium';
  const iconBtn = 'grid h-7 w-7 shrink-0 place-items-center rounded-md text-mute hover:bg-paper hover:text-ink';

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            className="absolute inset-0 z-40 bg-ink/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.aside
            className="absolute inset-y-0 right-0 z-50 flex w-[88%] max-w-[330px] flex-col border-l border-line bg-paper shadow-pop"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            aria-label="Grabaciones"
          >
            <div className="flex h-12 items-center justify-between border-b border-line px-4">
              <h2 className="text-sm font-semibold">
                Grabaciones <span className="ml-1 font-normal text-mute">{flows.length}</span>
              </h2>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-bubble hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="thin-scroll flex-1 overflow-y-auto p-2">
              {flows.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] leading-snug text-mute">
                  Aún no hay grabaciones. Pulsa <span className="font-medium text-ink">Grabar</span> en la barra del chat y usa la
                  página: tus pasos quedarán aquí, y al tocarlos se repiten.
                </p>
              )}

              {groups.map((g) => (
                <section key={g.label} className="mb-2">
                  <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-mute">{g.label}</h3>
                  <ul className="space-y-1">
                    {g.items.map((f) => {
                      const expanded = openId === f.id;
                      return (
                        <li key={f.id} className="rounded-xl border border-line bg-card">
                          {confirmId === f.id ? (
                            <div className="flex items-center gap-2 px-2.5 py-2.5">
                              <span className="min-w-0 flex-1 truncate text-[13px]">¿Eliminar «{f.title}»?</span>
                              <button
                                onClick={() => {
                                  onDelete(f.id);
                                  setConfirmId(null);
                                }}
                                className={`${btn} bg-accent text-onaccent hover:bg-accent-hover`}
                              >
                                Sí
                              </button>
                              <button onClick={() => setConfirmId(null)} className={`${btn} border border-line hover:bg-paper`}>
                                No
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-1 p-1.5">
                                <button
                                  onClick={() => setOpenId(expanded ? null : f.id)}
                                  aria-expanded={expanded}
                                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left hover:bg-paper"
                                >
                                  <ChevronRight size={14} className={`shrink-0 text-mute transition-transform ${expanded ? 'rotate-90' : ''}`} />
                                  <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-accent-soft px-1 text-[11px] font-semibold text-accent-ink">
                                    {numberOf.get(f.id)}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    {editId === f.id ? (
                                      <input
                                        autoFocus
                                        value={draft}
                                        maxLength={60}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onBlur={() => saveName(f)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveName(f);
                                          if (e.key === 'Escape') setEditId(null);
                                        }}
                                        className="w-full rounded-md border border-accent/50 bg-paper px-1.5 py-0.5 text-[13px] outline-none"
                                      />
                                    ) : (
                                      <span className="block truncate text-[13px] font-medium">{f.title}</span>
                                    )}
                                    <span className="block truncate text-[11px] text-mute">
                                      {f.actions.length} {f.actions.length === 1 ? 'acción' : 'acciones'} · {f.host} · {hhmm(f.createdAt)}
                                    </span>
                                  </span>
                                </button>
                                <button
                                  onClick={() => replay(f)}
                                  disabled={busy}
                                  aria-label={`Repetir todo «${f.title}»`}
                                  title="Repetir todo el flujo en la página"
                                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-onaccent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Play size={13} fill="currentColor" />
                                </button>
                              </div>

                              <AnimatePresence initial={false}>
                                {expanded && (
                                  <m.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <p className="px-3 text-[11px] text-mute">Toca un paso para repetir solo ese.</p>
                                    <ol className="space-y-0.5 px-1.5 pb-1 pt-1">
                                      {f.actions.map((a, i) => {
                                        const Icon = ICONS[a.type];
                                        return (
                                          <li key={a.id}>
                                            <button
                                              onClick={() => replay(f, a.id)}
                                              disabled={busy}
                                              title="Repetir este paso en la página"
                                              className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                              <span className="mt-px w-4 shrink-0 text-right text-[11px] text-mute">{i + 1}</span>
                                              <Icon size={13} className="mt-0.5 shrink-0 text-accent-ink" />
                                              <span className="min-w-0 flex-1 break-words">{describeAction(a)}</span>
                                              <Play size={11} className="mt-0.5 shrink-0 text-accent-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ol>
                                    <div className="flex gap-1 border-t border-line px-2 py-1.5">
                                      <button
                                        onClick={() => {
                                          setDraft(f.title);
                                          setEditId(f.id);
                                        }}
                                        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-mute hover:bg-paper hover:text-ink"
                                      >
                                        <Pencil size={12} /> Renombrar
                                      </button>
                                      <button
                                        onClick={() => setConfirmId(f.id)}
                                        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-mute hover:bg-paper hover:text-ink"
                                      >
                                        <Trash2 size={12} /> Eliminar
                                      </button>
                                    </div>
                                  </m.div>
                                )}
                              </AnimatePresence>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {flows.length > 0 && (
              <div className="border-t border-line p-2">
                {confirmAll ? (
                  <div className="flex items-center gap-2 px-1">
                    <span className="flex-1 text-[13px]">¿Eliminar todas?</span>
                    <button
                      onClick={() => {
                        onClearAll();
                        setConfirmAll(false);
                      }}
                      className={`${btn} bg-accent text-onaccent hover:bg-accent-hover`}
                    >
                      Sí
                    </button>
                    <button onClick={() => setConfirmAll(false)} className={`${btn} border border-line hover:bg-bubble`}>
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmAll(true)}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-mute hover:bg-bubble hover:text-ink"
                  >
                    <Trash2 size={13} /> Eliminar todas
                  </button>
                )}
              </div>
            )}
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
