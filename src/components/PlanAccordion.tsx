import { AnimatePresence, m } from 'framer-motion';
import { Check, ChevronRight, Loader2, Minus } from 'lucide-react';
import type { AgentMessage } from '../types';

export default function PlanAccordion({
  plan,
  stopped,
  onToggle,
}: {
  plan: NonNullable<AgentMessage['plan']>;
  stopped?: boolean;
  onToggle: () => void;
}) {
  const total = plan.steps.length;
  const doneCount = plan.steps.filter((s) => s.state === 'done').length;
  const running = plan.steps.some((s) => s.state === 'running');
  const working = !plan.done && !stopped;
  // El avance de la barra comunica el progreso real del plan
  const progress = plan.done ? 1 : (doneCount + (running ? 0.5 : 0)) / total;

  const title = plan.done
    ? `Plan ejecutado: ${doneCount} de ${total} pasos`
    : stopped
      ? 'Plan detenido'
      : `Planificando ${total} pasos...`;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="flex">
        <div className="relative w-1 shrink-0 bg-line">
          <m.div
            className="absolute inset-x-0 top-0 h-full origin-top bg-accent"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: progress }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={onToggle}
            aria-expanded={plan.open}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-mute hover:text-ink"
          >
            <ChevronRight size={14} className={`shrink-0 transition-transform duration-200 ${plan.open ? 'rotate-90' : ''}`} />
            <span className={`truncate ${working ? 'shimmer' : ''}`}>{title}</span>
            {working && <Loader2 size={13} className="ml-auto shrink-0 animate-spin text-accent" />}
          </button>

          <AnimatePresence initial={false}>
            {plan.open && (
              <m.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-2.5 overflow-hidden px-3 pb-3"
              >
                {plan.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                      {s.state === 'done' && (
                        <m.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                          <Check size={14} className="text-accent" />
                        </m.span>
                      )}
                      {s.state === 'running' && <Loader2 size={13} className="animate-spin text-accent" />}
                      {s.state === 'skipped' && <Minus size={14} className="text-mute" />}
                      {s.state === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-mute/40" />}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${s.state === 'pending' ? 'text-mute' : 'text-ink'}`}>{s.label}</span>
                      <code className="mt-1 block break-all rounded-md bg-paper px-1.5 py-0.5 font-mono text-[11px] text-mute">
                        {s.code}
                      </code>
                    </span>
                  </li>
                ))}
              </m.ul>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
