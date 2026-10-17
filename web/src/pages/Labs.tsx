import { useMemo, useState, type FormEvent } from 'react';
import { api, type Booking, type LabNode } from '../api';
import { useAuth } from '../auth';
import { Timeline } from '../components/Timeline';
import {
  Button,
  Card,
  ChipIcon,
  ErrorNote,
  KindBadge,
  Loading,
  PersonLink,
  Spinner,
  StatusDot,
  Tag,
  fmtTime,
  timeAgo,
} from '../components/ui';
import { useApi, useNow } from '../hooks';
import { useLiveRefresh } from '../live';

const SLOT = 15 * 60_000;

function freeStarts(bookings: Booking[], now: number, minutes: number) {
  const out: number[] = [];
  const first = Math.ceil(now / SLOT) * SLOT;
  const candidates = [Math.floor(now / 60_000) * 60_000, ...Array.from({ length: 40 }, (_, i) => first + i * SLOT)];
  for (const s of candidates) {
    const e = s + minutes * 60_000;
    if (!bookings.some((b) => b.starts_at < e && b.ends_at > s)) out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

function NodeCard({ node, now, onChange }: { node: LabNode; now: number; onChange: () => void }) {
  const { me } = useAuth();
  const [minutes, setMinutes] = useState(30);
  const [start, setStart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const starts = useMemo(() => freeStarts(node.bookings, now, minutes), [node.bookings, now, minutes]);
  const chosen = start !== null && starts.includes(start) ? start : starts[0];
  const mine = node.bookings.filter((b) => b.user.id === me?.id && b.ends_at > now);

  const book = async () => {
    if (chosen === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await api('/bookings', { body: { node_id: node.id, minutes, starts_at: chosen } });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    await api(`/bookings/${id}`, { method: 'DELETE' }).catch(() => {});
    onChange();
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot online={node.online} />
            <h3 className="font-semibold">{node.name}</h3>
            <span className="font-mono text-xs text-muted">{node.id}</span>
          </div>
          <div className="mt-0.5 text-sm text-ink-2">
            {node.college.name}, {node.college.city}
          </div>
        </div>
        <div className="text-right text-xs text-muted">
          {node.online ? <span className="font-medium text-proof">online now</span> : node.last_seen ? `last seen ${timeAgo(node.last_seen, now)}` : 'never connected'}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2 text-ink-2">
            <ChipIcon className="h-4 w-4 text-muted" /> {node.board}
          </div>
          {node.examiner ? (
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={node.examiner.kind} />
              <span className="font-mono text-xs text-muted">
                {node.examiner.id} · key {node.examiner.fingerprint} · counter {node.examiner.counter}
              </span>
            </div>
          ) : (
            <div className="text-xs text-muted">Examiner key not pinned yet. It is pinned the first time the lab node connects.</div>
          )}
        </div>
        <div className="flex gap-5 sm:text-right">
          <div>
            <div className="font-mono text-lg">{node.served}</div>
            <div className="text-xs text-muted">students proven</div>
          </div>
          <div>
            <div className="font-mono text-lg">{node.runs}</div>
            <div className="text-xs text-muted">runs</div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Timeline bookings={node.bookings} now={now} myId={me?.id} />
      </div>

      {mine.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {mine.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg bg-proof-soft px-3 py-2 text-sm">
              <span>
                Your slot: <span className="font-medium">{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)} IST</span>
                {b.starts_at <= now && <Tag tone="proof" className="ml-2">live</Tag>}
              </span>
              <Button kind="danger" size="sm" onClick={() => cancel(b.id)}>
                Cancel
              </Button>
            </div>
          ))}
        </div>
      )}

      {me && me.id !== node.owner.id && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <label className="text-xs text-muted">
            Start
            <select
              value={chosen ?? ''}
              onChange={(e) => setStart(Number(e.target.value))}
              className="mt-1 block h-9 rounded-lg border border-line-2 bg-card px-2 text-sm text-ink"
            >
              {starts.map((s, i) => (
                <option key={s} value={s}>
                  {i === 0 && s <= now ? 'Now' : `${fmtTime(s)} IST`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Length
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="mt-1 block h-9 rounded-lg border border-line-2 bg-card px-2 text-sm text-ink">
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </label>
          <Button size="sm" className="h-9" onClick={book} disabled={busy || chosen === undefined}>
            {busy && <Spinner />} Book this board
          </Button>
          <div className="ml-auto">
            <PersonLink user={node.owner} size={28} />
          </div>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}

function LendBoard({ onDone }: { onDone: () => void }) {
  const { me } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ node: LabNode; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api('/nodes', { body: { name } }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Lend a board</h2>
      <p className="mt-1 text-sm text-ink-2">
        Register an idle iCE40 board wired to an ESP32-S3 examiner. Students at colleges without a lab book it by the slot. Every pass on it links {me?.org ?? 'your club'} to the student.
      </p>
      {result ? (
        <div className="mt-4 space-y-3 text-sm">
          <div>
            Registered <span className="font-mono">{result.node.id}</span>. Run the lab node agent on the machine next to the board. This token is shown once:
          </div>
          <pre className="overflow-x-auto rounded-lg bg-board p-3 font-mono text-xs text-[#d8e6dd]">
            {`npm run labnode -- --node=${result.node.id} --token=${result.token} --mode=hw --serial=COM5`}
          </pre>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bench name, e.g. Electronics lab bench 3" className="h-10 min-w-0 flex-1 rounded-lg border border-line-2 bg-card px-3 text-sm" />
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />} Register board
          </Button>
        </form>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}

export function Labs() {
  const { me } = useAuth();
  const now = useNow(10_000);
  const { data, error, loading, reload } = useApi<LabNode[]>('/nodes');
  useLiveRefresh(['nodes'], () => void reload());

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Lab nodes</h1>
      <p className="mt-1 max-w-3xl text-ink-2">
        Colleges and clubs lend idle FPGA boards as remote lab nodes. Book a slot, write Verilog in the browser, and it runs on that board, wherever it is.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {loading && <Loading />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {data?.map((n) => (
          <NodeCard key={n.id} node={n} now={now} onChange={() => void reload()} />
        ))}
        {me?.role === 'club' && <LendBoard onDone={() => void reload()} />}
      </div>
    </div>
  );
}
