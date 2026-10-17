import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OfferType, Role, TestBrief, UserBrief } from '../api';
import { useMeta } from '../hooks';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ time

const IST = 'Asia/Kolkata';

export function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST });
}

export function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });
}

export function fmtDateTime(ts: number) {
  return `${fmtDate(ts)}, ${fmtTime(ts)} IST`;
}

export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ------------------------------------------------------------------ primitives

type ButtonKind = 'primary' | 'secondary' | 'proof' | 'ghost' | 'danger';

const BUTTON: Record<ButtonKind, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 disabled:bg-line-2 disabled:text-muted',
  secondary: 'bg-card text-ink border border-line-2 hover:border-ink disabled:text-muted disabled:border-line',
  proof: 'bg-proof text-white hover:brightness-110 disabled:bg-line-2 disabled:text-muted',
  ghost: 'text-ink-2 hover:bg-black/5',
  danger: 'text-fail hover:bg-fail-soft',
};

export function Button({
  kind = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        BUTTON[kind],
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-card', className)}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {aside}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-2 px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-muted">
      <Spinner /> Loading…
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-fail/30 bg-fail-soft px-3 py-2 text-sm text-fail">{children}</div>;
}

export function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      className={cx('inline-block h-2 w-2 rounded-full', online ? 'bg-proof-bright animate-pulse-dot' : 'bg-line-2', className)}
      aria-label={online ? 'online' : 'offline'}
    />
  );
}

// ------------------------------------------------------------------ people

export function Avatar({ user, size = 36 }: { user: Pick<UserBrief, 'name' | 'hue'>; size?: number }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `hsl(${user.hue} 55% 88%)`,
        color: `hsl(${user.hue} 45% 28%)`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  alum: 'Alum',
  recruiter: 'Recruiter',
  founder: 'Founder',
  club: 'Club',
};

export function roleLabel(role: Role) {
  return ROLE_LABEL[role];
}

export function PersonLink({ user, sub = true, size = 36 }: { user: UserBrief; sub?: boolean; size?: number }) {
  return (
    <Link to={`/u/${user.id}`} className="group flex min-w-0 items-center gap-2.5">
      <Avatar user={user} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium group-hover:underline">{user.name}</span>
        {sub && (
          <span className="block truncate text-xs text-muted">
            {user.org ?? user.college?.name ?? roleLabel(user.role)}
          </span>
        )}
      </span>
    </Link>
  );
}

// ------------------------------------------------------------------ tags

export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'proof' | 'claim' | 'fail' | 'wire'; className?: string }) {
  const tones = {
    neutral: 'bg-black/[0.05] text-ink-2',
    proof: 'bg-proof-soft text-proof',
    claim: 'bg-claim-soft text-claim',
    fail: 'bg-fail-soft text-fail',
    wire: 'bg-wire-soft text-wire',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

const OFFER_LABEL: Record<OfferType, string> = {
  referral: 'Referral',
  mentorship: 'Mentorship',
  internship: 'Internship',
  interview: 'Interview slot',
};

export function OfferTag({ type }: { type: OfferType }) {
  return <Tag tone="wire">{OFFER_LABEL[type]}</Tag>;
}

export function DifficultyTag({ test }: { test: Pick<TestBrief, 'difficulty'> }) {
  const bars = { beginner: 1, intermediate: 2, advanced: 3 }[test.difficulty];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted capitalize">
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cx('w-[3px] rounded-sm', i <= bars ? 'bg-ink-2' : 'bg-line-2')} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {test.difficulty}
    </span>
  );
}

export function KindBadge({ kind, compact }: { kind: 'sim' | 'esp32' | string | null; compact?: boolean }) {
  if (kind === 'esp32') {
    return (
      <Tag tone="proof" className="bg-proof text-white">
        <ChipIcon className="h-3 w-3" /> {compact ? 'Silicon' : 'Verified on silicon'}
      </Tag>
    );
  }
  return (
    <Tag tone="proof">
      <ChipIcon className="h-3 w-3" /> {compact ? 'Simulated' : 'Simulated, no physical FPGA'}
    </Tag>
  );
}

// What the examiner signed it tested, in words a judge or recruiter can check against the payload.
export const TARGET_TEXT: Record<'netlist' | 'bitstream' | 'fpga', { title: string; detail: string }> = {
  netlist: {
    title: 'Simulated: synthesized gate-level netlist',
    detail:
      'No physical FPGA was used. The lab node synthesized the design for an iCE40 UP5K and ran the examiner testbench against that gate-level netlist in Icarus Verilog, on a laptop.',
  },
  bitstream: {
    title: 'Simulated: the iCE40 bitstream, read back',
    detail:
      'No physical FPGA was used. The lab node placed and routed the design and packed the same iCE40 UP5K bitstream a real board would be flashed with, converted that bitstream back to Verilog, and ran the examiner testbench against it in Icarus Verilog, on a laptop.',
  },
  fpga: {
    title: 'Measured on a physical FPGA',
    detail: 'The design was flashed to a real iCE40 board and the ESP32-S3 examiner wired to its pins drove the inputs and measured the outputs.',
  },
};

export function SkillChip({ slug, state }: { slug: string; state: 'proven' | 'missing' | 'neutral' }) {
  const meta = useMeta();
  const name = meta?.skills.find((s) => s.slug === slug)?.name ?? slug;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
        state === 'proven' && 'border-proof/30 bg-proof-soft text-proof',
        state === 'missing' && 'border-dashed border-line-2 bg-transparent text-muted',
        state === 'neutral' && 'border-line bg-card text-ink-2',
      )}
    >
      {state === 'proven' && <CheckIcon className="h-3 w-3" />}
      {name}
    </span>
  );
}

export function ClaimChip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-claim/25 bg-claim-soft px-2.5 py-1 text-xs font-medium text-claim line-through decoration-claim/50">
      {text}
    </span>
  );
}

// ------------------------------------------------------------------ icons

export function ChipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect x="7" y="7" width="18" height="18" rx="3" fill="#16181d" />
        <rect x="12" y="12" width="8" height="8" rx="1.5" fill="#2fbf71" />
        <g stroke="#16181d" strokeWidth="2" strokeLinecap="round">
          <path d="M11 3v4M16 3v4M21 3v4M11 25v4M16 25v4M21 25v4M3 11h4M3 16h4M3 21h4M25 11h4M25 16h4M25 21h4" />
        </g>
      </svg>
      <span className="text-[15px] leading-none font-semibold tracking-tight">
        CampusConnect <span className="text-proof">Labs</span>
      </span>
    </span>
  );
}
