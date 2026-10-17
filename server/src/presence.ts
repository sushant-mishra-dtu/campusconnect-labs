// Who is connected right now: lab node agents and browser tabs.
import type { WebSocket } from 'ws';
import { trace } from './flow.js';

export const nodeSockets = new Map<string, WebSocket>();
// The address each connected node dials in from, so the flow dashboard can tell a node on this
// machine from one on another.
export const nodeAddresses = new Map<string, string>();

export interface ClientState {
  userId: string | null;
  watching: Set<string>;
}
export const clients = new Map<WebSocket, ClientState>();

export function isOnline(nodeId: string) {
  return nodeSockets.has(nodeId);
}

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const typeOf = (msg: unknown) => (msg as { type?: string }).type ?? 'message';

export function broadcast(msg: unknown) {
  for (const ws of clients.keys()) send(ws, msg);
  trace('push', 'hub', 'browser', `${typeOf(msg)} refresh → all ${clients.size} tabs`);
}

export function pushToUser(userId: string, msg: unknown) {
  let tabs = 0;
  for (const [ws, st] of clients) {
    if (st.userId !== userId) continue;
    send(ws, msg);
    tabs++;
  }
  trace('push', 'hub', 'browser', `${typeOf(msg)} → ${tabs} tab${tabs === 1 ? '' : 's'} of the recipient`);
}

export function pushToWatchers(attemptId: string, msg: unknown) {
  let tabs = 0;
  for (const [ws, st] of clients) {
    if (!st.watching.has(attemptId)) continue;
    send(ws, msg);
    tabs++;
  }
  // Log lines are traced where they arrive from the node; only status changes are traced here
  if (tabs && typeOf(msg) === 'attempt') trace('push', 'hub', 'browser', `attempt ${attemptId} update → ${tabs} watching tab${tabs === 1 ? '' : 's'}`, { attempt: attemptId });
}
