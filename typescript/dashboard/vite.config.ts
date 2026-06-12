import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxyTarget = process.env.DASHBOARD_PROXY_TARGET ?? 'http://127.0.0.1:4317';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/dashboard'),
    emptyOutDir: true,
  },
});
