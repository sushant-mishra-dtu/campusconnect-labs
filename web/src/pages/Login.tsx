import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role, UserBrief } from '../api';
import { useAuth } from '../auth';
import { Avatar, Button, Card, ErrorNote, Loading, Spinner } from '../components/ui';
import { useApi, useMeta } from '../hooks';

type DemoUser = UserBrief & { email: string };

const GROUPS: { title: string; blurb: string; roles: Role[] }[] = [
  { title: 'Students', blurb: 'Prove a skill on a borrowed board', roles: ['student'] },
  { title: 'Alumni, recruiters, founders', blurb: 'Post challenges, act on proofs', roles: ['alum', 'recruiter', 'founder'] },
  { title: 'Clubs lending boards', blurb: 'Run a lab node for other campuses', roles: ['club'] },
];

export function Login() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const meta = useMeta();
  const { data: users, loading } = useApi<DemoUser[]>('/auth/demo-users');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student', college_id: '', headline: '', claims: '' });
  const [creds, setCreds] = useState({ email: '', password: '' });
  // Demo sign-in is the usual case; assume it while the list loads so the heading doesn't flip.
  const demo = loading || !!users?.length;

  const pick = async (u: DemoUser) => {
    setBusy(u.id);
    setError(null);
    try {
      await login(u.email);
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('signin');
    setError(null);
    try {
      await login(creds.email, creds.password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('signup');
    setError(null);
    try {
      await signup({ ...form, claims: form.claims.split(',').map((s) => s.trim()).filter(Boolean) });
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight">{demo ? 'Pick who you are' : 'Sign in'}</h1>
      <p className="mt-2 text-ink-2">
        {demo
          ? 'Demo mode: the people below are fictional, each seeded with a history you can explore, and sign in without a password. Your own account always needs its password.'
          : 'Sign in with your email and password, or make an account.'}
      </p>
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

      {loading ? (
        <Loading />
      ) : !demo ? null : (
        <div className="mt-8 space-y-8">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-semibold">{g.title}</h2>
                <span className="text-sm text-muted">{g.blurb}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {users
                  ?.filter((u) => g.roles.includes(u.role))
                  .map((u) => (
                    <button key={u.id} onClick={() => pick(u)} disabled={!!busy} className="text-left">
                      <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:border-ink">
                        <Avatar user={u} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 font-medium">
                            {u.name} {busy === u.id && <Spinner />}
                          </div>
                          <div className="mt-0.5 text-sm text-ink-2">{u.headline}</div>
                          <div className="mt-1 text-xs text-muted">{u.org ?? u.college?.name}</div>
                        </div>
                      </Card>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Card className="mt-12 p-6">
        <h2 className="font-semibold">{demo ? 'Or sign in to your account' : 'Your account'}</h2>
        <form onSubmit={signIn} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-sm">
            <span className="text-muted">Email</span>
            <input required type="email" autoComplete="email" value={creds.email} onChange={(e) => setCreds({ ...creds, email: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Password</span>
            <input required type="password" autoComplete="current-password" value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <Button type="submit" disabled={!!busy}>
            {busy === 'signin' && <Spinner />} Sign in
          </Button>
        </form>
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="font-semibold">Create an account</h2>
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-muted">Name</span>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Email</span>
            <input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Password (8+ characters)</span>
            <input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <label className="text-sm">
            <span className="text-muted">I am a</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3">
              <option value="student">Student</option>
              <option value="alum">Alum</option>
              <option value="recruiter">Recruiter</option>
              <option value="founder">Founder</option>
              <option value="club">Club lending a board</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">College</span>
            <select value={form.college_id} onChange={(e) => setForm({ ...form, college_id: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3">
              <option value="">None</option>
              {meta?.colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">Headline</span>
            <input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} placeholder="3rd-year ECE" className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">Skills you’d normally put on a profile (comma separated). We’ll show them, struck through, until you prove them.</span>
            <input value={form.claims} onChange={(e) => setForm({ ...form, claims: e.target.value })} placeholder="Verilog, FPGA, Embedded C" className="mt-1 h-10 w-full rounded-lg border border-line-2 bg-card px-3" />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!!busy}>
              {busy === 'signup' && <Spinner />} Create account
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
