import type { Attempt } from '../api';
import { CheckIcon, CrossIcon, Spinner, cx } from './ui';

const STAGES = [
  { key: 'booking', label: 'Booking', detail: 'slot + fresh nonce' },
  { key: 'build', label: 'Build', detail: 'synthesize & compile' },
  { key: 'flash', label: 'Flash', detail: 'onto the board' },
  { key: 'examine', label: 'Examine', detail: 'inputs driven, outputs measured' },
  { key: 'sign', label: 'Sign', detail: 'ECDSA on the examiner' },
  { key: 'verify', label: 'Verify', detail: 'platform checks' },
];

const INDEX: Record<string, number> = { queued: 1, received: 1, build: 1, flash: 2, examine: 3, sign: 4, verify: 5, verified: 6 };

export function Pipeline({ attempt }: { attempt: Attempt | null }) {
  const status = attempt?.status;
  const idx = attempt ? (status === 'verified' ? 6 : (INDEX[attempt.stage ?? 'queued'] ?? 1)) : 0;
  const failed = status === 'error' || status === 'rejected';
  const failedAt = failed ? (status === 'rejected' ? 5 : idx) : -1;

  return (
    <ol className="grid grid-cols-6 gap-1.5">
      {STAGES.map((s, i) => {
        const done = attempt && (i < idx || status === 'verified') && i !== failedAt;
        const active = attempt && !failed && status !== 'verified' && i === idx;
        const bad = i === failedAt;
        return (
          <li key={s.key} className="min-w-0">
            <div
              className={cx(
                'h-1.5 rounded-full',
                done && 'bg-proof-bright',
                active && 'bg-proof-bright/50 animate-pulse-dot',
                bad && 'bg-fail',
                !done && !active && !bad && 'bg-white/10',
              )}
            />
            <div className="mt-2 flex items-center gap-1 text-[12px] font-medium text-white/90">
              {done && <CheckIcon className="h-3 w-3 text-proof-bright" />}
              {active && <Spinner className="h-3 w-3 text-proof-bright" />}
              {bad && <CrossIcon className="h-3 w-3 text-fail" />}
              <span className="truncate">{s.label}</span>
            </div>
            <div className="hidden truncate text-[11px] text-trace/70 xl:block">{s.detail}</div>
          </li>
        );
      })}
    </ol>
  );
}
