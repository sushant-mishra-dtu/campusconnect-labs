import { Link, useParams } from 'react-router-dom';
import type { Profile as ProfileT } from '../api';
import { useAuth } from '../auth';
import { ChallengeCard } from '../components/ChallengeCard';
import { ConnectionCard } from '../components/ConnectionCard';
import {
  Avatar,
  Card,
  ClaimChip,
  DifficultyTag,
  Empty,
  ErrorNote,
  KindBadge,
  Loading,
  SectionTitle,
  SkillChip,
  StatusDot,
  Tag,
  fmtDate,
  roleLabel,
} from '../components/ui';
import { useApi } from '../hooks';
import { useLiveRefresh } from '../live';

export function Profile() {
  const { id } = useParams();
  const { me } = useAuth();
  const { data: p, error, loading, reload } = useApi<ProfileT>(`/users/${id}`);
  useLiveRefresh(['network'], () => void reload());

  if (loading) return <Loading />;
  if (error || !p) return <ErrorNote>{error ?? 'Not found'}</ErrorNote>;

  const isMe = me?.id === p.id;
  const showSkills = p.role === 'student' || p.badges.length > 0 || p.claims.length > 0;

  return (
    <div className="space-y-8">
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar user={p} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
              <Tag>{roleLabel(p.role)}</Tag>
              {isMe && <Tag tone="wire">you</Tag>}
            </div>
            <div className="mt-1 text-ink-2">{p.headline}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              {p.org && <span>{p.org}</span>}
              {p.org && p.college && <span>·</span>}
              {p.college && <span>{p.college.name}, {p.college.city}</span>}
              {p.college && !p.college.has_lab && p.role === 'student' && <Tag tone="claim">No FPGA lab on campus</Tag>}
            </div>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="font-mono text-2xl">{p.badges.length}</div>
              <div className="text-xs text-muted">proofs</div>
            </div>
            <div>
              <div className="font-mono text-2xl">{p.connections.length}</div>
              <div className="text-xs text-muted">connections</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div className="space-y-8">
          {showSkills && (
            <section>
              <SectionTitle>Proven on hardware</SectionTitle>
              {p.badges.length === 0 ? (
                <Empty>Nothing proven yet. {isMe && <Link to="/challenges" className="text-wire hover:underline">Pick a challenge</Link>}</Empty>
              ) : (
                <div className="space-y-3">
                  {p.badges.map((b) => (
                    <Card key={b.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{b.test.title}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                            <DifficultyTag test={b.test} /> · on <span className="font-mono">{b.node_id}</span> · {fmtDate(b.issued_at)}
                          </div>
                        </div>
                        <KindBadge kind={b.kind} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {b.test.skills.map((s) => (
                          <SkillChip key={s} slug={s} state="proven" />
                        ))}
                      </div>
                      <Link to={`/proof/${b.attempt_id}`} className="mt-3 inline-block text-xs font-medium text-wire hover:underline">
                        Signed proof →
                      </Link>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          )}

          {p.claims.length > 0 && (
            <section>
              <SectionTitle>Claims</SectionTitle>
              <Card className="border-dashed p-4">
                <div className="flex flex-wrap gap-1.5">
                  {p.claims.map((c) => (
                    <ClaimChip key={c} text={c} />
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted">Typed by {isMe ? 'you' : p.name.split(' ')[0]}. Claims on a profile don’t count until a board proves them.</div>
              </Card>
            </section>
          )}

          {p.challenges.length > 0 && (
            <section>
              <SectionTitle>Challenges posted</SectionTitle>
              <div className="space-y-3">
                {p.challenges.map((c) => (
                  <ChallengeCard key={c.id} c={c} />
                ))}
              </div>
            </section>
          )}

          {p.nodes.length > 0 && (
            <section>
              <SectionTitle>Boards lent</SectionTitle>
              <div className="space-y-3">
                {p.nodes.map((n) => (
                  <Card key={n.id} className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <StatusDot online={n.online} /> {n.name}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">{n.board}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">{n.served}</div>
                      <div className="text-xs text-muted">students proven</div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>

        <section>
          <SectionTitle>Connections, each backed by something that happened</SectionTitle>
          {p.connections.length === 0 ? (
            <Empty>No connections yet. They appear when a challenge is passed, a board is lent, or a referral is sent.</Empty>
          ) : (
            <div className="space-y-3">
              {p.connections.map((c) => (
                <ConnectionCard key={c.id} c={c} onActed={() => void reload()} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
