// Thin client for the platform API, plus the shapes it returns.

export type Role = 'student' | 'alum' | 'recruiter' | 'founder' | 'club';

export interface College {
  id: string;
  name: string;
  city: string;
  has_lab: boolean;
}

export interface UserBrief {
  id: string;
  name: string;
  role: Role;
  headline: string;
  org: string | null;
  hue: number;
  college: College | null;
}

export interface TestBrief {
  id: string;
  title: string;
  summary: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  skills: string[];
}

export interface Badge {
  id: string;
  test_id: string;
  attempt_id: string;
  kind: 'sim' | 'esp32';
  issued_at: number;
  node_id: string;
  examiner_id: string;
  test: TestBrief;
}

export interface Me extends UserBrief {
  claims: string[];
  verified_skills: string[];
  badges: Badge[];
}

export type OfferType = 'referral' | 'mentorship' | 'internship' | 'interview';

export interface Challenge {
  id: string;
  title: string;
  offer_type: OfferType;
  offer: string;
  created_at: number;
  test: TestBrief;
  author: UserBrief;
  role: { id: string; title: string; org: string } | null;
  passes: number;
  attempts: number;
  mine: { passed: boolean; last: { id: string; status: string; result: string | null } | null } | null;
}

export interface ChallengeDetail extends Challenge {
  spec: string;
  starter: string;
  passers: { attempt_id: string; at: number; user: UserBrief }[];
}

export interface Booking {
  id: string;
  node_id: string;
  user: UserBrief;
  starts_at: number;
  ends_at: number;
}

export interface LabNode {
  id: string;
  name: string;
  board: string;
  college: College;
  owner: UserBrief;
  online: boolean;
  last_seen: number | null;
  examiner: { id: string; kind: 'sim' | 'esp32'; fingerprint: string; counter: number } | null;
  bookings: Booking[];
  served: number;
  runs: number;
}

export interface Proof {
  payload: string;
  sig: string;
  examiner_id: string;
  examiner_kind: 'sim' | 'esp32';
  examiner_pubkey: string;
  fingerprint: string;
  measured: Record<string, unknown> | null;
  // what the examiner tested, as signed; null on proofs from before targets were signed
  target: 'netlist' | 'bitstream' | 'fpga' | null;
}

export type AttemptStatus = 'queued' | 'running' | 'verified' | 'rejected' | 'error';

export interface Attempt {
  id: string;
  status: AttemptStatus;
  stage: string | null;
  result: 'pass' | 'fail' | null;
  verified: boolean;
  reject_reason: string | null;
  nonce: string;
  created_at: number;
  finished_at: number | null;
  challenge: { id: string; title: string; author: UserBrief } | null;
  test: TestBrief;
  node: { id: string; name: string; college: College; owner: UserBrief } | null;
  user: UserBrief;
  proof: Proof | null;
  log?: string;
  code?: string;
}

export type ConnectionType = 'proved_for' | 'lent_board' | 'referred' | 'mentored';

export interface Connection {
  id: string;
  type: ConnectionType;
  created_at: number;
  note: string | null;
  parent_id: string | null;
  from: UserBrief;
  to: UserBrief;
  challenge: { id: string; title: string; test: TestBrief } | null;
  node: { id: string; name: string; college: College } | null;
  proof: { attempt_id: string; examiner_id: string; examiner_kind: 'sim' | 'esp32'; at: number; test: TestBrief } | null;
  follow_ups: { type: ConnectionType; note: string | null; created_at: number }[];
}

export interface Profile extends UserBrief {
  claims: string[];
  verified_skills: string[];
  badges: Badge[];
  connections: Connection[];
  challenges: Challenge[];
  nodes: LabNode[];
}

export interface Gap {
  role: { id: string; title: string; org: string; description: string; skills: string[] };
  have: string[];
  missing: string[];
  coverage: number;
  claims: string[];
  suggestions: { covers: string[]; challenge: Challenge }[];
}

export interface Meta {
  skills: { slug: string; name: string; area: string }[];
  colleges: College[];
  tests: TestBrief[];
  roles: { id: string; title: string; org: string; skills: string[]; author: UserBrief; description: string }[];
}

export interface Notification {
  id: string;
  body: string;
  link: string | null;
  read: number;
  created_at: number;
}

export interface NetworkData {
  nodes: (UserBrief & { badges: number })[];
  edges: { id: string; source: string; target: string; type: ConnectionType; attempt_id: string | null; created_at: number }[];
}

export interface Stats {
  proofs: number;
  connections: number;
  nodes: number;
  no_lab_students: number;
}

// ------------------------------------------------------------------ client

const TOKEN_KEY = 'crtl.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the session lasts as long as the tab
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}
