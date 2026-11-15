import { m } from 'framer-motion';
import { Check, ShieldAlert, X } from 'lucide-react';
import type { AgentMessage } from '../types';

export default function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: NonNullable<AgentMessage['approval']>;
  onResolve: (ok: boolean) => void;
}) {
  const pending = approval.state === 'pending';

  return (
    <m.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      role="alertdialog"
      aria-label="Aprobación requerida"
      className={`rounded-xl border bg-card p-3.5 shadow-float transition-colors ${
        pending ? 'approval-pulse border-accent' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
            pending ? 'bg-accent-soft text-accent-ink' : 'bg-bubble text-mute'
          }`}
        >
          <ShieldAlert size={17} />
        </span>
        <div className="min-w-0 text-[13px] leading-snug">
          <p className="font-semibold">Se requiere tu aprobación</p>
          <p className="mt-0.5 text-mute">El agente quiere {approval.action}</p>
        </div>
      </div>

      {pending ? (
        <div className="mt-3.5 flex gap-2">
          <button
            onClick={() => onResolve(true)}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-onaccent hover:bg-accent-hover"
          >
            <Check size={15} /> Aprobar
          </button>
          <button
            onClick={() => onResolve(false)}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[13px] font-medium text-ink hover:bg-bubble"
          >
            <X size={15} /> Rechazar
          </button>
        </div>
      ) : (
        <m.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${
            approval.state === 'approved' ? 'text-accent-ink' : 'text-mute'
          }`}
        >
          {approval.state === 'approved' ? <Check size={13} /> : <X size={13} />}
          {approval.state === 'approved' ? 'Aprobado' : 'Rechazado'}
        </m.p>
      )}
    </m.div>
  );
}
