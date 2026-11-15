import { m, useMotionTemplate, useMotionValue } from 'framer-motion';
import { FileText, Globe, Bot, Table2, TextCursorInput, type LucideIcon } from 'lucide-react';
import type { TabInfo } from '../types';
import { SUGGESTIONS } from '../lib/mockData';

const ICONS: LucideIcon[] = [FileText, Table2, TextCursorInput];

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
};

/** Tarjeta con foco de luz que sigue al cursor. Usa motion values: cero re-renders de React. */
function SpotlightChip({ label, Icon, onClick, delay }: { label: string; Icon: LucideIcon; onClick: () => void; delay: number }) {
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const glow = useMotionTemplate`radial-gradient(140px circle at ${x}px ${y}px, rgb(var(--accent) / 0.16), transparent 70%)`;

  return (
    <m.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 26 }}
      whileHover={{ y: -2 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      onClick={onClick}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-card px-3.5 py-3 text-left text-[13.5px] shadow-sm hover:border-accent/60"
    >
      <m.span
        aria-hidden
        style={{ background: glow }}
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        <Icon size={16} />
      </span>
      <span className="relative flex-1 font-medium">{label}</span>
    </m.button>
  );
}

export default function EmptyState({ tab, onPick }: { tab: TabInfo; onPick: (t: string) => void }) {
  return (
    <div className="relative flex min-h-full flex-col justify-center px-5 py-8">
      <div aria-hidden className="ambient pointer-events-none absolute inset-0" />

      <m.div
        className="relative"
        initial="hide"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
      >
        <m.div
          variants={{ hide: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
          className="mb-5 flex items-center gap-3"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-white shadow-float">
            <Bot size={24} strokeWidth={1.75} />
          </span>
          <span className="text-lg font-semibold tracking-tight">Hanzo</span>
        </m.div>

        <m.p variants={{ hide: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="text-[13px] text-mute">
          {greeting()}
        </m.p>
        <m.h1
          variants={{ hide: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
          className="mt-1 font-serif text-[30px] leading-[1.1] tracking-tight"
        >
          ¿Qué hacemos con esta página?
        </m.h1>

        <m.div
          variants={{ hide: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
          className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs"
        >
          {tab.favIconUrl ? (
            <img src={tab.favIconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
          ) : (
            <Globe size={14} className="shrink-0 text-mute" />
          )}
          <span className="shrink-0 text-mute">Conectado a</span>
          <span className="truncate font-medium">{tab.title}</span>
        </m.div>
      </m.div>

      <div className="relative mt-7 space-y-2.5">
        {SUGGESTIONS.map((s, i) => (
          <SpotlightChip key={s} label={s} Icon={ICONS[i % ICONS.length]} delay={0.3 + i * 0.07} onClick={() => onPick(s)} />
        ))}
      </div>
    </div>
  );
}
