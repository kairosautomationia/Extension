import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { BookmarkPlus, Check, Copy, Bot, FileText } from 'lucide-react';
import type { AgentMessage, Message, TabInfo, UserMessage } from '../types';
import EmptyState from './EmptyState';
import PlanAccordion from './PlanAccordion';
import ApprovalCard from './ApprovalCard';
import { splitCommand } from '../lib/actions';

const inline = (s: string): ReactNode[] =>
  s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, i) =>
    p.startsWith('**') ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
    : p.startsWith('*') && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
    : <Fragment key={i}>{p}</Fragment>,
  );

/** Mini-render de markdown: párrafos, listas con "-" y negritas. */
function Prose({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={`space-y-3 font-serif text-[16px] leading-[1.6] text-ink ${streaming ? 'caret' : ''}`}>
      {blocks.map((b, i) =>
        b.trim().startsWith('- ') ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent">
            {b.split('\n').map((l, k) => <li key={k}>{inline(l.replace(/^-\s*/, ''))}</li>)}
          </ul>
        ) : (
          <p key={i}>{inline(b)}</p>
        ),
      )}
    </div>
  );
}

const UserBubble = memo(function UserBubble({ m }: { m: UserMessage }) {
  const cmd = splitCommand(m.text);
  return (
    <div className="flex flex-col items-end gap-1.5">
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {m.attachments.map((a) =>
            a.url ? (
              <img key={a.id} src={a.url} alt={a.name} className="h-16 w-24 rounded-lg border border-line object-cover" />
            ) : (
              <span key={a.id} className="flex items-center gap-1 rounded-lg bg-bubble px-2 py-1 text-xs text-mute">
                <FileText size={12} /> {a.name}
              </span>
            ),
          )}
        </div>
      )}
      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-[16px] bg-bubble px-3.5 py-2.5 text-sm leading-relaxed">
        {cmd ? (
          <>
            {cmd.head}
            <span className="rounded bg-blue-500/15 px-1 font-medium text-blue-600 dark:text-blue-400">{cmd.cmd}</span>
            {cmd.rest}
          </>
        ) : (
          m.text
        )}
      </div>
    </div>
  );
});

const AgentBlock = memo(function AgentBlock({
  m: msg,
  onToggle,
  onResolve,
}: {
  m: AgentMessage;
  onToggle: (id: string) => void;
  onResolve: (ok: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const thinking = msg.streaming && !msg.answer;
  const finished = !!msg.answer && !msg.streaming;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.answer ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* portapapeles no disponible */
    }
  };

  const action =
    'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-mute hover:bg-bubble hover:text-ink';

  return (
    <div className="flex gap-2.5">
      <div
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-white ${
          thinking ? 'breathe' : ''
        }`}
      >
        <Bot size={14} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {msg.plan && <PlanAccordion plan={msg.plan} stopped={msg.stopped} onToggle={() => onToggle(msg.id)} />}
        {thinking && !msg.plan && !msg.approval && <p className="text-[13px] text-mute">Pensando…</p>}
        {msg.approval && <ApprovalCard approval={msg.approval} onResolve={onResolve} />}
        {msg.answer && <Prose text={msg.answer} streaming={msg.streaming} />}
        {msg.stopped && <p className="text-xs italic text-mute">Detenido por el usuario.</p>}
        {finished && (
          <div className="-ml-2 flex gap-1">
            <button onClick={copy} className={action}>
              {copied ? <Check size={13} className="text-accent-ink" /> : <Copy size={13} />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            {!!msg.plan && !msg.replay && !msg.plan.steps.every((s) => s.state === 'skipped') && (
              <button onClick={() => setSaved(true)} disabled={saved} className={action}>
                {saved ? <Check size={13} className="text-accent-ink" /> : <BookmarkPlus size={13} />}
                {saved ? 'Atajo guardado' : 'Guardar como atajo'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface Props {
  messages: Message[];
  tab: TabInfo;
  onPick: (t: string) => void;
  onTogglePlan: (id: string) => void;
  onResolve: (ok: boolean) => void;
}

export default function ChatStream({ messages, tab, onPick, onTogglePlan, onResolve }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages]);

  if (messages.length === 0) return <EmptyState tab={tab} onPick={onPick} />;

  return (
    <div className="space-y-5 px-4 py-4">
      {messages.map((msg) => (
        <m.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          {msg.role === 'user' ? (
            <UserBubble m={msg} />
          ) : (
            <AgentBlock m={msg} onToggle={onTogglePlan} onResolve={onResolve} />
          )}
        </m.div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
