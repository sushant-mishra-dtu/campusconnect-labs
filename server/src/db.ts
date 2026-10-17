import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { DB_PATH } from './paths.js';
import { keyHash } from './util.js';

export { DB_PATH };

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
// Every log line and stage a lab node sends is its own commit. With the default synchronous=FULL
// each one waits for the disk: 147 ms on the demo server's hard drive, which put the console seconds
// behind the node. NORMAL is SQLite's advice for WAL: a power cut can lose the last few commits
// but never corrupts the database.
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

// A connection only exists when something happened: a challenge passed, a board
// lent, a referral or mentorship given. There is no "follow" edge on purpose.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS colleges (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  city      TEXT NOT NULL,
  has_lab   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('student','alum','recruiter','founder','club')),
  headline    TEXT NOT NULL DEFAULT '',
  college_id  TEXT REFERENCES colleges(id),
  org         TEXT,
  claims      TEXT NOT NULL DEFAULT '[]',
  hue         INTEGER NOT NULL DEFAULT 200,
  password_hash TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  slug  TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  area  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  org          TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES users(id),
  skills       TEXT NOT NULL,
  description  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  test_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL REFERENCES users(id),
  role_id     TEXT REFERENCES roles(id),
  title       TEXT NOT NULL,
  offer_type  TEXT NOT NULL CHECK (offer_type IN ('referral','mentorship','internship','interview')),
  offer       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  college_id       TEXT NOT NULL REFERENCES colleges(id),
  owner_id         TEXT NOT NULL REFERENCES users(id),
  board            TEXT NOT NULL,
  token_hash       TEXT NOT NULL,
  examiner_id      TEXT,
  examiner_kind    TEXT,
  examiner_pubkey  TEXT,
  last_counter     INTEGER NOT NULL DEFAULT -1,
  last_seen        INTEGER,
  pin_open_until   INTEGER,
  created_at       INTEGER NOT NULL
);

-- Examiner keys the operator enrolled, out of band, as ESP32s holding their key on-chip.
-- Only these produce "Verified on silicon"; what a node says about itself doesn't count.
CREATE TABLE IF NOT EXISTS silicon_examiners (
  key_sha256   TEXT NOT NULL,
  node_id      TEXT NOT NULL REFERENCES nodes(id),
  note         TEXT,
  enrolled_at  INTEGER NOT NULL,
  PRIMARY KEY (node_id, key_sha256)
);

CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL REFERENCES nodes(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  cancelled   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  challenge_id     TEXT NOT NULL REFERENCES challenges(id),
  test_id          TEXT NOT NULL,
  node_id          TEXT NOT NULL REFERENCES nodes(id),
  booking_id       TEXT NOT NULL REFERENCES bookings(id),
  code             TEXT NOT NULL,
  nonce            TEXT NOT NULL,
  status           TEXT NOT NULL,
  stage            TEXT,
  log              TEXT NOT NULL DEFAULT '',
  payload          TEXT,
  sig              TEXT,
  result           TEXT,
  verified         INTEGER NOT NULL DEFAULT 0,
  reject_reason    TEXT,
  examiner_id      TEXT,
  examiner_kind    TEXT,
  examiner_pubkey  TEXT,
  created_at       INTEGER NOT NULL,
  finished_at      INTEGER
);

CREATE TABLE IF NOT EXISTS badges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  test_id     TEXT NOT NULL,
  attempt_id  TEXT NOT NULL REFERENCES attempts(id),
  kind        TEXT NOT NULL,
  issued_at   INTEGER NOT NULL,
  UNIQUE (user_id, test_id)
);

CREATE TABLE IF NOT EXISTS connections (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL REFERENCES users(id),
  to_id         TEXT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL CHECK (type IN ('proved_for','lent_board','referred','mentored')),
  attempt_id    TEXT REFERENCES attempts(id),
  challenge_id  TEXT REFERENCES challenges(id),
  node_id       TEXT REFERENCES nodes(id),
  parent_id     TEXT REFERENCES connections(id),
  note          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  link        TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_node ON bookings(node_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connections_from ON connections(from_id);
CREATE INDEX IF NOT EXISTS idx_connections_to ON connections(to_id);
`;

db.exec(SCHEMA);

// Databases created before a column existed get it added in place.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}
ensureColumn('users', 'password_hash', 'TEXT');
if (ensureColumn('users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0')) {
  db.exec("UPDATE users SET is_demo = 1 WHERE email LIKE '%@demo.ccl'");
}
ensureColumn('nodes', 'pin_open_until', 'INTEGER');

// One proof edge per student, author and challenge: passing again doesn't re-notify.
// Older databases may hold repeats; drop the later ones nobody has acted on.
db.exec(`
DELETE FROM connections WHERE type = 'proved_for'
  AND NOT EXISTS (SELECT 1 FROM connections f WHERE f.parent_id = connections.id)
  AND EXISTS (SELECT 1 FROM connections o WHERE o.type = 'proved_for' AND o.from_id = connections.from_id
              AND o.to_id = connections.to_id AND o.challenge_id IS connections.challenge_id AND o.rowid < connections.rowid);
`);
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_proved_for ON connections(from_id, to_id, challenge_id) WHERE type = 'proved_for'");
} catch {
  console.warn('[db] repeated proof connections with follow-ups exist; re-seed to enforce one per challenge');
}

// "esp32" only ever comes from an enrollment. Downgrade anything that claimed it without one
// (nodes used to self-declare it), including the proofs and badges it produced.
export function enforceEnrollment() {
  const claimed = db.prepare(
    `SELECT node_id, examiner_pubkey FROM attempts WHERE examiner_kind = 'esp32'
     UNION SELECT id, examiner_pubkey FROM nodes WHERE examiner_kind = 'esp32'`,
  ).all() as { node_id: string; examiner_pubkey: string | null }[];
  for (const c of claimed) {
    const ok = c.examiner_pubkey && db.prepare('SELECT 1 FROM silicon_examiners WHERE node_id = ? AND key_sha256 = ?')
      .get(c.node_id, keyHash(c.examiner_pubkey));
    if (ok) continue;
    db.prepare("UPDATE nodes SET examiner_kind = 'sim' WHERE id = ? AND examiner_kind = 'esp32' AND examiner_pubkey IS ?")
      .run(c.node_id, c.examiner_pubkey);
    db.prepare("UPDATE attempts SET examiner_kind = 'sim' WHERE node_id = ? AND examiner_kind = 'esp32' AND examiner_pubkey IS ?")
      .run(c.node_id, c.examiner_pubkey);
  }
  db.exec(`UPDATE badges SET kind = 'sim' WHERE kind = 'esp32'
           AND attempt_id IN (SELECT id FROM attempts WHERE examiner_kind = 'sim')`);
}
enforceEnrollment();

const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
function stmt(sql: string) {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return stmt(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return stmt(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return stmt(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'alum' | 'recruiter' | 'founder' | 'club';
  headline: string;
  college_id: string | null;
  org: string | null;
  claims: string;
  hue: number;
  password_hash: string | null;
  is_demo: number;
  created_at: number;
}

export interface NodeRow {
  id: string;
  name: string;
  college_id: string;
  owner_id: string;
  board: string;
  token_hash: string;
  examiner_id: string | null;
  examiner_kind: string | null;
  examiner_pubkey: string | null;
  last_counter: number;
  last_seen: number | null;
  pin_open_until: number | null;
  created_at: number;
}

export interface BookingRow {
  id: string;
  node_id: string;
  user_id: string;
  starts_at: number;
  ends_at: number;
  cancelled: number;
  created_at: number;
}

export interface ChallengeRow {
  id: string;
  test_id: string;
  author_id: string;
  role_id: string | null;
  title: string;
  offer_type: string;
  offer: string;
  created_at: number;
}

export interface AttemptRow {
  id: string;
  user_id: string;
  challenge_id: string;
  test_id: string;
  node_id: string;
  booking_id: string;
  code: string;
  nonce: string;
  status: string;
  stage: string | null;
  log: string;
  payload: string | null;
  sig: string | null;
  result: string | null;
  verified: number;
  reject_reason: string | null;
  examiner_id: string | null;
  examiner_kind: string | null;
  examiner_pubkey: string | null;
  created_at: number;
  finished_at: number | null;
}

export interface ConnectionRow {
  id: string;
  from_id: string;
  to_id: string;
  type: 'proved_for' | 'lent_board' | 'referred' | 'mentored';
  attempt_id: string | null;
  challenge_id: string | null;
  node_id: string | null;
  parent_id: string | null;
  note: string | null;
  created_at: number;
}
