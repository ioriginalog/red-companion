import { fileURLToPath } from 'node:url';
import { createRelay } from './relay.js';
import { FileStore, MemoryStore } from './store.js';

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR;
const origins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
const maxLog = Number(process.env.MAX_LOG_ENTRIES ?? 20_000);

const store = dataDir ? new FileStore(dataDir) : new MemoryStore();
if (!dataDir) console.warn('DATA_DIR not set: sessions are kept in memory and lost on restart.');

const { server, close } = createRelay({
  store,
  // Unset = same-origin only. '*' must be explicit.
  allowedOrigins: !origins || origins.length === 0 ? 'same-origin' : origins.length === 1 && origins[0] === '*' ? '*' : origins,
  trustProxyHops: Number.isInteger(hops) && hops > 0 ? hops : 0,
  maxLogEntries: Number.isInteger(maxLog) && maxLog >= 1000 ? maxLog : 20_000,
  webDir: process.env.WEB_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
  log: (m) => console.log(m),
});

// Dual-stack ('::') so Railway's private network (IPv6) and public proxy both work;
// fall back to IPv4-only hosts.
server.once('listening', () => {
  const a = server.address();
  console.log(`relay listening on ${typeof a === 'object' && a ? `${a.address}:${a.port}` : a} (store: ${dataDir ? `file ${dataDir}` : 'memory'})`);
});
const listen = (host: string) => server.listen(port, host);
server.once('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EAFNOSUPPORT' && !process.env.HOST) listen('0.0.0.0');
  else {
    // Fail fast (e.g. EADDRINUSE): the global handler below would otherwise keep a zombie alive.
    console.error(`relay failed to listen: ${e.message}`);
    process.exit(1);
  }
});
listen(process.env.HOST ?? '::');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    // Keep-alive HTTP connections would hold server.close() open indefinitely.
    server.closeIdleConnections?.();
    setTimeout(() => { server.closeAllConnections?.(); process.exit(0); }, 5000).unref();
    void close().then(() => process.exit(0));
  });
}

// Last line of defense: log and keep serving rather than dropping every table.
process.on('uncaughtException', (err) => { console.error('uncaught', err); });
process.on('unhandledRejection', (err) => { console.error('unhandled rejection', err); });
