// node --import tsx --test src/verdict.test.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccl-test-'));
process.env.CCL_DB = path.join(tmp, 'test.db');

const { run, one } = await import('./db.js');
const { checkVerdict } = await import('./verdict.js');
type AttemptRow = import('./db.js').AttemptRow;
type NodeRow = import('./db.js').NodeRow;

const key = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const t0 = Date.now();
run("INSERT INTO colleges (id, name, city, has_lab) VALUES ('c', 'C', 'X', 1)");
run("INSERT INTO users (id, name, email, role, created_at) VALUES ('s', 'Student', 's@x', 'student', 0), ('a', 'Author', 'a@x', 'alum', 0), ('o', 'Owner', 'o@x', 'club', 0)");
run("INSERT INTO challenges (id, test_id, author_id, title, offer_type, offer, created_at) VALUES ('ch', 'uart-nonce', 'a', 'T', 'referral', 'o', 0)");
run(`INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, examiner_id, examiner_kind, examiner_pubkey, last_counter, created_at)
     VALUES ('n1', 'Node', 'c', 'o', 'b', 'h', 'ex-1', 'esp32', ?, 10, 0)`, pub);
run('INSERT INTO bookings (id, node_id, user_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, 0)', 'bk', 'n1', 's', t0 - 60_000, t0 + 30 * 60_000);
run(`INSERT INTO attempts (id, user_id, challenge_id, test_id, node_id, booking_id, code, nonce, status, created_at)
     VALUES ('att1', 's', 'ch', 'uart-nonce', 'n1', 'bk', 'x', '9c41e2', 'running', ?)`, t0);

const attempt = one<AttemptRow>("SELECT * FROM attempts WHERE id = 'att1'")!;
const node = one<NodeRow>("SELECT * FROM nodes WHERE id = 'n1'")!;

function signed(overrides: Record<string, unknown> = {}, signer = key.privateKey) {
  const payload = JSON.stringify({
    v: 2, attempt: 'att1', challenge: 'uart-nonce', node: 'n1', examiner: 'ex-1', kind: 'esp32', target: 'fpga',
    nonce: '9c41e2', counter: 11, measured: { baud: 115385, echo: '9c41e2', early_tx: 0 }, result: 'pass',
    ...overrides,
  });
  return { payload, sig: crypto.sign('sha256', Buffer.from(payload), signer).toString('base64') };
}

test('accepts a correctly signed, fresh verdict', () => {
  const v = signed();
  const r = checkVerdict(attempt, node, v.payload, v.sig);
  assert.equal(r.ok, true);
});

test('rejects a payload edited after signing', () => {
  const v = signed({ result: 'fail' });
  const r = checkVerdict(attempt, node, v.payload.replace('"fail"', '"pass"'), v.sig);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /signature/);
});

test('rejects a verdict signed by a different key', () => {
  const v = signed({}, other.privateKey);
  assert.equal(checkVerdict(attempt, node, v.payload, v.sig).ok, false);
});

test('rejects a stale nonce (a recording of another attempt)', () => {
  const v = signed({ nonce: '000001' });
  const r = checkVerdict(attempt, node, v.payload, v.sig);
  assert.match((r as { reason: string }).reason, /nonce/);
});

test('rejects a replayed counter', () => {
  const v = signed({ counter: 10 });
  const r = checkVerdict(attempt, node, v.payload, v.sig);
  assert.match((r as { reason: string }).reason, /replay/);
});

test('rejects a payload that claims a different examiner tier than the node is enrolled as', () => {
  const v = signed();
  const r = checkVerdict(attempt, { ...node, examiner_kind: 'sim' }, v.payload, v.sig);
  assert.match((r as { reason: string }).reason, /says kind .esp32., but this node's examiner is enrolled as .sim./);
});

test('rejects a verdict that does not say what was examined', () => {
  const v = signed({ v: 1, target: undefined });
  const r = checkVerdict(attempt, node, v.payload, v.sig);
  assert.match((r as { reason: string }).reason, /what was examined/);
});

test('rejects a sim examiner that claims to have tested a physical FPGA', () => {
  const v = signed({ kind: 'sim', target: 'fpga' });
  const r = checkVerdict(attempt, { ...node, examiner_kind: 'sim' }, v.payload, v.sig);
  assert.match((r as { reason: string }).reason, /sim examiner cannot have examined target "fpga"/);
});

test('rejects an ESP32 verdict that says it tested a simulation', () => {
  const v = signed({ target: 'bitstream' });
  const r = checkVerdict(attempt, node, v.payload, v.sig);
  assert.match((r as { reason: string }).reason, /esp32 examiner cannot have examined target "bitstream"/);
});

test('rejects a verdict that names another node', () => {
  const v = signed({ node: 'n2' });
  assert.equal(checkVerdict(attempt, node, v.payload, v.sig).ok, false);
});

test('rejects a verdict that arrives after the booking ended', () => {
  const v = signed();
  const r = checkVerdict(attempt, node, v.payload, v.sig, t0 + 60 * 60_000);
  assert.match((r as { reason: string }).reason, /booking/);
});
