import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// SprintBrain dashboard — Vite 5 config.
// `public/` contains static legacy folders (landing/, mobile/) that are copied
// into dist/ verbatim, preserving the URLs /landing/ and /mobile/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
