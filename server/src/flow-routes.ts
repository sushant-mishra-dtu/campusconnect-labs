// The flow dashboard: a live picture of data moving through the platform. The page is at /flow,
// its data at /api/flow/state (a snapshot) and /api/flow/stream (server-sent events).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { all, one, type AttemptRow, type NodeRow } from './db.js';
import { FLOW_ENABLED, onTrace, recentTrace } from './flow.js';
import { clients, isOnline, nodeAddresses } from './presence.js';
import { fingerprint } from './util.js';
import { college, userBrief } from './views.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'flow', 'index.html');
const started = Date.now();

export const flow = Router();

flow.use((_req, _res, next) => (FLOW_ENABLED ? next() : next('router')));

flow.get('/flow', (_req, res) => res.sendFile(PAGE));

flow.get('/api/flow/state', (_req, res) => res.json(flowState()));

flow.get('/api/flow/stream', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('snapshot', { events: recentTrace(), state: flowState() });
  const off = onTrace((e) => send('flow', e));
  const tick = setInterval(() => send('state', flowState()), 2000);
  req.on('close', () => {
    off();
    clearInterval(tick);
  });
});

const count = (sql: string) => one<{ n: number }>(sql)!.n;

const ipv4 = (s: string) => {
  const p = s.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) : null;
};
const inDocker = fs.existsSync('/.dockerenv');

// Whether a node dials in from this machine: one of our own addresses, or, inside Docker, the
// container network (a node in the same compose project). Address prefixes can't tell: Docker
// hands out 172.x and 192.168.x networks alike.
function onThisMachine(addr: string | null) {
  if (!addr) return null;
  if (addr === '127.0.0.1' || addr === '::1') return true;
  const ip = ipv4(addr);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.address === addr) return true;
      const a = ipv4(i.address), m = ipv4(i.netmask);
      if (inDocker && ip !== null && a !== null && m !== null && !i.internal && (a & m) === (ip & m)) return true;
    }
  }
  return false;
}

function flowState() {
  const people = new Set<string>();
  let anonymous = 0;
  for (const st of clients.values()) {
    const name = st.userId ? one<{ name: string }>('SELECT name FROM users WHERE id = ?', st.userId)?.name : undefined;
    if (name) people.add(name);
    else anonymous++;
  }
  return {
    now: Date.now(),
    uptime: Date.now() - started,
    browsers: { tabs: clients.size, people: [...people], anonymous },
    nodes: all<NodeRow>('SELECT * FROM nodes ORDER BY id').map((n) => ({
      id: n.id,
      name: n.name,
      college: college(n.college_id)?.name ?? n.college_id,
      online: isOnline(n.id),
      address: nodeAddresses.get(n.id) ?? null,
      local: onThisMachine(nodeAddresses.get(n.id) ?? null),
      kind: n.examiner_kind,
      fingerprint: fingerprint(n.examiner_pubkey),
      counter: n.last_counter,
      last_seen: n.last_seen,
    })),
    inFlight: all<AttemptRow>("SELECT * FROM attempts WHERE status IN ('queued','running') ORDER BY created_at").map((a) => ({
      id: a.id,
      node: a.node_id,
      test: a.test_id,
      stage: a.stage,
      user: userBrief(a.user_id)?.name ?? null,
      since: a.created_at,
    })),
    totals: {
      people: count('SELECT COUNT(*) AS n FROM users'),
      attempts: count('SELECT COUNT(*) AS n FROM attempts'),
      proofs: count("SELECT COUNT(*) AS n FROM attempts WHERE status = 'verified' AND result = 'pass'"),
      connections: count('SELECT COUNT(*) AS n FROM connections'),
    },
  };
}
