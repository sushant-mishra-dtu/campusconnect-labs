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
  const { email: _email, ...rest } = u;
  return { ...rest, claims: JSON.parse(u.claims) as string[] };
}
