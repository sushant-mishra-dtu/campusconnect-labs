// A live trace of what moves through the platform, for the flow dashboard at /flow: HTTP
// requests, database reads and writes, socket traffic with lab nodes and browser tabs, verdict
// checks and pushes. The last 500 events stay in memory. Events carry ids, names and stages,
// never tokens, passwords or student code. Off unless CRTL_FLOW_DASHBOARD=1.
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';

export const FLOW_ENABLED = process.env.CRTL_FLOW_DASHBOARD === '1';

export type FlowKind = 'http' | 'db' | 'socket' | 'job' | 'stage' | 'log' | 'verdict' | 'check' | 'push' | 'error';

// Participants are 'browser', 'api', 'hub', 'db', 'verify' and 'node:<id>'.
export interface FlowEvent {
  id: number;
  t: number;
  kind: FlowKind;
  from: string;
  to: string;
  label: string;
  attempt?: string;
  ok?: boolean;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);
const recent: FlowEvent[] = [];
let seq = 0;

export function trace(kind: FlowKind, from: string, to: string, label: string, extra: { attempt?: string; ok?: boolean } = {}) {
  if (!FLOW_ENABLED) return;
  const e: FlowEvent = { id: ++seq, t: Date.now(), kind, from, to, label: label.slice(0, 240), ...extra };
  recent.push(e);
  if (recent.length > 500) recent.shift();
  bus.emit('event', e);
}

export function onTrace(fn: (e: FlowEvent) => void) {
  bus.on('event', fn);
  return () => {
    bus.off('event', fn);
  };
}

export function recentTrace() {
  return recent.slice();
}

// Every API request becomes three events: the request arriving, the database read or write it
// caused, and the response leaving.
export function traceHttp(req: Request, res: Response, next: NextFunction) {
  if (!FLOW_ENABLED || !req.path.startsWith('/api/') || req.path.startsWith('/api/flow') || req.path === '/api/health') return next();
  const t0 = Date.now();
  const who = req.user ? ` · ${req.user.name}` : '';
  trace('http', 'browser', 'api', `${req.method} ${req.path}${who}`);
  res.on('finish', () => {
    const ok = res.statusCode < 400;
    if (ok) trace('db', 'api', 'db', `${req.method === 'GET' ? 'read' : 'write'} · ${req.method} ${req.path}`);
    trace('http', 'api', 'browser', `${res.statusCode} ${req.method} ${req.path} in ${Date.now() - t0} ms`, ok ? {} : { ok });
  });
  next();
}
