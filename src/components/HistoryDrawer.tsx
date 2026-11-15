import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { MessageSquare, Trash2, X } from 'lucide-react';
import { clearChats, deleteChat, loadChats, whenLabel, type StoredChat } from '../lib/history';

interface Props {
  open: boolean;
  onClose: () => void;
  currentId: string;
  onOpenChat: (chat: StoredChat) => void;
  onDeleted: (id: string) => void;
  onClearedAll: () => void;
}

export default function HistoryDrawer({ open, onClose, currentId, onOpenChat, onDeleted, onClearedAll }: Props) {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  // Al abrir el panel se relee lo guardado (incluye la conversación actual si ya terminó un turno).
  useEffect(() => {
    if (!open) return;
    setChats(loadChats());
    setConfirmId(null);
    setConfirmAll(false);
  }, [open]);

  const remove = (id: string) => {
    deleteChat(id);
    setChats(loadChats());
    setConfirmId(null);
    onDeleted(id);
  };

  const removeAll = () => {
    clearChats();
    setChats([]);
    setConfirmAll(false);
    onClearedAll();
  };

  const btn = 'h-7 rounded-md px-2 text-xs font-medium';

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
              {chats.length === 0 && (
                <li className="px-3 py-6 text-center text-[13px] text-mute">Aún no hay conversaciones guardadas.</li>
              )}
              {chats.map((c) => (
                <li key={c.id}>
                  {confirmId === c.id ? (
                    <div className="flex items-center gap-2 rounded-lg bg-bubble px-2.5 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px]">¿Eliminar «{c.title}»?</span>
                      <button onClick={() => remove(c.id)} className={`${btn} bg-accent text-onaccent hover:bg-accent-hover`}>
                        Sí
                      </button>
                      <button onClick={() => setConfirmId(null)} className={`${btn} border border-line hover:bg-paper`}>
                        No
                      </button>
                    </div>
                  ) : (
                    <div
                      className={`group flex items-center rounded-lg transition-colors hover:bg-bubble ${
                        c.id === currentId ? 'bg-bubble' : ''
                      }`}
                    >
                      <button
                        onClick={() => {
                          onOpenChat(c);
                          onClose();
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                      >
                        <MessageSquare size={15} className="shrink-0 text-mute" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px]">{c.title}</span>
                          <span className="block text-[11px] text-mute">{whenLabel(c.updatedAt)}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setConfirmId(c.id)}
                        aria-label={`Eliminar conversación ${c.title}`}
                        className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-mute hover:bg-paper hover:text-ink"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {chats.length > 0 && (
              <div className="border-t border-line p-2">
                {confirmAll ? (
                  <div className="flex items-center gap-2 px-1">
                    <span className="flex-1 text-[13px]">¿Eliminar todas?</span>
                    <button onClick={removeAll} className={`${btn} bg-accent text-onaccent hover:bg-accent-hover`}>
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
