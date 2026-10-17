// This lab node's own dashboard, on CCL_DASHBOARD_PORT: the platform connection, each job going
// through the pipeline with timings, and tool output, live. The page is at /, its data at /state
// (a snapshot) and /events (server-sent events). Off unless the port is set.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTrace, recentTrace } from './trace.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'index.html');

export function startDashboard(port: number, state: () => unknown) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      fs.createReadStream(PAGE).pipe(res);
      return;
    }
    if (url.pathname === '/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state()));
      return;
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('snapshot', { events: recentTrace(), state: state() });
      const off = onTrace((e) => send('node', e));
      const tick = setInterval(() => send('state', state()), 2000);
      req.on('close', () => {
        off();
        clearInterval(tick);
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => console.log(`[node] dashboard on http://localhost:${port}`));
}
