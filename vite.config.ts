import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// `public/` (manifest.json + background.js) se copia tal cual a dist/.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: { input: { sidepanel: resolve(__dirname, 'sidepanel.html') } },
  },
});
