/**
 * Custom server: one process serves the Next.js console, the REST API and webhooks
 * (route handlers), the Socket.IO channel for agents, and the Postgres queue worker.
 *   dev:  tsx server.ts --dev
 *   prod: node dist/server.js   (bundled by `npm run build`)
 */
import { loadEnvConfig } from '@next/env';
import { createServer } from 'http';
import next from 'next';
import { parse } from 'url';
import { ensureAdmin } from './src/server/bootstrap';
import { env } from './src/server/env';
import { importEnvCredentials } from './src/server/line/channels';
import { stopMaintenance } from './src/server/maintenance';
import { attachSocket } from './src/server/socket';
import { stopPolling } from './src/server/queue';
import { startWorker } from './src/server/worker';

const dev = process.argv.includes('--dev');
loadEnvConfig(process.cwd(), dev);

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => handle(req, res, parse(req.url ?? '/', true)));
  attachSocket(server);
  // Everything that isn't Socket.IO (e.g. Next's HMR socket in dev) goes to Next.
  const upgrade = app.getUpgradeHandler();
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/socket.io')) void upgrade(req, socket, head);
  });

  await ensureAdmin();
  await importEnvCredentials();
  if (env.queueWorker) startWorker();

  server.listen(port, () => console.log(`> Ready on http://localhost:${port} (${dev ? 'dev' : 'production'})`));

  const shutdown = () => {
    stopPolling();
    stopMaintenance();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
