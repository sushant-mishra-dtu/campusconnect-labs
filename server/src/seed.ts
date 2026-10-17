// Demo data. People, companies and two of the colleges are fictional.
// Historical proofs are signed by a one-off "seed examiner" key whose private half
// is thrown away when this script ends; they are labelled as simulation proofs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DB_PATH } from './paths.js';
import { sha256 } from './util.js';

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true });

const { db, run } = await import('./db.js');
const { TESTS, referenceSolution } = await import('./tests.js');

const DAY = 24 * 60 * 60 * 1000;
const t = (daysAgo: number, hour = 15) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

db.exec('BEGIN');

// ---------- skills ----------
const skills: [string, string, string][] = [
  ['verilog-basics', 'Verilog basics', 'RTL'],
  ['combinational-logic', 'Combinational logic', 'RTL'],
  ['fsm', 'State machines', 'RTL'],
  ['counters', 'Counters & dividers', 'RTL'],
  ['clock-division', 'Clock division', 'Timing'],
  ['timing', 'Cycle-accurate timing', 'Timing'],
  ['synchronizers', 'CDC synchronizers', 'Timing'],
  ['debouncing', 'Input debouncing', 'Interfaces'],
  ['pwm', 'PWM generation', 'Interfaces'],
  ['uart', 'UART', 'Interfaces'],
  ['serial-protocols', 'Serial protocols', 'Interfaces'],
  ['buffering', 'Buffers & FIFOs', 'RTL'],
];
for (const s of skills) run('INSERT INTO skills (slug, name, area) VALUES (?, ?, ?)', ...s);

// ---------- colleges ----------
const colleges: [string, string, string, number][] = [
  ['iiitd', 'IIIT Delhi', 'New Delhi', 1],
  ['dtu', 'Delhi Technological University', 'New Delhi', 1],
  ['sunrise', 'Sunrise Institute of Technology', 'Rohtak', 0],
  ['narmada', 'Narmada Valley Engineering College', 'Jabalpur', 0],
];
for (const c of colleges) run('INSERT INTO colleges (id, name, city, has_lab) VALUES (?, ?, ?, ?)', ...c);

// ---------- people ----------
type Seed = [id: string, name: string, email: string, role: string, headline: string, college: string | null, org: string | null, claims: string[], hue: number];
const users: Seed[] = [
  ['u_aarav', 'Aarav Sharma', 'aarav@demo.ccl', 'student', '3rd-year ECE · no FPGA lab on campus', 'sunrise', null, ['Verilog', 'FPGA', 'Embedded C'], 24],
  ['u_diya', 'Diya Menon', 'diya@demo.ccl', 'student', '2nd-year EEE · robotics and motor control', 'narmada', null, ['VHDL', 'Digital design', 'MATLAB'], 320],
  ['u_kabir', 'Kabir Singh', 'kabir@demo.ccl', 'student', 'Final-year ECE · wants to do ASIC verification', 'dtu', null, ['SystemVerilog', 'UVM', 'Python'], 200],
  ['u_tanya', 'Tanya Rao', 'tanya@demo.ccl', 'student', '3rd-year CSE · RISC-V on the side', 'iiitd', null, ['Verilog', 'RISC-V', 'C++'], 160],
  ['u_farhan', 'Farhan Ali', 'farhan@demo.ccl', 'student', '3rd-year ECE · builds with Arduino', 'sunrise', null, ['Arduino', 'Verilog', 'PCB design'], 45],
  ['u_meera', 'Meera Iyer', 'meera@demo.ccl', 'alum', 'FPGA engineer · DTU class of 2019', 'dtu', 'Siliconvale Semiconductors', ['FPGA', 'Timing closure', 'PCIe'], 280],
  ['u_rohan', 'Rohan Gupta', 'rohan@demo.ccl', 'founder', 'Founder · IIIT Delhi class of 2017', 'iiitd', 'Tessellate Robotics', ['Robotics', 'Embedded', 'Startups'], 140],
  ['u_kavya', 'Kavya Nair', 'kavya@demo.ccl', 'recruiter', 'University recruiting, digital design', null, 'ChipForge Systems', ['Hiring', 'Campus programs'], 350],
  ['u_ishaan', 'Ishaan Verma', 'ishaan@demo.ccl', 'club', 'Lead, Robotics Club', 'iiitd', 'Robotics Club, IIIT Delhi', [], 100],
  ['u_neha', 'Neha Bansal', 'neha@demo.ccl', 'club', 'Chair, IEEE Student Branch', 'dtu', 'IEEE Student Branch, DTU', [], 60],
];
for (const u of users) {
  run(
    'INSERT INTO users (id, name, email, role, headline, college_id, org, claims, hue, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    u[0], u[1], u[2], u[3], u[4], u[5], u[6], JSON.stringify(u[7]), u[8], t(30),
  );
}

// ---------- roles ----------
const roles: [string, string, string, string, string[], string][] = [
  ['r_fpga_intern', 'FPGA Design Intern', 'Siliconvale Semiconductors', 'u_meera',
    ['verilog-basics', 'combinational-logic', 'uart', 'serial-protocols', 'fsm', 'buffering'],
    'Six-month internship on our FPGA prototyping team. You will bring up interfaces on real boards.'],
  ['r_robotics_hw', 'Embedded Hardware Engineer (new grad)', 'Tessellate Robotics', 'u_rohan',
    ['synchronizers', 'debouncing', 'pwm', 'counters', 'clock-division'],
    'Motor-control and sensor-interface FPGA work for our warehouse robots.'],
  ['r_dd_trainee', 'Digital Design Trainee', 'ChipForge Systems', 'u_kavya',
    ['verilog-basics', 'combinational-logic', 'counters', 'timing', 'fsm'],
    'Twelve-month trainee program in RTL design and verification.'],
];
for (const r of roles) {
  run('INSERT INTO roles (id, title, org, author_id, skills, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    r[0], r[1], r[2], r[3], JSON.stringify(r[4]), r[5], t(12));
}

// ---------- challenges (an author posts a test with an offer) ----------
const challenges: [string, string, string, string | null, string, string, string][] = [
  ['c_uart', 'uart-nonce', 'u_meera', 'r_fpga_intern', 'Make this UART work on a real FPGA', 'referral',
    "Make this UART work on a real FPGA and I'll refer you to our FPGA prototyping team."],
  ['c_pwm', 'pwm-duty', 'u_rohan', 'r_robotics_hw', 'Drive our motor PWM spec', 'interview',
    'Pass this and you skip our first-round screen for the embedded hardware role.'],
  ['c_debounce', 'debounce-counter', 'u_rohan', null, 'Count presses on a filthy button', 'mentorship',
    "Clean inputs are where every robot bug starts. Pass this and I'll mentor you through our motor-controller board."],
  ['c_gray', 'switch-decoder', 'u_kavya', 'r_dd_trainee', 'Trainee program first filter', 'interview',
    'Our first filter for the trainee program. Pass it and you get a direct interview slot.'],
];
for (const c of challenges) {
  run('INSERT INTO challenges (id, test_id, author_id, role_id, title, offer_type, offer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ...c, t(10));
}

// ---------- lab nodes ----------
const BOARD = 'iCE40 UP5K (iCEBreaker) + ESP32-S3 examiner';
// The live node: its examiner key is pinned when the lab node agent first connects.
run('INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  'iiitd-01', 'Robotics Club bench', 'iiitd', 'u_ishaan', BOARD, sha256('demo-iiitd-01-token'), t(14));

// The historical node, signed by a throwaway seed key.
const seedKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const seedPub = seedKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
run(`INSERT INTO nodes (id, name, college_id, owner_id, board, token_hash, examiner_id, examiner_kind, examiner_pubkey, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  'dtu-02', 'IEEE lab, bench 2', 'dtu', 'u_neha', BOARD, sha256('demo-dtu-02-token'), 'seed-dtu-02', 'sim', seedPub, t(20));

// ---------- historical attempts ----------
const NODE_OWNER: Record<string, string> = { 'dtu-02': 'u_neha', 'iiitd-01': 'u_ishaan' };
const CHALLENGE_AUTHOR = Object.fromEntries(challenges.map((c) => [c[0], c[2]]));
const CHALLENGE_TEST = Object.fromEntries(challenges.map((c) => [c[0], c[1]]));

let counter = 0;
const measuredFor = (testId: string, nonce: string) => {
  switch (testId) {
    case 'switch-decoder': return { vectors: 64, errors: 0 };
    case 'debounce-counter': { const n = 5 + (parseInt(nonce.slice(-1), 16) % 8); return { presses: n, counted: n }; }
    case 'pwm-duty': return { points: 5, hz_min: 997, hz_max: 997, worst_duty_err: '0.00' };
    default: return { baud: 115385, echo: nonce, early_tx: 0 };
  }
};

let edgeSeq = 0;
const edge = (from: string, to: string, type: string, at: number, extra: Partial<Record<'attempt' | 'challenge' | 'node' | 'parent' | 'note', string>> = {}) => {
  const id = `e_seed_${++edgeSeq}`;
  run(`INSERT INTO connections (id, from_id, to_id, type, attempt_id, challenge_id, node_id, parent_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, from, to, type, extra.attempt ?? null, extra.challenge ?? null, extra.node ?? null, extra.parent ?? null, extra.note ?? null, at);
  return id;
};

const lent = new Set<string>();
function pastPass(userId: string, challengeId: string, daysAgo: number, followUp?: { type: 'referred' | 'mentored'; note: string }) {
  const testId = CHALLENGE_TEST[challengeId];
  const nodeId = 'dtu-02';
  const at = t(daysAgo, 14);
  const bookingId = `b_seed_${userId}_${challengeId}`;
  run('INSERT INTO bookings (id, node_id, user_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    bookingId, nodeId, userId, at - 10 * 60_000, at + 20 * 60_000, at - DAY);

  const attemptId = crypto.randomBytes(4).toString('hex');
  const nonce = crypto.randomBytes(3).toString('hex').replace(/0a/g, '1b');
  counter += 1;
  const payload = JSON.stringify({
    v: 1, attempt: attemptId, challenge: testId, node: nodeId, examiner: 'seed-dtu-02', kind: 'sim',
    nonce, counter, measured: measuredFor(testId, nonce), result: 'pass',
  });
  const sig = crypto.sign('sha256', Buffer.from(payload), seedKey.privateKey).toString('base64');
  run(`INSERT INTO attempts (id, user_id, challenge_id, test_id, node_id, booking_id, code, nonce, status, stage, log, payload, sig, result, verified,
                             examiner_id, examiner_kind, examiner_pubkey, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', 'verified', ?, ?, ?, 'pass', 1, 'seed-dtu-02', 'sim', ?, ?, ?)`,
    attemptId, userId, challengeId, testId, nodeId, bookingId, referenceSolution(testId), nonce,
    '[seed] historical attempt\n', payload, sig, seedPub, at, at + 40_000);
  run('INSERT INTO badges (id, user_id, test_id, attempt_id, kind, issued_at) VALUES (?, ?, ?, ?, ?, ?)',
    `bd_${attemptId}`, userId, testId, attemptId, 'sim', at + 40_000);

  const proved = edge(userId, CHALLENGE_AUTHOR[challengeId], 'proved_for', at + 40_000, { attempt: attemptId, challenge: challengeId, node: nodeId });
  const lentKey = `${NODE_OWNER[nodeId]}:${userId}`;
  if (!lent.has(lentKey)) {
    lent.add(lentKey);
    edge(NODE_OWNER[nodeId], userId, 'lent_board', at + 40_000, { attempt: attemptId, node: nodeId });
  }
  if (followUp) {
    edge(CHALLENGE_AUTHOR[challengeId], userId, followUp.type, at + DAY / 2, { parent: proved, challenge: challengeId, note: followUp.note });
  }
}

pastPass('u_kabir', 'c_gray', 9, { type: 'referred', note: 'Referred to the ChipForge trainee panel.' });
pastPass('u_kabir', 'c_pwm', 7);
pastPass('u_tanya', 'c_uart', 6, { type: 'referred', note: 'Referred to the Siliconvale FPGA prototyping team.' });
pastPass('u_diya', 'c_debounce', 5, { type: 'mentored', note: 'Weekly sessions on the motor-controller board.' });
pastPass('u_farhan', 'c_gray', 3);
pastPass('u_tanya', 'c_gray', 2);

run('UPDATE nodes SET last_counter = ? WHERE id = ?', counter, 'dtu-02');

// An upcoming booking so the calendar isn't empty.
run('INSERT INTO bookings (id, node_id, user_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  'b_seed_upcoming', 'iiitd-01', 'u_diya', Date.now() + 3 * 60 * 60_000, Date.now() + 3.5 * 60 * 60_000, Date.now());

db.exec('COMMIT');

console.log(`Seeded ${users.length} people, ${challenges.length} challenges, ${TESTS.size} tests, 2 lab nodes, ${counter} historical proofs`);
console.log(`Database: ${DB_PATH}`);
console.log('Lab node token for iiitd-01: demo-iiitd-01-token');
