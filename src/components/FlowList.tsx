import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Camera, ChevronRight, Keyboard, ListChecks, MousePointerClick, MoveVertical, Navigation, Play, Send, Trash2, type LucideIcon } from 'lucide-react';
import type { RecordedAction, SavedFlow } from '../types';
import { describeAction } from '../lib/flows';

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

export default function FlowList({
  flows,
  busy,
  onReplay,
  onDelete,
}: {
  flows: SavedFlow[];
  busy: boolean;
  onReplay: (flow: SavedFlow, actionId?: string) => void;
  onDelete: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (flows.length === 0) {
    return (
      <p className="px-3 py-4 text-[13px] leading-snug text-mute">
        Aún no hay acciones grabadas. Pulsa <span className="font-medium text-ink">Grabar</span> en la barra del chat y
        usa la página: tus clics, escritura y desplazamientos quedarán guardados aquí. Al tocarlos, se repiten en la página.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {flows.map((f) => {
        const open = openId === f.id;
        return (
          <li key={f.id} className="rounded-lg">
            <div className="flex items-center gap-0.5 rounded-lg hover:bg-paper">
              <button
                onClick={() => setOpenId(open ? null : f.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-2 text-left"
              >
                <ChevronRight size={14} className={`shrink-0 text-mute transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{f.title}</span>
                  <span className="block text-[11px] text-mute">
                    {f.actions.length} {f.actions.length === 1 ? 'acción' : 'acciones'},{' '}
                    {new Date(f.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
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
                  <p className="px-2 pl-8 text-[11px] text-mute">Toca una acción para repetir solo esa.</p>
                  <ol className="space-y-0.5 px-1 pb-2 pl-6 pt-1">
                    {f.actions.map((a) => {
                      const Icon = ICONS[a.type];
                      return (
                        <li key={a.id}>
                          <button
                            onClick={() => onReplay(f, a.id)}
                            disabled={busy}
                            title="Repetir esta acción en la página"
                            className="group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Icon size={13} className="mt-0.5 shrink-0 text-accent-ink" />
                            <span className="min-w-0 flex-1 break-words">{describeAction(a)}</span>
                            <Play size={11} className="mt-0.5 shrink-0 text-accent-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex gap-1.5 px-2 pb-2 pl-8">
                    <button
                      onClick={() => onDelete(f.id)}
                      className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-mute hover:bg-bubble hover:text-ink"
                    >
                      <Trash2 size={12} /> Eliminar
                    </button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
