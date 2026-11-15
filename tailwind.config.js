/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// Escala de radios (regla única): controles 8px, paneles 12px, caja/burbujas 16px, pills full.
export default {
  content: ['./sidepanel.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: v('paper'),
        card: v('card'),
        line: v('line'),
        bubble: v('bubble'),
        ink: v('ink'),
        mute: v('mute'),
        onaccent: '#FFFFFF', // texto sobre azul marino: 11:1 en claro, 5.2:1 en oscuro
        accent: {
          DEFAULT: v('accent'),
          hover: v('accent-hover'),
          soft: v('accent-soft'),
          ink: v('accent-ink'), // azul legible como texto/icono en claro y oscuro
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"Newsreader Variable"', 'Newsreader', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono Variable"', 'JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      boxShadow: {
        float: '0 6px 24px -6px rgba(20,35,70,0.16), 0 1px 3px rgba(20,35,70,0.08)',
        pop: '0 14px 34px -8px rgba(15,28,58,0.26), 0 2px 6px rgba(15,28,58,0.10)',
      },
    },
  },
  plugins: [],
};
