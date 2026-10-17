import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Attempt, Booking, Connection, Gap, LabNode, Profile } from '../api';
import { useAuth } from '../auth';
import { ChallengeCard } from '../components/ChallengeCard';
import { ConnectionCard } from '../components/ConnectionCard';
import {
  ArrowIcon,
  Card,
  ClaimChip,
  DifficultyTag,
  Empty,
  ErrorNote,
  KindBadge,
  Loading,
  OfferTag,
  PersonLink,
  SectionTitle,
  SkillChip,
  StatusDot,
  Tag,
  cx,
  fmtTime,
  timeAgo,
} from '../components/ui';
import { useApi, useMeta, useNow } from '../hooks';
import { useLiveRefresh } from '../live';
import { Landing } from './Landing';

type MyBooking = Booking & { node: LabNode };

function attemptTone(a: Attempt) {
  if (a.status === 'verified') return a.result === 'pass' ? 'proof' : 'claim';
  if (a.status === 'queued' || a.status === 'running') return 'wire';
  return 'fail';
}

function attemptLabel(a: Attempt) {
  if (a.status === 'verified') return a.result === 'pass' ? 'PASS' : 'FAIL';
  return a.status.toUpperCase();
}

// ------------------------------------------------------------------ student

function GapCard() {
  const meta = useMeta();
  const [roleId, setRoleId] = useState('');
  const { data: gap, error } = useApi<Gap>(`/gap${roleId ? `?role=${roleId}` : ''}`);

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold tracking-wide text-muted uppercase">Your gap</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{gap ? `${gap.role.title} · ${gap.role.org}` : 'Pick a role'}</h2>
        </div>
        <select
          value={roleId || gap?.role.id || ''}
          onChange={(e) => setRoleId(e.target.value)}
          className="h-9 rounded-lg border border-line-2 bg-card px-2 text-sm"
          aria-label="Role to compare against"
        >
          {meta?.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} · {r.org}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
      {gap && (
        <>
          <div className="mt-5 flex items-center gap-4">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper">
              <div className="h-full rounded-full bg-proof-bright transition-all" style={{ width: `${gap.coverage}%` }} />
            </div>
            <div className="font-mono text-sm">
              {gap.have.length}/{gap.role.skills.length} proven
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {gap.role.skills.map((s) => (
              <SkillChip key={s} slug={s} state={gap.have.includes(s) ? 'proven' : 'missing'} />
            ))}
          </div>
          {gap.claims.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="mr-1">On your profile but unproven:</span>
              {gap.claims.map((c) => (
                <ClaimChip key={c} text={c} />
              ))}
            </div>
          )}

          {gap.suggestions.length > 0 ? (
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">Close the gap</div>
              <div className="space-y-2">
                {gap.suggestions.map(({ challenge: c, covers }, i) => (
                  <div key={c.id} className={cx('flex flex-wrap items-center gap-4 rounded-lg border p-3', i === 0 ? 'border-proof/40 bg-proof-soft/40' : 'border-line')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.test.title}</span>
                        <OfferTag type={c.offer_type} />
                        <DifficultyTag test={c.test} />
                      </div>
                      <div className="mt-1 text-sm text-ink-2">“{c.offer}” · {c.author.name}</div>
                      <div className="mt-1.5 text-xs text-muted">covers {covers.length} missing: {covers.join(', ')}</div>
                    </div>
                    <Link
                      to={`/challenges/${c.id}/attempt`}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-ink-2"
                    >
                      Attempt <ArrowIcon className="h-4 w-4" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-proof-soft px-4 py-3 text-sm text-proof">Every skill this role asks for is proven on hardware.</div>
          )}
        </>
      )}
    </Card>
  );
}

function StudentHome() {
  const { me } = useAuth();
  const now = useNow(15_000);
  const bookings = useApi<MyBooking[]>('/bookings/mine');
  const attempts = useApi<Attempt[]>('/attempts/mine');
  useLiveRefresh(['nodes'], () => void bookings.reload());
  useLiveRefresh(['network'], () => void attempts.reload());

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-8">
        <GapCard />
        <section>
          <SectionTitle aside={<Link to="/challenges" className="text-sm text-wire hover:underline">All challenges</Link>}>Recent attempts</SectionTitle>
          {attempts.data?.length ? (
            <Card>
              <ul>
                {attempts.data.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                    <Tag tone={attemptTone(a)}>{attemptLabel(a)}</Tag>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.test.title}</div>
                      <div className="text-xs text-muted">
                        {a.node?.name} · {timeAgo(a.created_at, now)}
                      </div>
                    </div>
                    {a.proof ? (
                      <Link to={`/proof/${a.id}`} className="text-xs text-wire hover:underline">
                        proof
                      </Link>
                    ) : (
                      a.challenge && (
                        <Link to={`/challenges/${a.challenge.id}/attempt`} className="text-xs text-wire hover:underline">
                          retry
                        </Link>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Empty>No attempts yet. Pick the top suggestion above.</Empty>
          )}
        </section>
      </div>

      <div className="space-y-8">
        <section>
          <SectionTitle aside={<Link to="/labs" className="text-sm text-wire hover:underline">Book a board</Link>}>Your bookings</SectionTitle>
          {bookings.data?.length ? (
            <div className="space-y-2">
              {bookings.data.map((b) => {
                const live = b.starts_at <= now && b.ends_at > now;
                return (
                  <Card key={b.id} className={cx('p-4', live && 'border-proof/40')}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-medium">
                        <StatusDot online={b.node.online} /> {b.node.name}
                      </div>
                      {live ? <Tag tone="proof">live now</Tag> : <span className="text-xs text-muted">upcoming</span>}
                    </div>
                    <div className="mt-1 text-sm text-ink-2">
                      {b.node.college.name} · {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)} IST
                    </div>
                    {live && (
                      <div className="mt-2 text-xs text-muted">
                        {Math.round((b.ends_at - now) / 60_000)} min left. Open any challenge’s editor to run on this board.
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <Empty>
              No slots booked. <Link to="/labs" className="text-wire hover:underline">Borrow a board</Link> from a club on another campus.
            </Empty>
          )}
        </section>

        <section>
          <SectionTitle aside={me && <Link to={`/u/${me.id}`} className="text-sm text-wire hover:underline">Profile</Link>}>Your proofs</SectionTitle>
          {me?.badges.length ? (
            <div className="space-y-2">
              {me.badges.map((b) => (
                <Link key={b.id} to={`/proof/${b.attempt_id}`} className="block">
                  <Card className="flex items-center justify-between gap-3 p-4 hover:border-ink">
                    <div>
                      <div className="text-sm font-medium">{b.test.title}</div>
                      <div className="text-xs text-muted">{timeAgo(b.issued_at, now)}</div>
                    </div>
                    <KindBadge kind={b.kind} compact />
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>Your proven skills show up here, each with a signed verdict behind it.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ alum / recruiter / founder

function PosterHome() {
  const { me } = useAuth();
  const inbox = useApi<Connection[]>('/inbox');
  const profile = useApi<Profile>(me ? `/users/${me.id}` : null);
  useLiveRefresh(['network'], () => {
    void inbox.reload();
    void profile.reload();
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <SectionTitle>Proofs addressed to you</SectionTitle>
        {inbox.loading && <Loading />}
        {inbox.data?.length === 0 && <Empty>When someone passes one of your challenges, the signed proof lands here and you decide what to do with it.</Empty>}
        <div className="space-y-3">
          {inbox.data?.map((c) => (
            <ConnectionCard
              key={c.id}
              c={c}
              onActed={() => {
                void inbox.reload();
                void profile.reload();
              }}
            />
          ))}
        </div>
      </section>
      <section>
        <SectionTitle aside={<Link to="/challenges/new" className="text-sm text-wire hover:underline">Post a challenge</Link>}>Your challenges</SectionTitle>
        <div className="space-y-3">
          {profile.data?.challenges.map((c) => (
            <ChallengeCard key={c.id} c={c} />
          ))}
          {profile.data?.challenges.length === 0 && <Empty>You haven’t posted a challenge yet.</Empty>}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ club

function ClubHome() {
  const { me } = useAuth();
  const now = useNow(15_000);
  const profile = useApi<Profile>(me ? `/users/${me.id}` : null);
  useLiveRefresh(['nodes', 'network'], () => void profile.reload());
  const lent = profile.data?.connections.filter((c) => c.type === 'lent_board') ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <section>
        <SectionTitle aside={<Link to="/labs" className="text-sm text-wire hover:underline">Manage on Labs</Link>}>Your boards</SectionTitle>
        <div className="space-y-3">
          {profile.data?.nodes.map((n) => {
            const today = n.bookings.filter((b) => b.ends_at > now);
            return (
              <Card key={n.id} className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <StatusDot online={n.online} /> {n.name}
                  </div>
                  <span className="font-mono text-xs text-muted">{n.id}</span>
                </div>
                <div className="mt-1 text-sm text-ink-2">{n.board}</div>
                {n.examiner ? (
                  <div className="mt-2 font-mono text-xs text-muted">
                    examiner {n.examiner.id} · key {n.examiner.fingerprint}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-claim">Lab node hasn’t connected yet: start the agent next to the board.</div>
                )}
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-paper py-2">
                    <div className="font-mono text-lg">{today.length}</div>
                    <div className="text-xs text-muted">upcoming slots</div>
                  </div>
                  <div className="rounded-lg bg-paper py-2">
                    <div className="font-mono text-lg">{n.runs}</div>
                    <div className="text-xs text-muted">runs</div>
                  </div>
                  <div className="rounded-lg bg-paper py-2">
                    <div className="font-mono text-lg">{n.served}</div>
                    <div className="text-xs text-muted">students proven</div>
                  </div>
                </div>
                {today.length > 0 && (
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {today.slice(0, 4).map((b) => (
                      <li key={b.id} className="flex items-center justify-between">
                        <span>{b.user.name}</span>
                        <span className="font-mono text-xs text-muted">
                          {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
          {profile.data?.nodes.length === 0 && (
            <Empty>
              No boards registered. <Link to="/labs" className="text-wire hover:underline">Lend one</Link>.
            </Empty>
          )}
        </div>
      </section>
      <section>
        <SectionTitle>Students your boards have served</SectionTitle>
        {lent.length === 0 ? (
          <Empty>Every student who passes on your board is linked to your club here.</Empty>
        ) : (
          <Card>
            <ul>
              {lent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0">
                  <PersonLink user={c.to} />
                  {c.proof && (
                    <Link to={`/proof/${c.proof.attempt_id}`} className="shrink-0 text-xs text-wire hover:underline">
                      {c.proof.test.title}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------

export function Home() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Landing />;

  const first = me.name.split(' ')[0];
  const sub =
    me.role === 'student'
      ? me.college && !me.college.has_lab
        ? `${me.college.name} has no FPGA lab. Borrow a board from another campus and prove what you can do.`
        : 'Prove what you can do on a real board. Connections follow the proof.'
      : me.role === 'club'
        ? 'Your boards are how students without a lab get proven.'
        : 'Post a challenge, get proofs, follow through with referrals and mentorship.';

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Hi {first}</h1>
      <p className="mt-1 text-ink-2">{sub}</p>
      <div className="mt-6">
        {me.role === 'student' ? <StudentHome /> : me.role === 'club' ? <ClubHome /> : <PosterHome />}
      </div>
    </div>
  );
}
