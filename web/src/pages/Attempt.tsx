import CodeMirror from '@uiw/react-codemirror';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Attempt as AttemptT, type Booking, type ChallengeDetail, type LabNode } from '../api';
import { useAuth } from '../auth';
import { Console } from '../components/Console';
import { Pipeline } from '../components/Pipeline';
import {
  Button,
  CheckIcon,
  ErrorNote,
  KindBadge,
  Loading,
  OfferTag,
  Spinner,
  StatusDot,
  cx,
  fmtTime,
} from '../components/ui';
import { useApi, useNow } from '../hooks';
import { renderMarkdown } from '../lib/markdown';
import { verilogLanguage } from '../lib/verilog';
import { useLive, useLiveRefresh } from '../live';

type MyBooking = Booking & { node: LabNode };

function draftKey(id: string) {
  return `crtl.draft.${id}`;
}

function loadDraft(id: string) {
  try {
    return localStorage.getItem(draftKey(id));
  } catch {
    return null;
  }
}

function saveDraft(id: string, code: string) {
  try {
    localStorage.setItem(draftKey(id), code);
  } catch {
    // not persisted in private mode
  }
}

function Measured({ m }: { m: Record<string, unknown> | null | undefined }) {
  if (!m) return null;
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12.5px]">
      {Object.entries(m).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-trace">{k}</dt>
          <dd className="text-white">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Verdict({ a }: { a: AttemptT }) {
  if (a.status === 'verified' && a.result === 'pass') {
    return (
      <div className="rounded-lg border border-proof-bright/40 bg-proof/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-lg font-semibold text-proof-bright">
            <CheckIcon className="h-5 w-5" /> PASS · verified
          </div>
          {a.proof && <KindBadge kind={a.proof.examiner_kind} compact />}
        </div>
        <Measured m={a.proof?.measured} />
        <div className="mt-4 space-y-1 text-sm text-white/90">
          <div>
            Badge issued for <span className="font-medium">{a.test.title}</span>.
          </div>
          {a.challenge && (
            <div>
              You’re now connected to <span className="font-medium">{a.challenge.author.name}</span> with this proof attached.
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={`/proof/${a.id}`} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-ink">
            View signed proof
          </Link>
          <Link to={`/u/${a.user.id}`} className="rounded-md border border-white/25 px-3 py-1.5 text-sm text-white hover:bg-white/10">
            My profile
          </Link>
        </div>
      </div>
    );
  }
  if (a.status === 'verified') {
    return (
      <div className="rounded-lg border border-[#f2c76e]/40 bg-[#f2c76e]/10 p-4">
        <div className="text-lg font-semibold text-[#f2c76e]">FAIL · signed by the examiner</div>
        <Measured m={a.proof?.measured} />
        <div className="mt-3 text-sm text-white/80">The verdict is genuine, the design isn’t there yet. Fix it and try again. Each attempt gets a new nonce.</div>
        <Link to={`/proof/${a.id}`} className="mt-3 inline-block text-sm text-white underline">
          View signed verdict
        </Link>
      </div>
    );
  }
  if (a.status === 'rejected') {
    return (
      <div className="rounded-lg border border-fail/50 bg-fail/15 p-4">
        <div className="text-lg font-semibold text-[#ff8f7a]">Verdict rejected by the platform</div>
        <div className="mt-1 text-sm text-white/80">{a.reject_reason}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-fail/50 bg-fail/15 p-4">
      <div className="text-lg font-semibold text-[#ff8f7a]">Didn’t reach the examiner</div>
      <div className="mt-1 text-sm text-white/80">{a.reject_reason}. The console has the details.</div>
    </div>
  );
}

export function Attempt() {
  const { id } = useParams();
  const { me, refresh } = useAuth();
  const { subscribe, watch } = useLive();
  const now = useNow(5_000);

  const { data: ch, error } = useApi<ChallengeDetail>(`/challenges/${id}`);
  const nodes = useApi<LabNode[]>('/nodes');
  const bookings = useApi<MyBooking[]>('/bookings/mine');
  useLiveRefresh(['nodes'], () => {
    void nodes.reload();
    void bookings.reload();
  });

  const [code, setCode] = useState<string | null>(null);
  const [tab, setTab] = useState<'code' | 'spec'>('code');
  const [nodeId, setNodeId] = useState<string>('');
  const [attempt, setAttempt] = useState<AttemptT | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<'book' | 'submit' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (ch && code === null) setCode(loadDraft(ch.id) ?? ch.starter);
  }, [ch, code]);

  // Pick a sensible board: one I've booked right now, else the first online one.
  useEffect(() => {
    if (nodeId || !nodes.data) return;
    const live = bookings.data?.find((b) => b.starts_at <= Date.now() && b.ends_at > Date.now());
    setNodeId(live?.node_id ?? nodes.data.find((n) => n.online)?.id ?? nodes.data[0]?.id ?? '');
  }, [nodes.data, bookings.data, nodeId]);

  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === 'attempt' && attempt && m.attempt.id === attempt.id) {
          setAttempt((prev) => ({ ...prev, ...m.attempt }));
          if (m.attempt.log !== undefined) setLines(m.attempt.log.split('\n').filter(Boolean));
          if (m.attempt.status === 'verified' && m.attempt.result === 'pass') void refresh();
        }
        if (m.type === 'log' && attempt && m.attempt === attempt.id) setLines((prev) => [...prev, m.line]);
      }),
    [subscribe, attempt, refresh],
  );

  const html = useMemo(() => (ch ? renderMarkdown(ch.spec) : ''), [ch]);

  const node = nodes.data?.find((n) => n.id === nodeId);
  // Only an enrolled ESP32 examiner has a physical board behind it; every other node simulates one.
  const simulated = node?.examiner?.kind !== 'esp32';
  const booking = bookings.data?.find((b) => b.node_id === nodeId && b.starts_at <= now && b.ends_at > now);
  const running = attempt && ['queued', 'running'].includes(attempt.status);

  const onChange = useCallback(
    (v: string) => {
      setCode(v);
      if (ch) saveDraft(ch.id, v);
    },
    [ch],
  );

  const book = async () => {
    setBusy('book');
    setActionError(null);
    try {
      await api('/bookings', { body: { node_id: nodeId, minutes: 30 } });
      await bookings.reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!ch || !code) return;
    setBusy('submit');
    setActionError(null);
    try {
      const a = await api<AttemptT>('/attempts', { body: { challenge_id: ch.id, node_id: nodeId, code } });
      setAttempt(a);
      setLines((a.log ?? '').split('\n').filter(Boolean));
      watch(a.id);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!ch || code === null) return <Loading />;

  const minutesLeft = booking ? Math.max(0, Math.round((booking.ends_at - now) / 60_000)) : 0;

  return (
    <div className="-mt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/challenges/${ch.id}`} className="text-sm text-muted hover:text-ink">
            ← {ch.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{ch.test.title}</h1>
            <OfferTag type={ch.offer_type} />
            <span className="text-sm text-muted">from {ch.author.name}</span>
          </div>
        </div>
        {me?.badges.some((b) => b.test_id === ch.test.id) && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-proof">
            <CheckIcon className="h-4 w-4" /> You hold this badge
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* editor */}
        <div className="flex h-[560px] flex-col overflow-hidden rounded-xl border border-line bg-card lg:h-[calc(100vh-9.5rem)] lg:min-h-[560px]">
          <div className="flex items-center gap-1 border-b border-line px-2">
            {(['code', 'spec'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cx('-mb-px border-b-2 px-3 py-2.5 text-sm', tab === t ? 'border-ink font-medium' : 'border-transparent text-muted hover:text-ink')}
              >
                {t === 'code' ? <span className="font-mono">top.v</span> : 'Spec'}
              </button>
            ))}
            <div className="ml-auto pr-1">
              {tab === 'code' && (
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm('Replace your code with the starter template?')) onChange(ch.starter);
                  }}
                >
                  Reset to starter
                </Button>
              )}
            </div>
          </div>
          {tab === 'code' ? (
            <CodeMirror
              value={code}
              onChange={onChange}
              extensions={[verilogLanguage]}
              theme="dark"
              height="100%"
              className="flex-1 text-[13px] [&_.cm-editor]:h-full [&>div]:h-full"
              basicSetup={{ foldGutter: false, highlightActiveLine: true }}
            />
          ) : (
            <div className="prose-spec flex-1 overflow-y-auto p-6" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>

        {/* board + console */}
        <div className="flex min-h-[560px] flex-col overflow-hidden rounded-xl bg-board text-white lg:h-[calc(100vh-9.5rem)]">
          <div className="border-b border-white/10 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Lab node</span>
                <select
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  disabled={!!running}
                  className="h-9 w-full rounded-md border border-white/15 bg-board-2 px-2 text-sm text-white"
                >
                  {nodes.data?.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.online ? '● ' : '○ '}
                      {n.name} · {n.college.name}
                    </option>
                  ))}
                </select>
              </label>
              {node && (
                <span className="flex items-center gap-1.5 text-xs text-trace">
                  <StatusDot online={node.online} /> {node.online ? 'online' : 'offline'}
                </span>
              )}
            </div>
            {node && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-trace">
                <span>{node.board}</span>
                {node.examiner && (
                  <span>
                    examiner {node.examiner.id} · {node.examiner.fingerprint}
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {booking ? (
                <span className="text-sm text-white/85">
                  Booked {fmtTime(booking.starts_at)}–{fmtTime(booking.ends_at)} · <span className="font-mono">{minutesLeft} min</span> left
                </span>
              ) : (
                <Button kind="secondary" size="sm" onClick={book} disabled={busy !== null || !node} className="border-white/25 bg-transparent text-white hover:border-white">
                  {busy === 'book' && <Spinner />} Book 30 min on this board
                </Button>
              )}
              <Button kind="proof" onClick={submit} disabled={!booking || !node?.online || busy !== null || !!running} className="ml-auto">
                {(busy === 'submit' || running) && <Spinner />}
                {simulated ? (running ? 'Simulating on the lab node…' : 'Build & simulate') : running ? 'Running on the board…' : 'Build, flash & examine'}
              </Button>
            </div>
            {!booking && <div className="mt-2 text-xs text-trace">The platform only sends code to a board you have a live booking on.</div>}
            {booking && node && !node.online && <div className="mt-2 text-xs text-[#f2c76e]">This board’s lab node is offline. Ask the club to start it.</div>}
            {actionError && <div className="mt-3 rounded-md bg-fail/20 px-3 py-2 text-sm text-[#ff8f7a]">{actionError}</div>}
          </div>

          <div className="border-b border-white/10 px-4 py-3">
            <Pipeline attempt={attempt} simulated={simulated} />
          </div>

          <div className="min-h-[180px] flex-1">
            <Console lines={lines} placeholder="Console output from the platform, the lab node and the examiner shows up here." />
          </div>

          {attempt && !running && (
            <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-white/10 p-4">
              <Verdict a={attempt} />
            </div>
          )}
          {attempt && (
            <div className="border-t border-white/10 px-4 py-2 font-mono text-[11px] text-trace/80">
              attempt {attempt.id} · nonce {attempt.nonce}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
