import { AnimatePresence, m } from 'framer-motion';
import { MessageSquare, X } from 'lucide-react';
import { HISTORY } from '../lib/mockData';

export default function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
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
            className="absolute inset-y-0 left-0 z-50 flex w-[80%] max-w-[300px] flex-col border-r border-line bg-paper shadow-pop"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            aria-label="Historial"
          >
            <div className="flex h-12 items-center justify-between border-b border-line px-4">
              <h2 className="text-sm font-semibold">Conversaciones</h2>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-bubble hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <ul className="thin-scroll flex-1 overflow-y-auto p-2">
              {HISTORY.length === 0 && (
                <li className="px-3 py-6 text-center text-[13px] text-mute">Aún no hay conversaciones guardadas.</li>
              )}
              {HISTORY.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={onClose}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bubble"
                  >
                    <MessageSquare size={15} className="shrink-0 text-mute" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{c.title}</span>
                      <span className="block text-[11px] text-mute">{c.when}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
