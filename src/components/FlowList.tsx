import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import {
  Camera,
  ChevronRight,
  Download,
  Keyboard,
  ListChecks,
  MousePointerClick,
  MoveVertical,
  Navigation,
  Pencil,
  Play,
  Search,
  Send,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type { RecordedAction, SavedFlow } from '../types';
import { describeAction, exportFlows, parseImport } from '../lib/flows';
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

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ago = (ts: number) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'justo ahora';
  const min = Math.floor(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  return new Date(ts).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
};

const field =
  'w-full rounded-md border border-line bg-paper px-2 py-1.5 text-[13px] outline-none placeholder:text-mute/70 focus:border-accent/60';

/** Biblioteca de flujos: cada flujo tiene nombre, para qué sirve y etiquetas; se busca, se repite, se exporta e importa. */
export default function FlowList({
  flows,
  busy,
  nameId,
  onNamed,
  onReplay,
  onUpdate,
  onDelete,
  onClearAll,
  onImport,
}: {
  flows: SavedFlow[];
  busy: boolean;
  /** Flujo recién grabado: se abre su editor para ponerle nombre. */
  nameId: string | null;
  onNamed: () => void;
  onReplay: (flow: SavedFlow, actionId?: string) => void;
  onUpdate: (id: string, patch: { title?: string; description?: string; tags?: string[] }) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onImport: (list: SavedFlow[]) => number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [dTitle, setDTitle] = useState('');
  const [dDesc, setDDesc] = useState('');
  const [dTags, setDTags] = useState('');
  const [hintId, setHintId] = useState<string | null>(null); // flujo recién grabado
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const startEdit = (f: SavedFlow) => {
    setDTitle(f.title);
    setDDesc(f.description ?? '');
    setDTags((f.tags ?? []).join(', '));
    setEditId(f.id);
    setOpenId(f.id);
    setConfirmId(null);
  };

  // Al terminar una grabación se abre el editor de ese flujo para nombrarlo
  useEffect(() => {
    if (!nameId) return;
    const f = flows.find((x) => x.id === nameId);
    if (f) {
      startEdit(f);
      setHintId(f.id);
    }
    onNamed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const saveEdit = () => {
    if (!editId) return;
    if (!dTitle.trim()) return;
    onUpdate(editId, { title: dTitle, description: dDesc, tags: dTags.split(',') });
    setEditId(null);
  };

  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of flows) for (const t of f.tags ?? []) if (!seen.has(norm(t))) seen.set(norm(t), t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
  }, [flows]);

  const filtering = query.trim() !== '' || tag !== null;
  const visible = useMemo(() => {
    const q = norm(query.trim());
    return [...flows]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((f) => {
        if (tag && !(f.tags ?? []).some((t) => norm(t) === norm(tag))) return false;
        if (!q) return true;
        return norm([f.title, f.description ?? '', f.host, ...(f.tags ?? [])].join(' ')).includes(q);
      });
  }, [flows, query, tag]);

  const groups = useMemo(() => {
    const g: { label: string; items: SavedFlow[] }[] = [];
    for (const f of visible) {
      const label = whenLabel(f.createdAt);
      const last = g[g.length - 1];
      if (last && last.label === label) last.items.push(f);
      else g.push({ label, items: [f] });
    }
    return g;
  }, [visible]);

  const doExport = () => {
    try {
      const blob = new Blob([exportFlows(flows)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hanzo-flujos-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNotice(`Exporté ${flows.length} ${flows.length === 1 ? 'flujo' : 'flujos'}.`);
    } catch {
      setNotice('No se pudo exportar.');
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3_000_000) {
      setNotice('El archivo es demasiado grande.');
      return;
    }
    try {
      const list = parseImport(await file.text());
      if (list.length === 0) {
        setNotice('Ese archivo no tiene flujos válidos de Hanzo.');
        return;
      }
      const n = onImport(list);
      setNotice(n === list.length ? `Importé ${n} ${n === 1 ? 'flujo' : 'flujos'}.` : `Importé ${n} de ${list.length}: la biblioteca está llena.`);
    } catch {
      setNotice('No pude leer el archivo.');
    }
  };

  const small = 'h-7 rounded-md px-2 text-xs font-medium';

  return (
    <div>
      <div className="flex items-center gap-0.5 px-2 pb-1 pt-1.5">
        <p className="flex-1 text-[11px] font-medium uppercase tracking-wide text-mute">
          Biblioteca de flujos{flows.length > 0 && <span className="ml-1 normal-case tracking-normal">({flows.length})</span>}
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Importar flujos desde un archivo"
          title="Importar flujos (archivo .json)"
          className="grid h-7 w-7 place-items-center rounded-md text-mute hover:bg-bubble hover:text-ink"
        >
          <Upload size={14} />
        </button>
        <button
          onClick={doExport}
          disabled={flows.length === 0}
          aria-label="Exportar todos los flujos a un archivo"
          title="Exportar flujos (archivo .json)"
          className="grid h-7 w-7 place-items-center rounded-md text-mute hover:bg-bubble hover:text-ink disabled:opacity-40"
        >
          <Download size={14} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void doImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {notice && (
        <p role="status" className="mx-2 mb-1 rounded-md bg-accent-soft px-2 py-1 text-[11.5px] text-accent-ink">
          {notice}
        </p>
      )}

      {flows.length === 0 ? (
        <p className="px-3 pb-3 pt-1 text-[13px] leading-snug text-mute">
          Aún no tienes flujos. Pulsa <span className="font-medium text-ink">Grabar</span> en la barra del chat, haz la
          tarea en la página y ponle un nombre: quedará aquí para repetirla con un clic. También puedes importar los de
          otra persona con el botón de la flecha hacia arriba.
        </p>
      ) : (
        <>
          <div className="relative px-1.5 pb-1">
            <Search size={13} className="pointer-events-none absolute left-3.5 top-2 text-mute" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, uso o etiqueta"
              aria-label="Buscar flujos"
              className={`${field} pl-7`}
            />
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
              {allTags.map((t) => {
                const on = tag !== null && norm(tag) === norm(t);
                return (
                  <button
                    key={t}
                    onClick={() => setTag(on ? null : t)}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      on ? 'border-accent bg-accent text-onaccent' : 'border-line text-mute hover:border-accent/50 hover:text-ink'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}

          {visible.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-mute">Ningún flujo coincide con la búsqueda.</p>
          )}

          {groups.map((g) => (
            <section key={g.label}>
              {!filtering && (
                <h4 className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-mute">{g.label}</h4>
              )}
              <ul className="space-y-0.5">
                {g.items.map((f) => {
                  const open = openId === f.id;
                  const editing = editId === f.id;
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
                          <div className="flex items-start gap-0.5 rounded-lg hover:bg-paper">
                            <button
                              onClick={() => setOpenId(open ? null : f.id)}
                              aria-expanded={open}
                              className="flex min-w-0 flex-1 items-start gap-2 rounded-lg p-2 text-left"
                            >
                              <ChevronRight size={14} className={`mt-0.5 shrink-0 text-mute transition-transform ${open ? 'rotate-90' : ''}`} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold">{f.title}</span>
                                {f.description && <span className="mt-0.5 block text-[12px] leading-snug text-mute">{f.description}</span>}
                                {(f.tags?.length ?? 0) > 0 && (
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    {f.tags!.map((t) => (
                                      <span key={t} className="rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-medium text-accent-ink">
                                        {t}
                                      </span>
                                    ))}
                                  </span>
                                )}
                                <span className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-mute">
                                  <span
                                    aria-hidden
                                    className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                                      f.lastResult === 'ok' ? 'bg-emerald-500' : f.lastResult === 'fail' ? 'bg-amber-500' : 'bg-mute/40'
                                    }`}
                                  />
                                  <span className="min-w-0">
                                    {f.actions.length} {f.actions.length === 1 ? 'paso' : 'pasos'}
                                    {f.host ? ` · ${f.host}` : ''}
                                    {f.lastRunAt
                                      ? ` · ${f.lastResult === 'ok' ? 'salió bien' : 'no terminó'} ${ago(f.lastRunAt)}`
                                      : ' · sin usar'}
                                    {f.runs ? ` · ${f.runs} ${f.runs === 1 ? 'uso' : 'usos'}` : ''}
                                  </span>
                                </span>
                              </span>
                            </button>
                            <button
                              onClick={() => onReplay(f)}
                              disabled={busy}
                              aria-label={`Repetir todo «${f.title}»`}
                              title="Repetir todo el flujo en la página"
                              className="mr-1 mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-onaccent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
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
                                {editing ? (
                                  <div className="space-y-1.5 px-2 pb-2 pl-8 pt-1">
                                    {hintId === f.id && (
                                      <p className="text-[11px] text-mute">Ponle un nombre y escribe para qué sirve: así lo encuentras rápido.</p>
                                    )}
                                    <label className="block text-[11px] font-medium text-mute">
                                      Nombre
                                      <input
                                        autoFocus
                                        onFocus={(e) => e.currentTarget.select()}
                                        value={dTitle}
                                        maxLength={60}
                                        onChange={(e) => setDTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEdit();
                                          if (e.key === 'Escape') setEditId(null);
                                        }}
                                        className={`${field} mt-0.5`}
                                      />
                                    </label>
                                    <label className="block text-[11px] font-medium text-mute">
                                      ¿Para qué sirve?
                                      <input
                                        value={dDesc}
                                        maxLength={140}
                                        placeholder="Ej.: consultar el estado de un contenedor"
                                        onChange={(e) => setDDesc(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEdit();
                                          if (e.key === 'Escape') setEditId(null);
                                        }}
                                        className={`${field} mt-0.5`}
                                      />
                                    </label>
                                    <label className="block text-[11px] font-medium text-mute">
                                      Etiquetas (separadas por coma)
                                      <input
                                        value={dTags}
                                        placeholder="Ej.: aduana, seguimiento"
                                        onChange={(e) => setDTags(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveEdit();
                                          if (e.key === 'Escape') setEditId(null);
                                        }}
                                        className={`${field} mt-0.5`}
                                      />
                                    </label>
                                    <div className="flex gap-1 pt-0.5">
                                      <button
                                        onClick={saveEdit}
                                        disabled={!dTitle.trim()}
                                        className={`${small} bg-accent text-onaccent hover:bg-accent-hover disabled:opacity-50`}
                                      >
                                        Guardar
                                      </button>
                                      <button onClick={() => setEditId(null)} className={`${small} border border-line hover:bg-paper`}>
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {f.lastResult === 'fail' && f.lastNote && (
                                      <p className="mx-2 mb-1 ml-8 rounded-md bg-amber-500/10 px-2 py-1 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400">
                                        Última vez: {f.lastNote}
                                      </p>
                                    )}
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
                                        onClick={() => startEdit(f)}
                                        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-mute hover:bg-bubble hover:text-ink"
                                      >
                                        <Pencil size={12} /> Editar
                                      </button>
                                      <button
                                        onClick={() => setConfirmId(f.id)}
                                        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-mute hover:bg-bubble hover:text-ink"
                                      >
                                        <Trash2 size={12} /> Eliminar
                                      </button>
                                    </div>
                                  </>
                                )}
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
                <span className="flex-1 text-[13px]">¿Eliminar toda la biblioteca?</span>
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
                <Trash2 size={12} /> Eliminar todos los flujos
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
