import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.CCL_DB ?? path.join(here, '..', 'data', 'ccl.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

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
  created_at       INTEGER NOT NULL
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
