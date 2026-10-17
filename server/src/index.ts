import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { attempts } from './attempts.js';
import { optionalAuth } from './auth.js';
import { one } from './db.js';
import { attachHub, failOrphanedAttempts } from './hub.js';
import { WEB_DIST } from './paths.js';
import { api } from './routes.js';
import { HttpError } from './util.js';

const PORT = Number(process.env.PORT ?? 4000);

if (!one('SELECT 1 FROM users LIMIT 1')) {
  console.warn('[server] database is empty. Run `npm run seed` first.');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(optionalAuth);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
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
