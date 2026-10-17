// node --import tsx --test src/hub.test.ts
// Lab node sessions over a real WebSocket: who may pair, who counts as silicon, and what a
// verified pass creates.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { WebSocket } from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccl-hub-test-'));
process.env.CCL_DB = path.join(tmp, 'test.db');

const { all, enforceEnrollment, one, run } = await import('./db.js');
const { attachHub } = await import('./hub.js');
const { keyHash, sha256 } = await import('./util.js');

const pair = () => {
  const k = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};
const simKey = pair();
const otherKey = pair();
const espKey = pair();

const t0 = Date.now();
run("INSERT INTO colleges (id, name, city, has_lab) VALUES ('c', 'C', 'X', 1)");
run("INSERT INTO users (id, name, email, role, created_at) VALUES ('s', 'Student', 's@x', 'student', 0), ('a', 'Author', 'a@x', 'alum', 0), ('o', 'Owner', 'o@x', 'club', 0)");
run("INSERT INTO challenges (id, test_id, author_id, title, offer_type, offer, created_at) VALUES ('ch', 'uart-nonce', 'a', 'T', 'referral', 'o', 0)");
const addNode = (id: string, pinOpenUntil: number | null) =>
  run('INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, pin_open_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    id, id, 'c', 'o', 'b', sha256(`tok-${id}`), pinOpenUntil);
addNode('open', t0 + 60 * 60_000);
addNode('closed', null);
addNode('silicon', null);
run('INSERT INTO silicon_examiners (key_sha256, node_id, enrolled_at) VALUES (?, ?, 0)', keyHash(espKey.pub), 'silicon');

const server = http.createServer();
attachHub(server);
await new Promise<void>((r) => server.listen(0, r));
const url = `ws://localhost:${(server.address() as AddressInfo).port}/ws/node`;
const sockets: WebSocket[] = [];
after(() => {
  for (const ws of sockets) ws.terminate();
  server.close();
});

type Reply = { type: string; reason?: string; retry?: boolean; kind?: string };
async function hello(node: string, pub: string, kind = 'sim', token = `tok-${node}`): Promise<{ ws: WebSocket; reply: Reply }> {
  const ws = new WebSocket(url);
  sockets.push(ws);
  await new Promise((r) => ws.once('open', r));
  const reply = new Promise<Reply>((r) => ws.once('message', (m) => r(JSON.parse(String(m)))));
  ws.send(JSON.stringify({ type: 'hello', node, token, examiner: { id: `ex-${node}`, kind, pubkey: pub } }));
  return { ws, reply: await reply };
}
async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(cond(), 'timed out waiting');
}
const closeAndWait = async (ws: WebSocket) => {
  ws.close();
  await new Promise((r) => ws.once('close', r));
  await new Promise((r) => setTimeout(r, 50));
};

test('a bad token is refused', async () => {
  const { reply } = await hello('open', simKey.pub, 'sim', 'nope');
  assert.equal(reply.type, 'rejected');
});

test('a node that calls itself esp32 without an enrollment is refused, and nothing is pinned', async () => {
  const { reply } = await hello('open', simKey.pub, 'esp32');
  assert.equal(reply.type, 'rejected');
  assert.match(reply.reason!, /not enrolled for open/);
  const n = one<{ examiner_pubkey: string | null; pin_open_until: number | null }>("SELECT * FROM nodes WHERE id = 'open'")!;
  assert.equal(n.examiner_pubkey, null);
  assert.ok(n.pin_open_until, 'the pairing window stays open for the real examiner');
});

test('a sim examiner pairs as sim inside the pairing window', async () => {
  const { ws, reply } = await hello('open', simKey.pub);
  assert.equal(reply.type, 'welcome');
  assert.equal(reply.kind, 'sim');
  const n = one<{ examiner_kind: string; pin_open_until: number | null }>("SELECT * FROM nodes WHERE id = 'open'")!;
  assert.equal(n.examiner_kind, 'sim');
  assert.equal(n.pin_open_until, null, 'pinning closes the pairing window');

  // a second session with the right token doesn't kick the live one
  const second = await hello('open', simKey.pub);
  assert.equal(second.reply.type, 'rejected');
  assert.equal(second.reply.retry, true);
  assert.equal(ws.readyState, WebSocket.OPEN);
  await closeAndWait(ws);
});

test('once pinned, another key is refused', async () => {
  const { reply } = await hello('open', otherKey.pub);
  assert.equal(reply.type, 'rejected');
  assert.match(reply.reason!, /does not match the pinned key/);
});

test('with the pairing window closed, nothing new gets pinned', async () => {
  const { reply } = await hello('closed', simKey.pub);
  assert.equal(reply.type, 'rejected');
  assert.match(reply.reason!, /pairing window/);
  assert.equal(one<{ examiner_pubkey: string | null }>("SELECT * FROM nodes WHERE id = 'closed'")!.examiner_pubkey, null);
});

test('an enrolled examiner pairs and counts as silicon', async () => {
  const { ws, reply } = await hello('silicon', espKey.pub, 'esp32');
  assert.equal(reply.type, 'welcome');
  assert.equal(reply.kind, 'esp32');
  assert.equal(one<{ examiner_kind: string }>("SELECT * FROM nodes WHERE id = 'silicon'")!.examiner_kind, 'esp32');
  await closeAndWait(ws);
});

test('an enrolled key that says sim is refused rather than signing verdicts that would be refused', async () => {
  const { reply } = await hello('silicon', espKey.pub, 'sim');
  assert.equal(reply.type, 'rejected');
  assert.match(reply.reason!, /--mode=hw/);
});

test('passing the same challenge twice makes one proof connection and one notification', async () => {
  const { ws } = await hello('open', simKey.pub);
  run("INSERT INTO bookings (id, node_id, user_id, starts_at, ends_at, created_at) VALUES ('bk', 'open', 's', ?, ?, 0)", t0 - 60_000, t0 + 30 * 60_000);
  for (const [i, id] of ['att1', 'att2'].entries()) {
    run(`INSERT INTO attempts (id, user_id, challenge_id, test_id, node_id, booking_id, code, nonce, status, created_at)
         VALUES (?, 's', 'ch', 'uart-nonce', 'open', 'bk', 'x', '9c41e2', 'running', ?)`, id, Date.now());
    const payload = JSON.stringify({
      v: 2, attempt: id, challenge: 'uart-nonce', node: 'open', examiner: 'ex-open', kind: 'sim', target: 'netlist',
      nonce: '9c41e2', counter: i + 1, measured: {}, result: 'pass',
    });
    ws.send(JSON.stringify({ type: 'verdict', attempt: id, payload, sig: crypto.sign('sha256', Buffer.from(payload), simKey.priv).toString('base64') }));
    await until(() => one<{ status: string }>('SELECT status FROM attempts WHERE id = ?', id)!.status !== 'running');
    assert.equal(one<{ status: string }>('SELECT status FROM attempts WHERE id = ?', id)!.status, 'verified');
  }
  assert.equal(all("SELECT 1 FROM connections WHERE type = 'proved_for' AND from_id = 's' AND to_id = 'a'").length, 1);
  assert.equal(all("SELECT 1 FROM badges WHERE user_id = 's'").length, 1);
  assert.equal(all("SELECT 1 FROM notifications WHERE user_id = 'a'").length, 1);
  assert.throws(() =>
    run("INSERT INTO connections (id, from_id, to_id, type, challenge_id, created_at) VALUES ('dup', 's', 'a', 'proved_for', 'ch', 0)"),
  );
  await closeAndWait(ws);
});

test('esp32 labels without an enrollment are downgraded, proofs and badges included', () => {
  run(`INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, examiner_id, examiner_kind, examiner_pubkey, created_at)
       VALUES ('liar', 'liar', 'c', 'o', 'b', 'h', 'ex-l', 'esp32', ?, 0)`, otherKey.pub);
  run("INSERT INTO bookings (id, node_id, user_id, starts_at, ends_at, created_at) VALUES ('bk2', 'liar', 's', 0, 1, 0)");
  run(`INSERT INTO attempts (id, user_id, challenge_id, test_id, node_id, booking_id, code, nonce, status, examiner_kind, examiner_pubkey, created_at)
       VALUES ('att3', 's', 'ch', 'pwm-duty', 'liar', 'bk2', 'x', '000000', 'verified', 'esp32', ?, 0)`, otherKey.pub);
  run("INSERT INTO badges (id, user_id, test_id, attempt_id, kind, issued_at) VALUES ('bd3', 's', 'pwm-duty', 'att3', 'esp32', 0)");
  enforceEnrollment();
  assert.equal(one<{ examiner_kind: string }>("SELECT * FROM nodes WHERE id = 'liar'")!.examiner_kind, 'sim');
  assert.equal(one<{ examiner_kind: string }>("SELECT * FROM attempts WHERE id = 'att3'")!.examiner_kind, 'sim');
  assert.equal(one<{ kind: string }>("SELECT * FROM badges WHERE id = 'bd3'")!.kind, 'sim');
  assert.equal(one<{ examiner_kind: string }>("SELECT * FROM nodes WHERE id = 'silicon'")!.examiner_kind, 'esp32');
});
