import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { attempts } from './attempts.js';
import { optionalAuth } from './auth.js';
import { db, one } from './db.js';
import { traceHttp } from './flow.js';
import { flow } from './flow-routes.js';
import { attachHub, failOrphanedAttempts } from './hub.js';
import { WEB_DIST } from './paths.js';
import { clients, nodeSockets } from './presence.js';
import { api } from './routes.js';
import { HttpError } from './util.js';

const PORT = Number(process.env.PORT ?? 4000);

if (!one('SELECT 1 FROM users LIMIT 1')) {
  console.warn('[server] database is empty. Run `npm run seed` first.');
}

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy every request arrives from the proxy's address, so all users would share
// one sign-in, booking and attempt limit. CCL_TRUST_PROXY names the proxy (a hop count, or
// addresses such as "loopback, uniquelocal") so req.ip comes from X-Forwarded-For. Leave it unset
// when browsers connect directly, or anyone could pick their own address with a header.
const trustProxy = process.env.CCL_TRUST_PROXY;
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
app.use(express.json({ limit: '256kb' }));
app.use(optionalAuth);
app.use(traceHttp);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// The flow dashboard (/flow) and its data, when CCL_FLOW_DASHBOARD=1
app.use(flow);
app.use('/api', api);
app.use('/api', attempts);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No such endpoint')));

// In production the server also hosts the built web app.
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something broke on the server' });
});

const server = http.createServer(app);
attachHub(server);
failOrphanedAttempts();

server.listen(PORT, () => {
  console.log(`[server] CampusConnect Labs API on http://localhost:${PORT}`);
  console.log(`[server] lab nodes connect to ws://localhost:${PORT}/ws/node`);
});

// `docker stop` sends SIGTERM. Close the sockets so agents and tabs reconnect cleanly, let open
// requests finish, then close the database so its WAL is checkpointed.
function shutdown(signal: string) {
  console.log(`[server] ${signal}, shutting down`);
  for (const ws of [...nodeSockets.values(), ...clients.keys()]) ws.close(1001, 'server restarting');
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
