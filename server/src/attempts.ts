import { Router } from 'express';
import { requireAuth } from './auth.js';
import { all, one, run, type AttemptRow, type BookingRow, type ChallengeRow, type NodeRow } from './db.js';
import { dispatchAttempt } from './hub.js';
import { isOnline } from './presence.js';
import { makeNonce } from './tests.js';
import { HttpError, hexId, now } from './util.js';
import { attemptView } from './views.js';

export const attempts = Router();

const MAX_CODE = 64 * 1024;

// Student submits Verilog. The platform checks the booking, issues a fresh nonce
// and hands the job to the lab node that owns the board.
attempts.post('/attempts', requireAuth, (req, res) => {
  const u = req.user!;
  const challengeId = String(req.body?.challenge_id ?? '');
  const nodeId = String(req.body?.node_id ?? '');
  const code = String(req.body?.code ?? '');

  const ch = one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', challengeId);
  if (!ch) throw new HttpError(404, 'Challenge not found');
  if (!code.trim()) throw new HttpError(400, 'Write some Verilog first');
  if (code.length > MAX_CODE) throw new HttpError(413, 'Code is larger than 64 KB');

  const node = one<NodeRow>('SELECT * FROM nodes WHERE id = ?', nodeId);
  if (!node) throw new HttpError(404, 'Lab node not found');

  const t = now();
  const booking = one<BookingRow>(
    'SELECT * FROM bookings WHERE node_id = ? AND user_id = ? AND cancelled = 0 AND starts_at <= ? AND ends_at > ?',
    nodeId, u.id, t, t,
  );
  if (!booking) throw new HttpError(403, `You don't have a live booking on ${node.name}. Book a slot first.`);
  if (!isOnline(nodeId)) throw new HttpError(503, `${node.name} is offline right now`);
  if (one("SELECT 1 FROM attempts WHERE user_id = ? AND node_id = ? AND status IN ('queued','running')", u.id, nodeId)) {
    throw new HttpError(409, 'Your previous attempt on this board is still running');
  }

  let id = hexId(4);
  while (one('SELECT 1 FROM attempts WHERE id = ?', id)) id = hexId(4);

  run(`INSERT INTO attempts (id, user_id, challenge_id, test_id, node_id, booking_id, code, nonce, status, stage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?)`,
    id, u.id, ch.id, ch.test_id, nodeId, booking.id, code, makeNonce(ch.test_id), t);

  const a = one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', id)!;
  dispatchAttempt(a);
  res.json(attemptView(one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', id)!, { log: true }));
});

attempts.get('/attempts/mine', requireAuth, (req, res) => {
  const rows = all<AttemptRow>('SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', req.user!.id);
  res.json(rows.map((a) => attemptView(a)));
});

attempts.get('/attempts/:id', requireAuth, (req, res) => {
  const a = one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', req.params.id);
  if (!a || a.user_id !== req.user!.id) throw new HttpError(404, 'Attempt not found');
  res.json(attemptView(a, { code: true, log: true }));
});

// Public: anyone can fetch a proof and re-verify the signature themselves.
attempts.get('/proofs/:id', (req, res) => {
  const a = one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', req.params.id);
  if (!a || !a.payload) throw new HttpError(404, 'No signed verdict for that attempt');
  res.json(attemptView(a));
});
