// The server only accepts a verdict that is signed by the node's pinned examiner key,
// answers the nonce we issued for this attempt, carries a fresh counter, and lines up
// with a booking that was live when the attempt started.
import crypto from 'node:crypto';
import { one, type AttemptRow, type BookingRow, type NodeRow } from './db.js';

// What the examiner tested, as it signed it. Only an enrolled ESP32 can have measured a
// physical board; a sim examiner's verdict must say which simulated form of the design it ran.
export type Target = 'netlist' | 'bitstream' | 'fpga';
export const TARGETS_FOR_KIND: Record<string, Target[]> = { sim: ['netlist', 'bitstream'], esp32: ['fpga'] };
const TARGET_TEXT: Record<Target, string> = {
  netlist: 'simulated synthesized netlist, no FPGA',
  bitstream: 'simulated iCE40 bitstream, no FPGA',
  fpga: 'physical FPGA',
};

export interface VerdictPayload {
  v: number;
  attempt: string;
  challenge: string;
  node: string;
  examiner: string;
  kind: string;
  target: Target;
  nonce: string;
  counter: number;
  measured: Record<string, unknown>;
  result: 'pass' | 'fail';
}

export type VerdictCheck =
  | { ok: true; payload: VerdictPayload; checks: string[] }
  | { ok: false; reason: string; checks: string[] };

const BOOKING_GRACE_MS = 5 * 60_000;

export function checkVerdict(att: AttemptRow, node: NodeRow, payloadText: string, sigB64: string, at = Date.now()): VerdictCheck {
  const checks: string[] = [];
  const fail = (reason: string): VerdictCheck => ({ ok: false, reason, checks });

  if (!node.examiner_pubkey) return fail('no examiner key is pinned for this node');

  let sigOk = false;
  try {
    sigOk = crypto.verify('sha256', Buffer.from(payloadText, 'utf8'), node.examiner_pubkey, Buffer.from(sigB64, 'base64'));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return fail('signature does not verify against the pinned examiner key');
  checks.push('ECDSA P-256 signature valid');

  let p: VerdictPayload;
  try {
    p = JSON.parse(payloadText);
  } catch {
    return fail('payload is not JSON');
  }

  if (p.attempt !== att.id) return fail('verdict is for a different attempt');
  if (p.nonce !== att.nonce) return fail('nonce does not match the one issued for this attempt');
  checks.push('nonce matches this attempt');
  if (p.node !== att.node_id) return fail('verdict names a different node');
  if (p.challenge !== att.test_id) return fail('verdict is for a different challenge');
  if (p.examiner !== node.examiner_id) return fail('verdict names a different examiner');
  // The tier is the platform's call (enrollment), so a payload claiming another one is refused
  // rather than shown next to a label that contradicts it.
  if (p.kind !== (node.examiner_kind ?? 'sim')) return fail(`verdict says kind "${p.kind}", but this node's examiner is enrolled as "${node.examiner_kind ?? 'sim'}"`);
  checks.push('node, examiner and challenge match');

  const kind = node.examiner_kind ?? 'sim';
  if (p.v !== 2 || !p.target) return fail('verdict does not say what was examined (format v2 with a target is required)');
  if (!TARGETS_FOR_KIND[kind]?.includes(p.target)) return fail(`a ${kind} examiner cannot have examined target "${p.target}"`);
  checks.push(`examined: ${TARGET_TEXT[p.target]}`);

  if (!Number.isInteger(p.counter) || p.counter <= node.last_counter) {
    return fail(`counter ${p.counter} is not above the last accepted ${node.last_counter} (replay)`);
  }
  checks.push(`counter ${p.counter} is fresh`);

  const b = one<BookingRow>('SELECT * FROM bookings WHERE id = ?', att.booking_id);
  if (!b || b.cancelled || b.node_id !== att.node_id || b.user_id !== att.user_id) return fail('no matching booking');
  if (att.created_at < b.starts_at || att.created_at >= b.ends_at) return fail('attempt started outside the booking');
  if (at > b.ends_at + BOOKING_GRACE_MS) return fail('verdict arrived after the booking ended');
  checks.push('booking matches');

  if (p.result !== 'pass' && p.result !== 'fail') return fail('result must be pass or fail');
  return { ok: true, payload: p, checks };
}
