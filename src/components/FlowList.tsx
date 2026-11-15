import { useMemo, useState } from 'react';
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

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

/** Historial de grabaciones dentro de la etiqueta: ordenado (más reciente primero, por día) y numerado. */
export default function FlowList({
  flows,
  busy,
  onReplay,
  onRename,
  onDelete,
  onClearAll,
}: {
  flows: SavedFlow[];
  busy: boolean;
  onReplay: (flow: SavedFlow, actionId?: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // El número (#) cuenta desde la grabación más antigua; la lista muestra primero la más reciente
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

  if (flows.length === 0) {
    return (
      <p className="px-3 py-4 text-[13px] leading-snug text-mute">
        Aún no hay acciones grabadas. Pulsa <span className="font-medium text-ink">Grabar</span> en la barra del chat y
        usa la página: tus pasos quedarán guardados aquí. Al tocarlos, se repiten en la página.
      </p>
    );
  }

  const saveName = (f: SavedFlow) => {
    const t = draft.trim().slice(0, 60);
    if (t && t !== f.title) onRename(f.id, t);
    setEditId(null);
  };

  const small = 'h-7 rounded-md px-2 text-xs font-medium';

  return (
    <div>
      {groups.map((g) => (
        <section key={g.label}>
          <h4 className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-mute">{g.label}</h4>
          <ul className="space-y-0.5">
            {g.items.map((f) => {
              const open = openId === f.id;
              return (
                <li key={f.id} className="rounded-lg">
                  {confirmId === f.id ? (
                    <div className="flex items-center gap-2 rounded-lg bg-bubble px-2 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]">¿Eliminar «{f.title}»?</span>
                      <button
                        onClick={() => {
                          onDelete(f.id);
                          setConfirmId(null);
                        }}
                        className={`${small} bg-accent text-onaccent hover:bg-accent-hover`}
                      >
                        Sí
                      </button>
                      <button onClick={() => setConfirmId(null)} className={`${small} border border-line hover:bg-paper`}>
                        No
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-0.5 rounded-lg hover:bg-paper">
                        <button
                          onClick={() => setOpenId(open ? null : f.id)}
                          aria-expanded={open}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left"
                        >
                          <ChevronRight size={14} className={`shrink-0 text-mute transition-transform ${open ? 'rotate-90' : ''}`} />
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent-ink">
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
                                className="w-full rounded border border-accent/50 bg-paper px-1.5 py-0.5 text-[13px] outline-none"
                              />
                            ) : (
                              <span className="block truncate text-[13px] font-medium">{f.title}</span>
                            )}
                            <span className="block truncate text-[11px] text-mute">
                              {f.actions.length} {f.actions.length === 1 ? 'acción' : 'acciones'} · {hhmm(f.createdAt)}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => onReplay(f)}
                          disabled={busy}
                          aria-label={`Repetir todo «${f.title}»`}
                          title="Repetir todo el flujo en la página"
                          className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-onaccent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Play size={12} fill="currentColor" />
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {open && (
                          <m.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <p className="px-2 pl-8 text-[11px] text-mute">Toca un paso para repetir solo ese.</p>
                            <ol className="space-y-0.5 px-1 pb-1 pl-6 pt-1">
                              {f.actions.map((a, i) => {
                                const Icon = ICONS[a.type];
                                return (
                                  <li key={a.id}>
                                    <button
                                      onClick={() => onReplay(f, a.id)}
                                      disabled={busy}
                                      title="Repetir este paso en la página"
                                      className="group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <span className="mt-px w-3.5 shrink-0 text-right text-[11px] text-mute">{i + 1}</span>
                                      <Icon size={13} className="mt-0.5 shrink-0 text-accent-ink" />
                                      <span className="min-w-0 flex-1 break-words">{describeAction(a)}</span>
                                      <Play size={11} className="mt-0.5 shrink-0 text-accent-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                                    </button>
                                  </li>
                                );
                              })}
                            </ol>
                            <div className="flex gap-1 px-2 pb-2 pl-8">
                              <button
                                onClick={() => {
                                  setDraft(f.title);
                                  setEditId(f.id);
                                }}
                                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-mute hover:bg-bubble hover:text-ink"
                              >
                                <Pencil size={12} /> Renombrar
                              </button>
                              <button
                                onClick={() => setConfirmId(f.id)}
                                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-mute hover:bg-bubble hover:text-ink"
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

      <div className="mt-1 px-1">
        {confirmAll ? (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="flex-1 text-[13px]">¿Eliminar todas?</span>
            <button
              onClick={() => {
                onClearAll();
                setConfirmAll(false);
              }}
              className={`${small} bg-accent text-onaccent hover:bg-accent-hover`}
            >
              Sí
            </button>
            <button onClick={() => setConfirmAll(false)} className={`${small} border border-line hover:bg-bubble`}>
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmAll(true)}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium text-mute hover:bg-bubble hover:text-ink"
          >
            <Trash2 size={12} /> Eliminar todas las grabaciones
          </button>
        )}
      </div>
    </div>
  );
}
