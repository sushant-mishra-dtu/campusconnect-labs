// node --import tsx --test src/api.test.ts
// Sign-in and booking rules over HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import express, { type NextFunction, type Request, type Response } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crtl-api-test-'));
process.env.CRTL_DB = path.join(tmp, 'test.db');
delete process.env.CRTL_DEMO_LOGIN;
delete process.env.NODE_ENV;

const { run } = await import('./db.js');
const { optionalAuth } = await import('./auth.js');
const { api } = await import('./routes.js');
const { nodeSockets } = await import('./presence.js');
const { HttpError } = await import('./util.js');

run("INSERT INTO colleges (id, name, city, has_lab) VALUES ('c', 'C', 'X', 1)");
run("INSERT INTO users (id, name, email, role, is_demo, created_at) VALUES ('d', 'Demo', 'demo@demo.c-rtl', 'student', 1, 0), ('o', 'Owner', 'o@x', 'club', 0, 0)");
for (const id of ['n1', 'n2', 'n3']) {
  run("INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, created_at) VALUES (?, ?, 'c', 'o', 'b', 'h', 0)", id, id);
}

const app = express();
app.use(express.json());
app.use(optionalAuth);
app.use('/api', api);
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err instanceof HttpError ? err.status : 500).json({ error: (err as Error).message });
});
const server = http.createServer(app);
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
after(() => server.close());

async function call(p: string, body?: unknown, token?: string) {
  const res = await fetch(base + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> & { token?: string } };
}

test('sign-up needs a password, and signing in needs it too', async () => {
  assert.equal((await call('/auth/signup', { name: 'Riya', email: 'riya@x' })).status, 400);
  const up = await call('/auth/signup', { name: 'Riya', email: 'riya@x', password: 'correct horse' });
  assert.equal(up.status, 200);
  assert.equal('password_hash' in (up.data.user as object), false, 'hash never leaves the server');
  assert.equal((await call('/auth/login', { email: 'riya@x' })).status, 401);
  assert.equal((await call('/auth/login', { email: 'riya@x', password: 'wrong horse' })).status, 401);
  assert.equal((await call('/auth/login', { email: 'riya@x', password: 'correct horse' })).status, 200);
  assert.equal((await call('/auth/login', { email: 'nobody@x', password: 'correct horse' })).status, 401);
});

test('demo sign-in covers only the seeded demo people', async () => {
  const list = await call('/auth/demo-users');
  assert.deepEqual((list.data as unknown as { email: string }[]).map((u) => u.email), ['demo@demo.c-rtl']);
  assert.equal((await call('/auth/login', { email: 'demo@demo.c-rtl' })).status, 200);
  assert.equal((await call('/auth/login', { email: 'o@x' })).status, 401);
});

test('one upcoming slot per board, two overall, and no instant slot on an offline board', async () => {
  const { data } = await call('/auth/login', { email: 'demo@demo.c-rtl' });
  const tok = data.token!;
  const hour = 60 * 60_000;
  const later = Math.ceil((Date.now() + 2 * hour) / 60_000) * 60_000;

  assert.equal((await call('/bookings', { node_id: 'n1', minutes: 30 }, tok)).status, 503);
  assert.equal((await call('/bookings', { node_id: 'n1', minutes: 30, starts_at: later }, tok)).status, 200);
  const again = await call('/bookings', { node_id: 'n1', minutes: 30, starts_at: later + hour }, tok);
  assert.equal(again.status, 409);
  assert.match(String(again.data.error), /already have a slot on this board/);

  nodeSockets.set('n2', {} as never); // online: an instant slot is fine
  assert.equal((await call('/bookings', { node_id: 'n2', minutes: 15 }, tok)).status, 200);
  const third = await call('/bookings', { node_id: 'n3', minutes: 30, starts_at: later }, tok);
  assert.equal(third.status, 409);
  assert.match(String(third.data.error), /2 upcoming slots/);
});
