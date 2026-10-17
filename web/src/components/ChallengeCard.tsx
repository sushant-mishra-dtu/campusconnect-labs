import { Link } from 'react-router-dom';
import type { Challenge } from '../api';
import { Card, CheckIcon, DifficultyTag, OfferTag, PersonLink, SkillChip, Tag } from './ui';

export function ChallengeCard({ c, highlight }: { c: Challenge; highlight?: string[] }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <OfferTag type={c.offer_type} />
          <DifficultyTag test={c.test} />
        </div>
        {c.mine?.passed && (
          <Tag tone="proof">
            <CheckIcon className="h-3 w-3" /> Passed
          </Tag>
        )}
      </div>
      <Link to={`/challenges/${c.id}`} className="mt-3 block">
        <h3 className="text-[17px] leading-snug font-semibold hover:underline">{c.title}</h3>
        <div className="mt-0.5 font-mono text-xs text-muted">{c.test.title}</div>
      </Link>
      <blockquote className="mt-3 border-l-2 border-wire/40 pl-3 text-sm leading-relaxed text-ink-2">{c.offer}</blockquote>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {c.test.skills.map((s) => (
          <SkillChip key={s} slug={s} state={highlight?.includes(s) ? 'missing' : 'neutral'} />
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <PersonLink user={c.author} size={30} />
        <div className="text-right text-xs text-muted">
          <div className="font-mono text-sm text-ink">{c.passes}</div>
          {c.passes === 1 ? 'pass' : 'passes'}
        </div>
      </div>
    </Card>
  );
}
