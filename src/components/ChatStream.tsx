import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { BookmarkPlus, Check, Copy, Bot, Download, FileSpreadsheet, FileText } from 'lucide-react';
import type { AgentMessage, Message, TabInfo, UserMessage } from '../types';
import EmptyState from './EmptyState';
import PlanAccordion from './PlanAccordion';
import ApprovalCard from './ApprovalCard';
import { splitCommand } from '../lib/actions';
import { buildExport, downloadFile, parseMarkdown, plain, type ExportFormat } from '../lib/exportDoc';
import { useClickOutside } from '../hooks/useClickOutside';

const inline = (s: string): ReactNode[] =>
  s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, i) =>
    p.startsWith('**') ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
    : p.startsWith('*') && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
    : <Fragment key={i}>{p}</Fragment>,
  );

const PREVIEW_ROWS = 12;

/** Tabla de la respuesta: se desplaza hacia los lados si es ancha y muestra solo las primeras filas. */
function TableView({ rows }: { rows: string[][] }) {
  const cols = Math.max(...rows.map((r) => r.length));
  const head = rows.length > 1 ? rows[0] : null;
  const body = head ? rows.slice(1) : rows;
  const shown = body.slice(0, PREVIEW_ROWS);
  return (
    <div>
      <div className="thin-scroll overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse font-sans text-[12.5px] leading-snug">
          {head && (
            <thead className="bg-bubble">
              <tr>
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                    {plain(head[i] ?? '')}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {shown.map((r, ri) => (
              <tr key={ri} className="border-t border-line">
                {Array.from({ length: cols }, (_, i) => (
                  <td key={i} className="px-2 py-1.5 align-top">
                    {inline(r[i] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {body.length > shown.length && (
        <p className="mt-1 text-xs text-mute">
          Se muestran {shown.length} de {body.length} filas; la descarga las incluye todas.
        </p>
      )}
    </div>
  );
}

/** Mini-render de markdown: títulos, párrafos, listas con "-", tablas y negritas. */
function Prose({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={`space-y-3 font-serif text-[16px] leading-[1.6] text-ink ${streaming ? 'caret' : ''}`}>
      {blocks.map((b, i) => {
        const t = b.trim();
        if (t.startsWith('|') && t.split('\n').every((l) => l.trim().startsWith('|'))) {
          const tb = parseMarkdown(t).find((x) => x.t === 'table');
          if (tb && tb.t === 'table') return <TableView key={i} rows={tb.rows} />;
        }
        const lines = t.split('\n');
        const h = /^#{1,6}\s+(.*)$/.exec(lines[0]);
        if (h) {
          const rest = lines.slice(1).join('\n').trim();
          return (
            <div key={i} className="space-y-1.5">
              <h3 className="font-serif text-[18px] font-semibold leading-snug">{inline(h[1])}</h3>
              {rest && <p>{inline(rest)}</p>}
            </div>
          );
        }
        return t.startsWith('- ') ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent">
            {b.split('\n').map((l, k) => <li key={k}>{inline(l.replace(/^-\s*/, ''))}</li>)}
          </ul>
        ) : (
          <p key={i}>{inline(b)}</p>
        );
      })}
    </div>
  );
}

const FORMATS: { fmt: ExportFormat; label: string; ext: string; sheet?: boolean }[] = [
  { fmt: 'pdf', label: 'PDF', ext: '.pdf' },
  { fmt: 'docx', label: 'Word', ext: '.docx' },
  { fmt: 'xlsx', label: 'Excel', ext: '.xlsx', sheet: true },
  { fmt: 'csv', label: 'CSV', ext: '.csv', sheet: true },
  { fmt: 'md', label: 'Markdown', ext: '.md' },
];

/** Descarga la respuesta como archivo. El menú se abre hacia arriba o hacia abajo según el espacio que haya. */
function DownloadMenu({ answer, className }: { answer: string; className: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(true);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const toggle = () => {
    if (!open) setUp((ref.current?.getBoundingClientRect().top ?? 400) > 260);
    setOpen((o) => !o);
  };
  const go = (fmt: ExportFormat) => {
    setOpen(false);
    try {
      downloadFile(buildExport(answer, fmt));
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} className={className}>
        <Download size={13} />
        {failed ? 'No se pudo' : 'Descargar'}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute left-0 z-30 w-44 rounded-xl border border-line bg-card p-1 shadow-pop ${up ? 'bottom-8' : 'top-8'}`}
        >
          {FORMATS.map((f) => (
            <button
              key={f.fmt}
              role="menuitem"
              onClick={() => go(f.fmt)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-paper"
            >
              {f.sheet ? <FileSpreadsheet size={15} className="text-mute" /> : <FileText size={15} className="text-mute" />}
              <span className="flex-1">{f.label}</span>
              <span className="text-[11px] text-mute">{f.ext}</span>
            </button>
          ))}
        </div>
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
            <DownloadMenu answer={msg.answer ?? ''} className={action} />
            {!!msg.plan && !msg.replay && !msg.plan.steps.every((s) => s.state === 'skipped') && (
              <button onClick={() => setSaved(true)} disabled={saved} className={action} title="Guardar como atajo">
                {saved ? <Check size={13} className="text-accent-ink" /> : <BookmarkPlus size={13} />}
                {saved ? 'Atajo guardado' : 'Atajo'}
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
