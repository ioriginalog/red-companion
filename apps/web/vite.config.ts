import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the relay runs on :8080; Vite proxies the API and WebSocket to it.
export default defineConfig({
  plugins: [react()],
  // Versions the service worker (pwa.ts registers /sw.js?v=<build id>).
  define: { __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14)) },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
});
