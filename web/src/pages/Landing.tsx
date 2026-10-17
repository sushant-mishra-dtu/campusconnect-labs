import { Link } from 'react-router-dom';
import type { Stats } from '../api';
import { ArrowIcon, Card, ChipIcon, ClaimChip, Tag } from '../components/ui';
import { useApi } from '../hooks';

const STEPS = [
  ['Alum · recruiter · founder', 'Post a challenge with an offer', '“Make this UART work on a real FPGA and I’ll refer you.”'],
  ['Student', 'See your gap', 'Your proven skills are compared with the role. The challenge that closes the gap is suggested.'],
  ['College · club', 'Lend a board', 'Idle FPGA boards become remote lab nodes. A student with no lab books a slot on another campus.'],
  ['Student', 'Flash from the browser', 'Write Verilog here. It is synthesized and flashed onto the real board, wherever it is.'],
  ['Examiner', 'The board gets tested', 'An ESP32 wired to the FPGA drives its inputs, measures its outputs and signs the result.'],
  ['Everyone', 'Pass, badge, connection', 'The student is linked to the author with the proof attached. The author sends the referral.'],
];

const SIGNED = `{
  "attempt":   "a7f3c2e1",
  "challenge": "uart-nonce",
  "node":      "iiitd-01",
  "nonce":     "9c41e2",
  "counter":   118,
  "measured":  { "baud": 115385, "echo": "9c41e2" },
  "result":    "pass"
}`;

function Stat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div>
      <div className="font-mono text-3xl font-semibold tracking-tight">{value ?? '–'}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

export function Landing() {
  const { data: stats } = useApi<Stats>('/stats');

  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <Tag tone="wire">HackShift 2026 · Problem Statement 1</Tag>
          <h1 className="mt-4 text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
            Connect over what you’ve <span className="text-proof">proven on real hardware</span>.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
            Profiles are claims. Here, a connection only exists when a board in someone’s lab measured your design and signed the result.
            Claims on a profile don’t count.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/login" className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-5 text-sm font-medium text-white hover:bg-ink-2">
              Try the demo <ArrowIcon className="h-4 w-4" />
            </Link>
            <a href="#how" className="inline-flex h-11 items-center rounded-lg border border-line-2 bg-card px-5 text-sm font-medium hover:border-ink">
              How it works
            </a>
          </div>
        </div>

        <div className="grid gap-3">
          <Card className="p-5">
            <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">A directory entry</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex gap-3"><span className="w-16 text-muted">name</span>3rd-year ECE student</div>
              <div className="flex flex-wrap items-center gap-2"><span className="w-16 text-muted">skills</span><ClaimChip text="Verilog" /><ClaimChip text="FPGA" /><ClaimChip text="Embedded C" /></div>
              <div className="flex gap-3"><span className="w-16 text-muted">source</span><span className="text-claim">typed by the student</span></div>
            </div>
          </Card>
          <Card className="border-proof/40 p-5 shadow-[0_1px_0_0_rgba(21,122,76,0.15)]">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold tracking-wider text-proof uppercase">A connection on CampusConnect Labs</div>
              <ChipIcon className="h-4 w-4 text-proof" />
            </div>
            <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">from</dt><dd>3rd-year ECE, college with no FPGA lab</dd>
              <dt className="text-muted">to</dt><dd>Alum, FPGA engineer</dd>
              <dt className="text-muted">type</dt><dd className="font-mono text-[13px]">proved_for</dd>
              <dt className="text-muted">challenge</dt><dd>UART nonce echo</dd>
              <dt className="text-muted">board</dt><dd>iCE40 node, IIIT Delhi Robotics Club</dd>
              <dt className="text-muted">signed by</dt><dd className="font-mono text-[13px]">examiner · ECDSA P-256</dd>
            </dl>
          </Card>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-6 border-y border-line py-8 sm:grid-cols-4">
        <Stat value={stats?.proofs} label="signed proofs" />
        <Stat value={stats?.connections} label="connections, all backed by proof" />
        <Stat value={stats?.nodes} label="lab nodes lent by clubs" />
        <Stat value={stats?.no_lab_students} label="proven students from colleges with no lab" />
      </section>

      <section id="how" className="scroll-mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">A challenge is how two people meet</h2>
        <p className="mt-2 max-w-2xl text-ink-2">Someone with an opportunity posts a hardware challenge. A student proves the skill on a real board. The proof creates the connection.</p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([who, title, body], i) => (
            <li key={title}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{who}</span>
                </div>
                <div className="mt-3 font-semibold">{title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">The board is what makes the proof real</h2>
          <div className="mt-5 space-y-5 text-ink-2">
            <div>
              <div className="font-semibold text-ink">It can’t be faked</div>
              <p className="mt-1 leading-relaxed">
                The result is measured by a separate chip and signed there. The server only accepts a verdict with a valid signature, the nonce it issued for
                that attempt, a fresh counter and a matching booking.
              </p>
            </div>
            <div>
              <div className="font-semibold text-ink">Neither half works alone</div>
              <p className="mt-1 leading-relaxed">
                Matching, booking and the live console need the board to prove anything. The board is just a board without the network that sends people to it
                and acts on the result.
              </p>
            </div>
            <div>
              <div className="font-semibold text-ink">There are no follow buttons</div>
              <p className="mt-1 leading-relaxed">A connection exists only when something happened: a challenge passed, a board lent, a referral made, a mentorship given.</p>
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl bg-board">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 font-mono text-xs text-trace">
            <span>what the examiner signs</span>
            <span>ECDSA P-256</span>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-[#d8e6dd]">{SIGNED}</pre>
          <div className="border-t border-white/10 px-4 py-2.5 font-mono text-xs text-trace">The private key stays on the ESP32. The counter stops replays.</div>
        </div>
      </section>
    </div>
  );
}
