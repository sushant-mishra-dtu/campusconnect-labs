// Shapes the API returns. Rows go in, JSON-ready objects come out.
import {
  all,
  one,
  type AttemptRow,
  type BookingRow,
  type ChallengeRow,
  type ConnectionRow,
  type NodeRow,
  type UserRow,
} from './db.js';
import { isOnline } from './presence.js';
import { TESTS } from './tests.js';
import { fingerprint, parseJson } from './util.js';

interface CollegeRow {
  id: string;
  name: string;
  city: string;
  has_lab: number;
}

export function college(id: string | null) {
  if (!id) return null;
  const c = one<CollegeRow>('SELECT * FROM colleges WHERE id = ?', id);
  return c ? { id: c.id, name: c.name, city: c.city, has_lab: !!c.has_lab } : null;
}

export function userBrief(id: string) {
  const u = one<UserRow>('SELECT * FROM users WHERE id = ?', id);
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role, headline: u.headline, org: u.org, hue: u.hue, college: college(u.college_id) };
}

export function testBrief(testId: string) {
  const t = TESTS.get(testId);
  if (!t) return { id: testId, title: testId, summary: '', difficulty: 'beginner', skills: [] as string[] };
  return { id: t.id, title: t.title, summary: t.summary, difficulty: t.difficulty, skills: t.skills };
}

export function badgesOf(userId: string) {
  return all<{ id: string; test_id: string; attempt_id: string; kind: string; issued_at: number; node_id: string; examiner_id: string }>(
    `SELECT b.*, a.node_id, a.examiner_id FROM badges b JOIN attempts a ON a.id = b.attempt_id
     WHERE b.user_id = ? ORDER BY b.issued_at DESC`,
    userId,
  ).map((b) => ({ ...b, test: testBrief(b.test_id) }));
}

export function verifiedSkills(userId: string) {
  const out = new Set<string>();
  for (const b of all<{ test_id: string }>('SELECT test_id FROM badges WHERE user_id = ?', userId)) {
    for (const s of TESTS.get(b.test_id)?.skills ?? []) out.add(s);
  }
  return [...out];
}

export function challengeView(c: ChallengeRow, viewerId?: string) {
  const role = c.role_id ? one<{ id: string; title: string; org: string }>('SELECT id, title, org FROM roles WHERE id = ?', c.role_id) : null;
  const passes = one<{ n: number }>(
    "SELECT COUNT(DISTINCT user_id) AS n FROM attempts WHERE challenge_id = ? AND status = 'verified' AND result = 'pass'",
    c.id,
  )!.n;
  const attempts = one<{ n: number }>('SELECT COUNT(*) AS n FROM attempts WHERE challenge_id = ?', c.id)!.n;
  let mine = null;
  if (viewerId) {
    const last = one<AttemptRow>('SELECT * FROM attempts WHERE challenge_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', c.id, viewerId);
    const passed = !!one('SELECT 1 FROM badges WHERE user_id = ? AND test_id = ?', viewerId, c.test_id);
    mine = { passed, last: last ? { id: last.id, status: last.status, result: last.result } : null };
  }
  return {
    id: c.id,
    title: c.title,
    offer_type: c.offer_type,
    offer: c.offer,
    created_at: c.created_at,
    test: testBrief(c.test_id),
    author: userBrief(c.author_id),
    role,
    passes,
    attempts,
    mine,
  };
}

export function bookingView(b: BookingRow) {
  return { id: b.id, node_id: b.node_id, user: userBrief(b.user_id), starts_at: b.starts_at, ends_at: b.ends_at };
}

export function nodeView(n: NodeRow) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const bookings = all<BookingRow>(
    'SELECT * FROM bookings WHERE node_id = ? AND cancelled = 0 AND ends_at > ? ORDER BY starts_at LIMIT 40',
    n.id,
    since.getTime(),
  ).map(bookingView);
  const served = one<{ n: number }>(
    "SELECT COUNT(DISTINCT user_id) AS n FROM attempts WHERE node_id = ? AND status = 'verified' AND result = 'pass'",
    n.id,
  )!.n;
  const runs = one<{ n: number }>('SELECT COUNT(*) AS n FROM attempts WHERE node_id = ?', n.id)!.n;
  return {
    id: n.id,
    name: n.name,
    board: n.board,
    college: college(n.college_id),
    owner: userBrief(n.owner_id),
    online: isOnline(n.id),
    last_seen: n.last_seen,
    examiner: n.examiner_pubkey
      ? { id: n.examiner_id, kind: n.examiner_kind, fingerprint: fingerprint(n.examiner_pubkey), counter: n.last_counter }
      : null,
    bookings,
    served,
    runs,
  };
}

export function attemptView(a: AttemptRow, opts: { code?: boolean; log?: boolean } = {}) {
  const ch = one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', a.challenge_id);
  const node = one<NodeRow>('SELECT * FROM nodes WHERE id = ?', a.node_id);
  return {
    id: a.id,
    status: a.status,
    stage: a.stage,
    result: a.result,
    verified: !!a.verified,
    reject_reason: a.reject_reason,
    nonce: a.nonce,
    created_at: a.created_at,
    finished_at: a.finished_at,
    challenge: ch ? { id: ch.id, title: ch.title, author: userBrief(ch.author_id) } : null,
    test: testBrief(a.test_id),
    node: node ? { id: node.id, name: node.name, college: college(node.college_id), owner: userBrief(node.owner_id) } : null,
    user: userBrief(a.user_id),
    proof: a.payload
      ? {
          payload: a.payload,
          sig: a.sig,
          examiner_id: a.examiner_id,
          examiner_kind: a.examiner_kind,
          examiner_pubkey: a.examiner_pubkey,
          fingerprint: fingerprint(a.examiner_pubkey),
          measured: parseJson<{ measured?: unknown }>(a.payload, {}).measured ?? null,
          target: parseJson<{ target?: string }>(a.payload, {}).target ?? null,
        }
      : null,
    ...(opts.log ? { log: a.log } : {}),
    ...(opts.code ? { code: a.code } : {}),
  };
}

export function connectionView(c: ConnectionRow) {
  const ch = c.challenge_id ? one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', c.challenge_id) : null;
  const node = c.node_id ? one<NodeRow>('SELECT * FROM nodes WHERE id = ?', c.node_id) : null;
  const att = c.attempt_id ? one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', c.attempt_id) : null;
  const followUps =
    c.type === 'proved_for'
      ? all<{ type: string; note: string | null; created_at: number }>(
          'SELECT type, note, created_at FROM connections WHERE parent_id = ? ORDER BY created_at',
          c.id,
        )
      : [];
  return {
    id: c.id,
    type: c.type,
    created_at: c.created_at,
    note: c.note,
    parent_id: c.parent_id,
    from: userBrief(c.from_id),
    to: userBrief(c.to_id),
    challenge: ch ? { id: ch.id, title: ch.title, test: testBrief(ch.test_id) } : null,
    node: node ? { id: node.id, name: node.name, college: college(node.college_id) } : null,
    proof: att
      ? { attempt_id: att.id, examiner_id: att.examiner_id, examiner_kind: att.examiner_kind, at: att.finished_at, test: testBrief(att.test_id) }
      : null,
    follow_ups: followUps,
  };
}

export function claimsOf(u: UserRow) {
  return parseJson<string[]>(u.claims, []);
}
