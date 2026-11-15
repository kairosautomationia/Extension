import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { ChevronRight, Keyboard, ListChecks, MousePointerClick, Navigation, Play, Send, Trash2, type LucideIcon } from 'lucide-react';
import type { RecordedAction, SavedFlow } from '../types';
import { describeAction, flowToPrompt } from '../lib/flows';

const ICONS: Record<RecordedAction['type'], LucideIcon> = {
  click: MousePointerClick,
  input: Keyboard,
  select: ListChecks,
  submit: Send,
  navigate: Navigation,
};

export default function FlowList({
  flows,
  onRun,
  onDelete,
}: {
  flows: SavedFlow[];
  onRun: (prompt: string) => void;
  onDelete: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (flows.length === 0) {
    return (
      <p className="px-3 py-4 text-[13px] leading-snug text-mute">
        Aún no hay acciones grabadas. Pulsa <span className="font-medium text-ink">Grabar</span> en la barra del chat y
        usa la página: tus clics y escritura quedarán guardados aquí.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {flows.map((f) => {
        const open = openId === f.id;
        return (
          <li key={f.id} className="rounded-lg">
            <button
              onClick={() => setOpenId(open ? null : f.id)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-paper"
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

            <AnimatePresence initial={false}>
              {open && (
                <m.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <ol className="space-y-1.5 px-2 pb-2 pl-8">
                    {f.actions.map((a) => {
                      const Icon = ICONS[a.type];
                      return (
                        <li key={a.id} className="flex items-start gap-2 text-xs">
                          <Icon size={13} className="mt-0.5 shrink-0 text-accent-ink" />
                          <span className="min-w-0 break-words">{describeAction(a)}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex gap-1.5 px-2 pb-2 pl-8">
                    <button
                      onClick={() => onRun(flowToPrompt(f))}
                      className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-onaccent hover:bg-accent-hover"
                    >
                      <Play size={12} /> Repetir
                    </button>
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
