import crypto from 'node:crypto';
import { Router } from 'express';
import { checkPassword, createSession, DEMO_LOGIN, hashPassword, publicUser, requireAuth, requireRole } from './auth.js';
import {
  all,
  one,
  run,
  tx,
  type BookingRow,
  type ChallengeRow,
  type ConnectionRow,
  type NodeRow,
  type UserRow,
} from './db.js';
import { computeGap } from './gap.js';
import { cancelAttemptsForBooking } from './hub.js';
import { notify } from './notify.js';
import { broadcast, isOnline } from './presence.js';
import { rateLimit } from './ratelimit.js';
import { TESTS } from './tests.js';
import { HttpError, now, PAIRING_WINDOW_MS, parseJson, prefixedId, sha256 } from './util.js';
import {
  badgesOf,
  bookingView,
  challengeView,
  claimsOf,
  college,
  connectionView,
  nodeView,
  testBrief,
  userBrief,
  verifiedSkills,
} from './views.js';

export const api = Router();

const POSTER_ROLES: UserRow['role'][] = ['alum', 'recruiter', 'founder'];

// One upcoming slot per board and two overall, so nobody can hold a board's whole week.
const MAX_UPCOMING_PER_NODE = 1;
const MAX_UPCOMING_TOTAL = 2;

const authLimit = rateLimit(20, 60_000);
const writeLimit = rateLimit(30, 60_000);

// ---------------------------------------------------------------- auth

// The seeded, fictional people, for the persona picker. Empty when demo sign-in is off.
api.get('/auth/demo-users', (_req, res) => {
  if (!DEMO_LOGIN) {
    res.json([]);
    return;
  }
  res.json(
    all<UserRow>('SELECT * FROM users WHERE is_demo = 1 ORDER BY created_at, name').map((u) => ({
      ...userBrief(u.id),
      email: u.email,
    })),
  );
});

// Email + password. With demo sign-in on, a seeded demo person can sign in with the email alone.
api.post('/auth/login', authLimit, (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const u = one<UserRow>('SELECT * FROM users WHERE email = ?', email);
  const demo = !!u && DEMO_LOGIN && !!u.is_demo && !password;
  if (!demo && !checkPassword(password, u?.password_hash ?? null)) throw new HttpError(401, 'Wrong email or password');
  res.json({ token: createSession(u!.id), user: publicUser(u!) });
});

api.post('/auth/signup', authLimit, (req, res) => {
  const b = req.body ?? {};
  const role = String(b.role ?? 'student') as UserRow['role'];
  if (!['student', 'alum', 'recruiter', 'founder', 'club'].includes(role)) throw new HttpError(400, 'Unknown role');
  const name = String(b.name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!name || !email.includes('@')) throw new HttpError(400, 'Name and email are required');
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) throw new HttpError(400, 'Pick a password of at least 8 characters');
  if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'That email already has an account');
  const claims = Array.isArray(b.claims) ? b.claims.map(String).slice(0, 12) : [];
  const id = prefixedId('u');
  run(
    'INSERT INTO users (id, name, email, role, headline, college_id, org, claims, hue, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, email, role, String(b.headline ?? ''), b.college_id ? String(b.college_id) : null,
    b.org ? String(b.org) : null, JSON.stringify(claims), crypto.randomInt(360), hashPassword(password), now(),
  );
  const u = one<UserRow>('SELECT * FROM users WHERE id = ?', id)!;
  res.json({ token: createSession(id), user: publicUser(u) });
});

api.get('/me', requireAuth, (req, res) => {
  const u = req.user!;
  res.json({
    ...publicUser(u),
    college: college(u.college_id),
    verified_skills: verifiedSkills(u.id),
    badges: badgesOf(u.id),
  });
});

// ---------------------------------------------------------------- reference data

api.get('/meta', (_req, res) => {
  res.json({
    skills: all('SELECT * FROM skills ORDER BY area, name'),
    colleges: all<{ id: string }>('SELECT * FROM colleges ORDER BY name').map((c) => college(c.id)),
    tests: [...TESTS.values()].map((t) => testBrief(t.id)),
    roles: all<{ id: string; skills: string; author_id: string }>('SELECT * FROM roles ORDER BY created_at').map((r) => ({
      ...r,
      skills: parseJson<string[]>(r.skills, []),
      author: userBrief(r.author_id),
    })),
  });
});

api.get('/stats', (_req, res) => {
  const n = (sql: string) => one<{ n: number }>(sql)!.n;
  res.json({
    proofs: n("SELECT COUNT(*) AS n FROM attempts WHERE status = 'verified' AND result = 'pass'"),
    connections: n('SELECT COUNT(*) AS n FROM connections'),
    nodes: n('SELECT COUNT(*) AS n FROM nodes'),
    no_lab_students: n(
      `SELECT COUNT(DISTINCT b.user_id) AS n FROM badges b JOIN users u ON u.id = b.user_id
       JOIN colleges c ON c.id = u.college_id WHERE c.has_lab = 0`,
    ),
  });
});

// ---------------------------------------------------------------- challenges & roles

api.get('/challenges', (req, res) => {
  const rows = all<ChallengeRow>('SELECT * FROM challenges ORDER BY created_at DESC');
  res.json(rows.map((c) => challengeView(c, req.user?.id)));
});

api.get('/challenges/:id', (req, res) => {
  const c = one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', req.params.id);
  if (!c) throw new HttpError(404, 'Challenge not found');
  const t = TESTS.get(c.test_id);
  const passers = all<{ user_id: string; id: string; finished_at: number }>(
    `SELECT user_id, id, finished_at FROM attempts WHERE challenge_id = ? AND status = 'verified' AND result = 'pass'
     ORDER BY finished_at DESC LIMIT 12`,
    c.id,
  ).map((p) => ({ attempt_id: p.id, at: p.finished_at, user: userBrief(p.user_id) }));
  res.json({ ...challengeView(c, req.user?.id), spec: t?.spec ?? '', starter: t?.starter ?? '', passers });
});

api.post('/challenges', requireRole(...POSTER_ROLES), (req, res) => {
  const b = req.body ?? {};
  const testId = String(b.test_id ?? '');
  if (!TESTS.has(testId)) throw new HttpError(400, 'Pick a test from the library');
  const offerType = String(b.offer_type ?? 'referral');
  if (!['referral', 'mentorship', 'internship', 'interview'].includes(offerType)) throw new HttpError(400, 'Unknown offer type');
  const title = String(b.title ?? '').trim() || TESTS.get(testId)!.title;
  const offer = String(b.offer ?? '').trim();
  if (!offer) throw new HttpError(400, 'Say what you are offering');
  const roleId = b.role_id ? String(b.role_id) : null;
  if (roleId && !one('SELECT 1 FROM roles WHERE id = ? AND author_id = ?', roleId, req.user!.id)) {
    throw new HttpError(400, 'You can only link a role you posted');
  }
  const id = prefixedId('c');
  run('INSERT INTO challenges (id, test_id, author_id, role_id, title, offer_type, offer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, testId, req.user!.id, roleId, title, offerType, offer, now());
  res.json(challengeView(one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', id)!, req.user!.id));
});

api.post('/roles', requireRole(...POSTER_ROLES), (req, res) => {
  const b = req.body ?? {};
  const skills = Array.isArray(b.skills) ? b.skills.map(String) : [];
  if (!b.title || !skills.length) throw new HttpError(400, 'A role needs a title and at least one skill');
  const id = prefixedId('r');
  run('INSERT INTO roles (id, title, org, author_id, skills, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, String(b.title), String(b.org ?? req.user!.org ?? ''), req.user!.id, JSON.stringify(skills), String(b.description ?? ''), now());
  res.json({ id });
});

api.get('/gap', requireAuth, (req, res) => {
  const roleId = String(req.query.role ?? '') || one<{ id: string }>('SELECT id FROM roles ORDER BY created_at LIMIT 1')?.id;
  if (!roleId) throw new HttpError(404, 'No roles posted yet');
  const gap = computeGap(req.user!.id, roleId);
  if (!gap) throw new HttpError(404, 'Role not found');
  res.json({ ...gap, claims: claimsOf(req.user!) });
});

// ---------------------------------------------------------------- lab nodes & bookings

api.get('/nodes', (_req, res) => {
  res.json(all<NodeRow>('SELECT * FROM nodes ORDER BY created_at').map(nodeView));
});

api.post('/nodes', requireRole('club'), (req, res) => {
  const u = req.user!;
  if (!u.college_id) throw new HttpError(400, 'Your club account has no college');
  const name = String(req.body?.name ?? '').trim() || `${u.org ?? 'Club'} bench`;
  // Every node in this build simulates its board (docs/SIMULATION.md), so say so unless told otherwise
  const board = String(req.body?.board ?? '').trim() || 'Simulated iCE40 UP5K (iCEBreaker pinout), no physical board';
  const base = u.college_id.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM nodes WHERE college_id = ?', u.college_id)!.n;
  let id = `${base}-${String(count + 1).padStart(2, '0')}`;
  while (one('SELECT 1 FROM nodes WHERE id = ?', id)) id += 'x';
  const token = crypto.randomBytes(18).toString('base64url');
  run('INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, pin_open_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, u.college_id, u.id, board, sha256(token), now() + PAIRING_WINDOW_MS, now());
  broadcast({ type: 'nodes' });
  // The token is shown once. Only its hash is stored. The examiner key is pinned on first connect.
  res.json({ node: nodeView(one<NodeRow>('SELECT * FROM nodes WHERE id = ?', id)!), token });
});

api.get('/bookings/mine', requireAuth, (req, res) => {
  const rows = all<BookingRow>(
    'SELECT * FROM bookings WHERE user_id = ? AND cancelled = 0 AND ends_at > ? ORDER BY starts_at',
    req.user!.id,
    now() - 60 * 60_000,
  );
  res.json(rows.map((b) => ({ ...bookingView(b), node: nodeView(one<NodeRow>('SELECT * FROM nodes WHERE id = ?', b.node_id)!) })));
});

api.post('/bookings', requireAuth, writeLimit, (req, res) => {
  const nodeId = String(req.body?.node_id ?? '');
  const node = one<NodeRow>('SELECT * FROM nodes WHERE id = ?', nodeId);
  if (!node) throw new HttpError(404, 'Lab node not found');
  const minutes = Number(req.body?.minutes ?? 30);
  if (![15, 30, 60].includes(minutes)) throw new HttpError(400, 'Slots are 15, 30 or 60 minutes');
  const t = now();
  const startsAt = req.body?.starts_at ? Number(req.body.starts_at) : Math.floor(t / 60_000) * 60_000;
  if (!Number.isFinite(startsAt) || startsAt < t - 5 * 60_000) throw new HttpError(400, 'That slot has already started');
  if (startsAt > t + 7 * 24 * 60 * 60_000) throw new HttpError(400, 'Book at most a week ahead');
  if (startsAt < t + 5 * 60_000 && !isOnline(nodeId)) {
    throw new HttpError(503, `${node.name} is offline right now. Pick a later slot, or try again when it's back.`);
  }
  const endsAt = startsAt + minutes * 60_000;

  const id = prefixedId('b');
  tx(() => {
    const upcoming = all<BookingRow>('SELECT * FROM bookings WHERE user_id = ? AND cancelled = 0 AND ends_at > ?', req.user!.id, t);
    if (upcoming.filter((b) => b.node_id === nodeId).length >= MAX_UPCOMING_PER_NODE) {
      throw new HttpError(409, 'You already have a slot on this board. Cancel it to pick another.');
    }
    if (upcoming.length >= MAX_UPCOMING_TOTAL) {
      throw new HttpError(409, `You can hold ${MAX_UPCOMING_TOTAL} upcoming slots at a time. Cancel one to book another.`);
    }
    const clash = one<BookingRow>(
      'SELECT * FROM bookings WHERE node_id = ? AND cancelled = 0 AND starts_at < ? AND ends_at > ?',
      nodeId, endsAt, startsAt,
    );
    if (clash) throw new HttpError(409, 'That slot overlaps another booking on this board');
    run('INSERT INTO bookings (id, node_id, user_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, nodeId, req.user!.id, startsAt, endsAt, t);
  });
  if (node.owner_id !== req.user!.id) {
    const when = new Date(startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    notify(node.owner_id, `${req.user!.name} booked ${node.name} at ${when} IST for ${minutes} min`, '/labs');
  }
  broadcast({ type: 'nodes' });
  res.json(bookingView(one<BookingRow>('SELECT * FROM bookings WHERE id = ?', id)!));
});

api.delete('/bookings/:id', requireAuth, (req, res) => {
  const b = one<BookingRow>('SELECT * FROM bookings WHERE id = ?', req.params.id);
  if (!b || b.user_id !== req.user!.id) throw new HttpError(404, 'Booking not found');
  run('UPDATE bookings SET cancelled = 1 WHERE id = ?', b.id);
  // A verdict for it would be refused anyway (no live booking); end the attempt now.
  cancelAttemptsForBooking(b.id);
  broadcast({ type: 'nodes' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- people & the graph

api.get('/users/:id', (req, res) => {
  const u = one<UserRow>('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw new HttpError(404, 'Person not found');
  const conns = all<ConnectionRow>(
    'SELECT * FROM connections WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC',
    u.id, u.id,
  ).map(connectionView);
  const challenges = all<ChallengeRow>('SELECT * FROM challenges WHERE author_id = ? ORDER BY created_at DESC', u.id)
    .map((c) => challengeView(c, req.user?.id));
  const nodes = all<NodeRow>('SELECT * FROM nodes WHERE owner_id = ?', u.id).map(nodeView);
  res.json({
    ...userBrief(u.id),
    claims: claimsOf(u),
    verified_skills: verifiedSkills(u.id),
    badges: badgesOf(u.id),
    connections: conns,
    challenges,
    nodes,
  });
});

api.get('/network', (_req, res) => {
  const users = all<UserRow>('SELECT * FROM users');
  const edges = all<ConnectionRow>('SELECT * FROM connections ORDER BY created_at');
  res.json({
    nodes: users.map((u) => ({
      ...userBrief(u.id),
      badges: one<{ n: number }>('SELECT COUNT(*) AS n FROM badges WHERE user_id = ?', u.id)!.n,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.from_id,
      target: e.to_id,
      type: e.type,
      attempt_id: e.attempt_id,
      created_at: e.created_at,
    })),
  });
});

// The challenge author acts on a proof: send the referral or start the mentorship.
api.post('/connections/:id/act', requireAuth, (req, res) => {
  const c = one<ConnectionRow>('SELECT * FROM connections WHERE id = ?', req.params.id);
  if (!c || c.type !== 'proved_for') throw new HttpError(404, 'Proof connection not found');
  if (c.to_id !== req.user!.id) throw new HttpError(403, 'Only the challenge author can act on this proof');
  const action = String(req.body?.action ?? '');
  const type = action === 'referral' ? 'referred' : action === 'mentorship' ? 'mentored' : null;
  if (!type) throw new HttpError(400, 'Action must be referral or mentorship');
  if (one('SELECT 1 FROM connections WHERE parent_id = ? AND type = ?', c.id, type)) throw new HttpError(409, 'Already done');
  const note = String(req.body?.note ?? '').trim() || (type === 'referred' ? 'Referral sent.' : 'Mentorship offered.');
  const id = prefixedId('e');
  run(`INSERT INTO connections (id, from_id, to_id, type, attempt_id, challenge_id, node_id, parent_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.user!.id, c.from_id, type, c.attempt_id, c.challenge_id, null, c.id, note, now());
  notify(
    c.from_id,
    type === 'referred' ? `${req.user!.name} sent you a referral: ${note}` : `${req.user!.name} offered to mentor you: ${note}`,
    `/u/${c.from_id}`,
  );
  broadcast({ type: 'network' });
  res.json(connectionView(one<ConnectionRow>('SELECT * FROM connections WHERE id = ?', id)!));
});

// Proofs addressed to me that I haven't acted on yet.
api.get('/inbox', requireAuth, (req, res) => {
  const rows = all<ConnectionRow>(
    `SELECT * FROM connections c WHERE c.to_id = ? AND c.type = 'proved_for'
     AND NOT EXISTS (SELECT 1 FROM connections f WHERE f.parent_id = c.id)
     ORDER BY c.created_at DESC`,
    req.user!.id,
  );
  res.json(rows.map(connectionView));
});

// ---------------------------------------------------------------- notifications

api.get('/notifications', requireAuth, (req, res) => {
  res.json(all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', req.user!.id));
});

api.post('/notifications/read', requireAuth, (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user!.id);
  res.json({ ok: true });
});
