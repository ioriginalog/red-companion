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
  build: {
    outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        // React and the rules engine change less often than the UI: their own long-cached chunks.
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor';
          if (/[\\/]packages[\\/](rules-core|session)[\\/]/.test(id)) return 'rules';
          return undefined;
        },
      },
    },
  },
});
