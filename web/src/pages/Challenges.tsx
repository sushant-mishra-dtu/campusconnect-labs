import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Challenge } from '../api';
import { useAuth } from '../auth';
import { ChallengeCard } from '../components/ChallengeCard';
import { Empty, ErrorNote, Loading, cx } from '../components/ui';
import { useApi } from '../hooks';

const FILTERS = ['all', 'beginner', 'intermediate', 'advanced'] as const;

export function Challenges() {
  const { me } = useAuth();
  const { data, error, loading } = useApi<Challenge[]>('/challenges');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const canPost = me && ['alum', 'recruiter', 'founder'].includes(me.role);

  const shown = data?.filter((c) => filter === 'all' || c.test.difficulty === filter) ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Challenges</h1>
          <p className="mt-1 text-ink-2">Each one is posted by someone with an opportunity. Pass it on a real board and you’re connected, with the proof attached.</p>
        </div>
        {canPost && (
          <Link to="/challenges/new" className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-medium text-white hover:bg-ink-2">
            Post a challenge
          </Link>
        )}
      </div>

      <div className="mt-6 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cx('rounded-md px-3 py-1.5 text-sm capitalize', filter === f ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5')}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {loading && <Loading />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {data && shown.length === 0 && <Empty>No challenges at this level yet.</Empty>}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <ChallengeCard key={c.id} c={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
