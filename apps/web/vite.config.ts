import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the relay runs on :8080; Vite proxies the API and WebSocket to it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/health': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
});
