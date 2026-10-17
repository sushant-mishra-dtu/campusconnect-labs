// Fixed-window request limits per client IP, kept in memory. Enough to stop a script from
// hammering sign-in, bookings or attempts on this single-process server.
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './util.js';

export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const t = Date.now();
    if (hits.size > 10_000) for (const [k, h] of hits) if (h.reset <= t) hits.delete(k);
    const key = req.ip ?? 'unknown';
    let h = hits.get(key);
    if (!h || h.reset <= t) {
      h = { n: 0, reset: t + windowMs };
      hits.set(key, h);
    }
    if (++h.n > max) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
    next();
  };
}
