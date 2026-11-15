import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Bookmark, Check, ChevronDown, Eye, Menu, Plus, ShieldCheck, Zap } from 'lucide-react';
import type { PermissionMode, SavedFlow } from '../types';
import FlowList from './FlowList';
import { useClickOutside } from '../hooks/useClickOutside';

const MODES: { id: PermissionMode; label: string; desc: string; Icon: typeof Eye }[] = [
  { id: 'manual', label: 'Manual', desc: 'Pide confirmación antes de cada acción', Icon: ShieldCheck },
  { id: 'auto', label: 'Auto', desc: 'Ejecuta automáticamente las acciones seguras', Icon: Zap },
  { id: 'readonly', label: 'Solo Lectura', desc: 'No interactúa con el DOM', Icon: Eye },
];

const pop = {
  initial: { opacity: 0, y: -4, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.97 },
  transition: { duration: 0.12 },
};

interface Props {
  mode: PermissionMode;
  onModeChange: (m: PermissionMode) => void;
  onOpenHistory: () => void;
  onNewChat: () => void;
  onReplay: (flow: SavedFlow, actionId?: string) => void;
  busy: boolean;
  flows: SavedFlow[];
  savedKey: number;
  onDeleteFlow: (id: string) => void;
  onRenameFlow: (id: string, title: string) => void;
  onClearFlows: () => void;
}

const iconBtn =
  'grid h-8 w-8 place-items-center rounded-lg text-mute transition-colors hover:bg-bubble hover:text-ink';

export default function Header({ mode, onModeChange, onOpenHistory, onNewChat, onReplay, busy, flows, savedKey, onDeleteFlow, onRenameFlow, onClearFlows }: Props) {
  const [modeOpen, setModeOpen] = useState(false);
  const [shortOpen, setShortOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);
  const shortRef = useRef<HTMLDivElement>(null);
  useClickOutside(modeRef, () => setModeOpen(false), modeOpen);
  useClickOutside(shortRef, () => setShortOpen(false), shortOpen);

  // Al terminar una grabación, la etiqueta se abre sola para mostrar dónde quedó guardada
  useEffect(() => {
    if (savedKey > 0) setShortOpen(true);
  }, [savedKey]);

  const current = MODES.find((m) => m.id === mode)!;

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1 border-b border-line bg-paper/90 px-2 backdrop-blur">
      <button className={iconBtn} onClick={onOpenHistory} aria-label="Historial de conversaciones">
        <Menu size={18} />
      </button>
      <button
        onClick={onNewChat}
        className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink transition-colors hover:bg-bubble"
      >
        <Plus size={16} /> Nuevo Chat
      </button>

      <div className="ml-auto flex items-center gap-1">
        {/* Selector de modo de permisos */}
        <div ref={modeRef} className="relative">
          <button
            onClick={() => setModeOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={modeOpen}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${
              mode === 'auto'
                ? 'border-accent/40 bg-accent-soft text-accent-ink'
                : 'border-line bg-card text-ink hover:bg-bubble'
            }`}
          >
            <m.span
              key={mode}
              initial={{ scale: 0.5, rotate: -40, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              className="grid place-items-center"
            >
              <current.Icon size={14} />
            </m.span>
            {current.label}
            <ChevronDown size={12} className={`transition-transform ${modeOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {modeOpen && (
              <m.div
                {...pop}
                role="menu"
                className="absolute right-0 top-10 z-40 w-64 rounded-xl border border-line bg-card p-1 shadow-pop"
              >
                {MODES.map(({ id, label, desc, Icon }) => (
                  <button
                    key={id}
                    role="menuitemradio"
                    aria-checked={mode === id}
                    onClick={() => {
                      onModeChange(id);
                      setModeOpen(false);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-paper"
                  >
                    <Icon size={16} className="mt-0.5 text-accent" />
                    <span className="flex-1">
                      <span className="block text-[13px] font-medium">{label}</span>
                      <span className="block text-xs text-mute">{desc}</span>
                    </span>
                    {mode === id && <Check size={14} className="mt-0.5 text-accent" />}
                  </button>
                ))}
              </m.div>
            )}
          </AnimatePresence>
        </div>

        {/* Atajos / tareas guardadas */}
        <div ref={shortRef} className="relative">
          <button
            className={`${iconBtn} relative`}
            onClick={() => setShortOpen((o) => !o)}
            aria-label={`Acciones grabadas (${flows.length})`}
          >
            <Bookmark size={17} />
            {flows.length > 0 && (
              <m.span
                key={flows.length}
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-onaccent"
              >
                {flows.length}
              </m.span>
            )}
          </button>
          <AnimatePresence>
            {shortOpen && (
              <m.div
                {...pop}
                className="thin-scroll absolute right-0 top-10 z-40 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-pop"
              >
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-mute">Acciones grabadas</p>
                <FlowList
                  flows={flows}
                  busy={busy}
                  onReplay={(f, actionId) => {
                    setShortOpen(false);
                    onReplay(f, actionId);
                  }}
                  onDelete={onDeleteFlow}
                  onRename={onRenameFlow}
                  onClearAll={onClearFlows}
                />
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
