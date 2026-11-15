import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, existsSync } from 'fs';

// Cloudflare sirve index.html en "/". La extensión usa sidepanel.html,
// así que tras el build se copia como index.html (no afecta a la extensión).
const indexFromSidepanel = (): Plugin => ({
  name: 'index-from-sidepanel',
  apply: 'build',
  closeBundle() {
    const from = resolve(__dirname, 'dist/sidepanel.html');
    if (existsSync(from)) copyFileSync(from, resolve(__dirname, 'dist/index.html'));
  },
});

// `public/` (manifest.json + background.js) se copia tal cual a dist/.
export default defineConfig({
  base: './',
  plugins: [react(), indexFromSidepanel()],
  build: {
    outDir: 'dist',
    rollupOptions: { input: { sidepanel: resolve(__dirname, 'sidepanel.html') } },
  },
});
