import { marked } from 'marked';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ChallengeDetail as Detail } from '../api';
import { useAuth } from '../auth';
import {
  ArrowIcon,
  Card,
  CheckIcon,
  DifficultyTag,
  ErrorNote,
  Loading,
  OfferTag,
  PersonLink,
  SectionTitle,
  SkillChip,
  Tag,
  timeAgo,
} from '../components/ui';
import { useApi } from '../hooks';

export function ChallengeDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const { data: c, error, loading } = useApi<Detail>(`/challenges/${id}`);
  // Specs come from the repo's own rtl/challenges/*/spec.md, not from users.
  const html = useMemo(() => (c ? (marked.parse(c.spec, { async: false }) as string) : ''), [c]);

  if (loading) return <Loading />;
  if (error || !c) return <ErrorNote>{error ?? 'Not found'}</ErrorNote>;

  const proven = new Set(me?.verified_skills ?? []);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        <Link to="/challenges" className="text-sm text-muted hover:text-ink">
          ← Challenges
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OfferTag type={c.offer_type} />
          <DifficultyTag test={c.test} />
          {c.role && <Tag>{c.role.title} · {c.role.org}</Tag>}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{c.title}</h1>
        <div className="mt-1 font-mono text-sm text-muted">test: {c.test.id}</div>

        <Card className="mt-6 border-wire/30 bg-wire-soft/40 p-5">
          <div className="flex items-start gap-4">
            <PersonLink user={c.author} sub={false} size={40} />
          </div>
          <p className="mt-3 text-[15px] leading-relaxed">“{c.offer}”</p>
        </Card>

        <div className="mt-8">
          <SectionTitle>Spec</SectionTitle>
          <Card className="p-6">
            <div className="prose-spec" dangerouslySetInnerHTML={{ __html: html }} />
          </Card>
        </div>
      </div>

      <aside className="space-y-6">
        <Card className="p-5">
          {c.mine?.passed ? (
            <div className="flex items-center gap-2 font-medium text-proof">
              <CheckIcon className="h-4 w-4" /> You’ve passed this test
            </div>
          ) : (
            <div className="text-sm text-ink-2">Write the design in the browser. It runs on a lent board at another campus and comes back with a signed verdict.</div>
          )}
          {me ? (
            <Link
              to={`/challenges/${c.id}/attempt`}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-white hover:bg-ink-2"
            >
              Open the editor <ArrowIcon className="h-4 w-4" />
            </Link>
          ) : (
            <Link to="/login" className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-medium text-white">
              Sign in to attempt
            </Link>
          )}
          {c.mine?.last && !c.mine.passed && (
            <div className="mt-3 text-xs text-muted">
              Last attempt: <span className="font-mono">{c.mine.last.result ?? c.mine.last.status}</span>
            </div>
          )}
        </Card>

        <div>
          <SectionTitle>Skills it proves</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {c.test.skills.map((s) => (
              <SkillChip key={s} slug={s} state={proven.has(s) ? 'proven' : 'neutral'} />
            ))}
          </div>
        </div>

        <div>
          <SectionTitle aside={<span className="font-mono text-sm">{c.passes}</span>}>Passed by</SectionTitle>
          {c.passers.length === 0 ? (
            <div className="text-sm text-muted">Nobody yet. Be the first.</div>
          ) : (
            <ul className="space-y-3">
              {c.passers.map((p) => (
                <li key={p.attempt_id} className="flex items-center justify-between gap-2">
                  <PersonLink user={p.user} size={30} />
                  <Link to={`/proof/${p.attempt_id}`} className="shrink-0 text-xs text-wire hover:underline">
                    proof · {timeAgo(p.at)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
