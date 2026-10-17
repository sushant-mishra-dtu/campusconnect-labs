import type { Booking } from '../api';
import { cx, fmtTime } from './ui';

const HOUR = 60 * 60_000;
const IST_OFFSET = 5.5 * HOUR; // ticks land on whole IST hours

// A 12-hour strip starting an hour before now, with every booking on the board.
export function Timeline({ bookings, now, myId }: { bookings: Booking[]; now: number; myId?: string }) {
  const start = Math.floor((now + IST_OFFSET) / HOUR) * HOUR - IST_OFFSET - HOUR;
  const end = start + 12 * HOUR;
  const pct = (t: number) => ((Math.min(Math.max(t, start), end) - start) / (end - start)) * 100;
  const ticks = Array.from({ length: 7 }, (_, i) => start + i * 2 * HOUR);

  return (
    <div>
      <div className="relative h-8 overflow-hidden rounded-md border border-line bg-paper">
        {bookings
          .filter((b) => b.ends_at > start && b.starts_at < end)
          .map((b) => {
            const mine = b.user.id === myId;
            return (
              <div
                key={b.id}
                title={`${b.user.name} · ${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)}`}
                className={cx('absolute inset-y-1 rounded-sm px-1 text-[10px] leading-6 font-medium whitespace-nowrap', mine ? 'bg-proof text-white' : 'bg-ink-2/80 text-white')}
                style={{ left: `${pct(b.starts_at)}%`, width: `${Math.max(pct(b.ends_at) - pct(b.starts_at), 0.8)}%` }}
              >
                <span className="block truncate">{mine ? 'you' : b.user.name.split(' ')[0]}</span>
              </div>
            );
          })}
        <div className="absolute inset-y-0 w-px bg-fail" style={{ left: `${pct(now)}%` }} aria-hidden />
      </div>
      <div className="relative mt-1 h-4 font-mono text-[10px] text-muted">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${pct(t)}%` }}>
            {fmtTime(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
