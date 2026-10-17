// Who is connected right now: lab node agents and browser tabs.
import type { WebSocket } from 'ws';

export const nodeSockets = new Map<string, WebSocket>();

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

export function broadcast(msg: unknown) {
  for (const ws of clients.keys()) send(ws, msg);
}

export function pushToUser(userId: string, msg: unknown) {
  for (const [ws, st] of clients) if (st.userId === userId) send(ws, msg);
}

export function pushToWatchers(attemptId: string, msg: unknown) {
  for (const [ws, st] of clients) if (st.watching.has(attemptId)) send(ws, msg);
}
