import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, type Notification } from '../api';
import { useAuth } from '../auth';
import { useLive } from '../live';
import { Avatar, Logo, cx, roleLabel, timeAgo } from './ui';

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cx('rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5')
      }
    >
      {children}
    </NavLink>
  );
}

function Bell() {
  const { me } = useAuth();
  const { subscribe } = useLive();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notification | null>(null);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (me) api<Notification[]>('/notifications').then(setItems).catch(() => {});
  }, [me]);

  useEffect(load, [load]);

  useEffect(
    () =>
      subscribe((m) => {
        if (m.type !== 'notification') return;
        const n = { ...m.notification, read: 0 };
        setItems((prev) => [n, ...prev]);
        setToast(n);
      }),
    [subscribe],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = items.filter((n) => !n.read).length;

  const toggle = () => {
    setOpen((o) => !o);
    if (unread) {
      api('/notifications/read', { body: {} }).catch(() => {});
      setItems((prev) => prev.map((n) => ({ ...n, read: 1 })));
    }
  };

  const go = (n: Notification) => {
    setOpen(false);
    setToast(null);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative rounded-md p-2 text-ink-2 hover:bg-black/5" aria-label={`Notifications (${unread} unread)`}>
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="M5 8a5 5 0 0110 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8zM8.5 16.5a1.8 1.8 0 003 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-fail px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-card shadow-lg">
          <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</div>}
            {items.map((n) => (
              <button key={n.id} onClick={() => go(n)} className="block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-paper">
                <div className="text-sm text-ink">{n.body}</div>
                <div className="mt-0.5 text-xs text-muted">{timeAgo(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {toast && (
        <button
          onClick={() => go(toast)}
          className="fixed right-4 bottom-4 z-40 flex max-w-sm items-start gap-3 rounded-xl border border-proof/30 bg-card p-4 text-left shadow-xl"
        >
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-proof-bright" />
          <span className="text-sm">{toast.body}</span>
        </button>
      )}
    </div>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const { connected } = useLive();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="shrink-0">
            <Logo />
          </Link>
          {me && (
            <nav className="hidden items-center gap-1 md:flex">
              <NavItem to="/">Home</NavItem>
              <NavItem to="/challenges">Challenges</NavItem>
              <NavItem to="/labs">Labs</NavItem>
              <NavItem to="/network">Network</NavItem>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span
              className={cx('mr-2 hidden items-center gap-1.5 text-xs sm:flex', connected ? 'text-proof' : 'text-muted')}
              title={connected ? 'Live updates connected' : 'Reconnecting…'}
            >
              <span className={cx('h-1.5 w-1.5 rounded-full', connected ? 'bg-proof-bright' : 'bg-line-2')} />
              {connected ? 'live' : 'offline'}
            </span>
            {me ? (
              <>
                <Bell />
                <div className="relative">
                  <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-black/5">
                    <Avatar user={me} size={28} />
                    <span className="hidden text-left sm:block">
                      <span className="block text-sm leading-tight font-medium">{me.name}</span>
                      <span className="block text-[11px] leading-tight text-muted">{roleLabel(me.role)}</span>
                    </span>
                  </button>
                  {menu && (
                    <div className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                      <Link to={`/u/${me.id}`} onClick={() => setMenu(false)} className="block px-4 py-2 text-sm hover:bg-paper">
                        My profile
                      </Link>
                      <div className="border-t border-line md:hidden">
                        {[
                          ['/challenges', 'Challenges'],
                          ['/labs', 'Labs'],
                          ['/network', 'Network'],
                        ].map(([to, label]) => (
                          <Link key={to} to={to} onClick={() => setMenu(false)} className="block px-4 py-2 text-sm hover:bg-paper">
                            {label}
                          </Link>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          setMenu(false);
                          logout();
                          navigate('/login');
                        }}
                        className="block w-full border-t border-line px-4 py-2 text-left text-sm hover:bg-paper"
                      >
                        Switch person
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <Link to="/login" className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white">
                Try the demo
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20">
        <Outlet />
      </main>
    </div>
  );
}
