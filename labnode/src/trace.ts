// What this lab node receives, runs and sends, for its local dashboard (src/dashboard.ts). Events
// carry ids, stages and tool output; never the node token, the examiner's private key or the
// student's code. The last 500 stay in memory.
import { EventEmitter } from 'node:events';

export type NodeKind = 'socket' | 'job' | 'stage' | 'status' | 'log' | 'verdict' | 'error';

// Participants are 'platform', 'agent' and the tools in this node's pipeline (lint, yosys, ...).
export interface NodeEvent {
  id: number;
  t: number;
  kind: NodeKind;
  from: string;
  to: string;
  label: string;
  attempt?: string;
  ok?: boolean;
  ms?: number;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);
const recent: NodeEvent[] = [];
let seq = 0;

export function trace(kind: NodeKind, from: string, to: string, label: string, extra: { attempt?: string; ok?: boolean; ms?: number } = {}) {
  const e: NodeEvent = { id: ++seq, t: Date.now(), kind, from, to, label: label.slice(0, 240), ...extra };
  recent.push(e);
  if (recent.length > 500) recent.shift();
  bus.emit('event', e);
}

export function onTrace(fn: (e: NodeEvent) => void) {
  bus.on('event', fn);
  return () => {
    bus.off('event', fn);
  };
}

export function recentTrace() {
  return recent.slice();
}
