import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { one, run, type UserRow } from './db.js';
import { HttpError, now } from './util.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

// Demo sign-in lets the seeded, fictional people sign in without a password so judges can
// switch personas. Real accounts always need their password. On by default for local
// runs; off when NODE_ENV=production or CRTL_DEMO_LOGIN=0.
export const DEMO_LOGIN = process.env.CRTL_DEMO_LOGIN
  ? process.env.CRTL_DEMO_LOGIN === '1'
  : process.env.NODE_ENV !== 'production';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(password: string, stored: string | null) {
  const [algo, n, salt, hash] = (stored ?? '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) {
    // same work either way, so a missing account doesn't answer faster
    crypto.scryptSync(password, 'no-account', SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return false;
  }
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(want, got);
}

export function createSession(userId: string) {
  const token = crypto.randomBytes(24).toString('base64url');
  run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, now());
  return token;
}

export function userFromToken(token: string | null | undefined): UserRow | undefined {
  if (!token) return undefined;
  return one<UserRow>(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    token,
  );
}

export function bearer(req: Request) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = userFromToken(bearer(req));
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'Sign in first');
  next();
}

export function requireRole(...roles: UserRow['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Sign in first');
    if (!roles.includes(req.user.role)) throw new HttpError(403, `Only ${roles.join(' / ')} accounts can do this`);
    next();
  };
}

export function publicUser(u: UserRow) {
  const { email: _email, password_hash: _hash, ...rest } = u;
  return { ...rest, claims: JSON.parse(u.claims) as string[] };
}
