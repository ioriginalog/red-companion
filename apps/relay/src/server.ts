import { createRelay } from './relay.js';
import { FileStore, MemoryStore } from './store.js';

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DATA_DIR;
const origins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);

const store = dataDir ? new FileStore(dataDir) : new MemoryStore();
if (!dataDir) console.warn('DATA_DIR not set: sessions are kept in memory and lost on restart.');

const { server, close } = createRelay({
  store,
  allowedOrigins: origins && origins.length ? origins : '*',
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
  else throw e;
});
listen(process.env.HOST ?? '::');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    void close().then(() => process.exit(0));
  });
}
