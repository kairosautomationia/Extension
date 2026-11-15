import { m, useMotionTemplate, useMotionValue } from 'framer-motion';
import { Bot, Globe } from 'lucide-react';
import type { TabInfo } from '../types';
import { SUGGESTIONS } from '../lib/mockData';

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
};

/** Botón en forma de píldora con foco de luz que sigue al cursor, elevación al pasar y "pulsación" al hacer clic. */
function Pill({ label, onClick, delay }: { label: string; onClick: () => void; delay: number }) {
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const glow = useMotionTemplate`radial-gradient(110px circle at ${x}px ${y}px, rgb(var(--accent) / 0.2), transparent 70%)`;

  return (
    <m.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 26 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      }}
      onClick={onClick}
      className="group relative w-fit max-w-full overflow-hidden rounded-full border border-line bg-card px-4 py-2.5 text-left text-[13.5px] font-medium shadow-sm transition-colors hover:border-accent/60"
    >
      <m.span
        aria-hidden
        style={{ background: glow }}
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      <span className="relative">{label}</span>
    </m.button>
  );
}

export default function EmptyState({ tab, onPick }: { tab: TabInfo; onPick: (t: string) => void }) {
  return (
    <div className="relative flex min-h-full flex-col px-5 pb-6 pt-8">
      <div aria-hidden className="ambient pointer-events-none absolute inset-0" />

      {/* Centro: icono, nombre y saludo */}
      <m.div
        className="relative flex flex-1 flex-col items-center justify-center py-6 text-center"
        initial="hide"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
      >
        <m.div variants={{ hide: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }} className="relative">
          <m.span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-accent/30 blur-xl"
            animate={{ opacity: [0.35, 0.7, 0.35], scale: [1, 1.15, 1] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <m.span
            className="relative grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white shadow-float"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Bot size={30} strokeWidth={1.75} />
          </m.span>
        </m.div>

        <m.span variants={{ hide: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }} className="mt-3 text-base font-semibold tracking-tight">
          Hanzo
        </m.span>

        <m.p variants={{ hide: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="mt-6 text-[13px] text-mute">
          {greeting()}
        </m.p>
        <m.h1
          variants={{ hide: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
          className="mt-1 font-serif text-[30px] leading-[1.1] tracking-tight"
        >
          ¿Por dónde empezamos?
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

      {/* Abajo: preguntas de arranque */}
      <div className="relative flex flex-col items-start gap-2">
        {SUGGESTIONS.map((s, i) => (
          <Pill key={s} label={s} delay={0.35 + i * 0.07} onClick={() => onPick(s)} />
        ))}
      </div>
    </div>
  );
}
