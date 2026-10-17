// One WebSocket per tab. Pages subscribe to the events they care about.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getToken } from './api';
import { useAuth } from './auth';

export type LiveMessage =
  | { type: 'nodes' }
  | { type: 'network' }
  | { type: 'notification'; notification: { id: string; body: string; link: string | null; created_at: number } }
  | { type: 'attempt'; attempt: import('./api').Attempt }
  | { type: 'log'; attempt: string; line: string };

type Handler = (m: LiveMessage) => void;

interface LiveState {
  connected: boolean;
  subscribe: (h: Handler) => () => void;
  watch: (attemptId: string) => void;
}

const LiveContext = createContext<LiveState | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Set<Handler>());
  const watched = useRef(new Set<string>());
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const token = getToken();
      const ws = new WebSocket(`${proto}://${location.host}/ws/client${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        for (const id of watched.current) ws.send(JSON.stringify({ type: 'watch', attempt: id }));
      };
      ws.onmessage = (ev) => {
        let msg: LiveMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        for (const h of handlers.current) h(msg);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
    // reconnect when the signed-in user changes so the server knows who we are
  }, [me?.id]);

  const subscribe = useCallback((h: Handler) => {
    handlers.current.add(h);
    return () => {
      handlers.current.delete(h);
    };
  }, []);

  const watch = useCallback((attemptId: string) => {
    watched.current.add(attemptId);
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'watch', attempt: attemptId }));
    }
  }, []);

  return <LiveContext.Provider value={{ connected, subscribe, watch }}>{children}</LiveContext.Provider>;
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive outside LiveProvider');
  return ctx;
}

// Re-run `fn` whenever one of the given event types arrives.
export function useLiveRefresh(types: LiveMessage['type'][], fn: () => void) {
  const { subscribe } = useLive();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const key = types.join(',');
  useEffect(
    () =>
      subscribe((m) => {
        if (key.split(',').includes(m.type)) fnRef.current();
      }),
    [subscribe, key],
  );
}
