// C-RTL lab node agent.
// Connects out to the platform (so a college firewall is fine), takes one job at a time,
// builds and flashes the student's design, and relays the examiner's signed verdict.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { CHALLENGES_DIR, config } from './config.js';
import { startDashboard } from './dashboard.js';
import { SerialExaminer } from './examiners/serial.js';
import { SimExaminer, type ExaminerIdentity } from './examiners/sim.js';
import { buildIce40, flashIce40 } from './flows/ice40.js';
import { buildReadback, compileSim, examineSim, synthNetlist } from './flows/sim.js';
import { describeTools, toolVersion } from './hdl.js';
import { lintStudentCode } from './lint.js';
import type { SignedVerdict } from './payload.js';
import { trace } from './trace.js';

interface Job {
  attempt: string;
  challenge: string;
  nonce: string;
  code: string;
}

// Ids end up in paths on this machine and in what the examiner signs, so only the shapes the
// platform sends are taken (the ESP32 firmware accepts the same).
const ID = /^[a-z0-9-]{1,32}$/;

function jobProblem(job: Job) {
  if (typeof job.challenge !== 'string' || !ID.test(job.challenge)) return 'the job has a malformed challenge id';
  if (typeof job.nonce !== 'string' || !/^[0-9a-f]{6}$/.test(job.nonce)) return 'the job has a malformed nonce';
  if (typeof job.code !== 'string') return 'the job has no code';
  if (!fs.existsSync(path.join(CHALLENGES_DIR, job.challenge, 'challenge.json'))) {
    return `this lab node doesn't have the "${job.challenge}" challenge yet; the club needs to update it`;
  }
  return null;
}

// The stations a job passes through on this node, as the dashboard draws them
const PIPELINE =
  config.mode === 'hw'
    ? [
        { id: 'lint', title: 'Lint', sub: 'early errors' },
        { id: 'yosys', title: 'yosys (wasm)', sub: 'sees only dut.v' },
        { id: 'nextpnr', title: 'nextpnr', sub: 'place & route' },
        { id: 'icepack', title: 'icepack', sub: 'bitstream' },
        { id: 'iceprog', title: 'iceprog', sub: 'flash over USB' },
        { id: 'board', title: 'iCE40 board', sub: 'runs the design' },
        { id: 'esp32', title: 'ESP32', sub: 'measures and signs' },
      ]
    : config.simTarget === 'bitstream'
      ? [
          { id: 'lint', title: 'Lint', sub: 'early errors' },
          { id: 'yosys', title: 'yosys (wasm)', sub: 'sees only dut.v' },
          { id: 'nextpnr', title: 'nextpnr', sub: 'place & route' },
          { id: 'icepack', title: 'icepack', sub: 'UP5K bitstream' },
          { id: 'readback', title: 'icebox_vlog', sub: 'bitstream → Verilog' },
          { id: 'iverilog', title: 'iverilog', sub: 'readback + testbench' },
          { id: 'vvp', title: 'vvp', sub: 'runs the testbench' },
          { id: 'examiner', title: 'Sim examiner', sub: 'key on this machine' },
        ]
      : [
          { id: 'lint', title: 'Lint', sub: 'early errors' },
          { id: 'yosys', title: 'yosys (wasm)', sub: 'sees only dut.v' },
          { id: 'iverilog', title: 'iverilog', sub: 'netlist + testbench' },
          { id: 'vvp', title: 'vvp', sub: 'runs the testbench' },
          { id: 'examiner', title: 'Sim examiner', sub: 'key on this machine' },
        ];
// Tool output prefix → station, so the dashboard can follow steps that run inside one call
const PREFIX: Record<string, string> = {
  yosys: 'yosys',
  iverilog: 'iverilog',
  'nextpnr-ice40': 'nextpnr',
  icepack: 'icepack',
  icebox_vlog: 'readback',
  iceprog: 'iceprog',
  examiner: config.mode === 'hw' ? 'esp32' : 'vvp',
};

interface JobView {
  attempt: string;
  challenge: string;
  nonce: string;
  bytes: number;
  received: number;
  at: string;
  steps: { at: string; t: number; ms: number; label: string }[];
  result: 'pass' | 'fail' | 'error' | null;
  error?: string;
  counter?: number;
  total?: number;
}

const examiner: { identity: ExaminerIdentity } =
  config.mode === 'hw'
    ? await (async () => {
        if (!config.serial) throw new Error('hw mode needs --serial=<port> for the ESP32 examiner');
        return SerialExaminer.open(config.serial);
      })()
    : new SimExaminer(config.keysDir, config.node);

if (config.mode === 'sim' && config.simTarget !== 'bitstream' && config.simTarget !== 'netlist') {
  console.error(`[node] --sim-target must be bitstream or netlist, not ${config.simTarget}`);
  process.exit(1);
}
console.log(`[node] ${config.node} · mode ${config.mode}${config.mode === 'sim' ? ` · no FPGA, simulating the ${config.simTarget}` : ''}`);
if (!config.token && !config.info) {
  console.error(`[node] no token for ${config.node}: pass --token=, set CRTL_NODE_TOKEN, or run \`npm run seed\` for the demo node`);
  process.exit(1);
}
console.log(`[node] examiner ${examiner.identity.id} (${examiner.identity.kind})`);
if (config.info) {
  console.log(examiner.identity.pubkey);
  process.exit(0);
}
const simTools = config.simTarget === 'bitstream' ? 'nextpnr-ice40/icepack: wasm, icebox_vlog: python, ' : '';
const tools = `yosys: wasm sandbox, ${config.mode === 'hw' ? describeTools(['nextpnr-ice40', 'icepack', 'iceprog']) : simTools + describeTools(['iverilog', 'vvp'])}`;
console.log(`[node] tools: ${tools}`);

// Both sim targets are simulated against yosys's cells_sim.v, which gives some primitive inputs default
// values in the port list. Icarus Verilog reads that from version 12; with 11 (Ubuntu 22.04's
// package) every build fails with "Errors in port declarations", so refuse to start instead.
let iverilog: string | null = null;
if (config.mode === 'sim') {
  const version = toolVersion('iverilog');
  const major = Number(/version (\d+)/i.exec(version ?? '')?.[1]);
  if (version === null || major < 12) {
    console.error(`[node] sim mode needs Icarus Verilog 12 or newer, found ${version === null ? 'none' : `"${version.trim()}"`}`);
    process.exit(1);
  }
  if (Number.isNaN(major)) console.warn(`[node] couldn't read the Icarus Verilog version from "${version.trim()}"; builds need 12 or newer`);
  iverilog = version.trim();
}
// The bitstream readback runs icebox_vlog, a Python 3 script (see src/bitstream-readback.mjs)
if (config.mode === 'sim' && config.simTarget === 'bitstream') {
  const python = process.env.CRTL_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(python, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status !== 0 || !/Python 3/.test(`${r.stdout}${r.stderr}`)) {
    console.error(`[node] simulating the bitstream needs Python 3 for icebox_vlog; "${python}" didn't run. Install it, set CRTL_PYTHON, or use --sim-target=netlist`);
    process.exit(1);
  }
}

// What the dashboard shows about this node, kept current as things happen
const status = {
  node: config.node,
  mode: config.mode,
  platform: config.server,
  started: Date.now(),
  connection: 'connecting' as 'warming' | 'connecting' | 'paired' | 'disconnected' | 'refused',
  since: null as number | null,
  refusal: null as string | null,
  examiner: { id: examiner.identity.id, kind: examiner.identity.kind as string, fingerprint: null as string | null, counter: null as number | null },
  tools,
  iverilog,
  pipeline: PIPELINE,
  job: null as JobView | null,
  jobs: [] as JobView[],
};
if (config.dashboardPort) startDashboard(config.dashboardPort, () => ({ ...status, now: Date.now() }));

let ws: WebSocket | null = null;
let rejected = false;
const queue: Job[] = [];
let busy = false;

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(config.server);
  ws.on('open', () => {
    send({ type: 'hello', node: config.node, token: config.token, examiner: examiner.identity, mode: config.mode });
    trace('socket', 'agent', 'platform', `hello: node ${config.node}, examiner ${examiner.identity.id} and its public key`);
  });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      console.log(`[node] connected to ${config.server}, examiner key ${msg.fingerprint}`);
      Object.assign(status, { connection: 'paired', since: Date.now(), refusal: null });
      status.examiner.fingerprint = msg.fingerprint ?? null;
      if (msg.kind) status.examiner.kind = msg.kind;
      trace('socket', 'platform', 'agent', `welcome · examiner key ${msg.fingerprint} accepted as ${msg.kind === 'esp32' ? 'silicon' : 'simulation'}`);
    } else if (msg.type === 'rejected') {
      console.error(`[node] platform rejected this node: ${msg.reason}`);
      trace('error', 'platform', 'agent', `refused: ${msg.reason}`, { ok: false });
      if (msg.retry) return; // another session for this node is still open; the close handler retries
      Object.assign(status, { connection: 'refused', refusal: String(msg.reason) });
      rejected = true;
      process.exit(1);
    } else if (msg.type === 'job') {
      // The attempt id names the work folder; without a sane one there's nothing to report back to
      if (typeof msg.attempt !== 'string' || !ID.test(msg.attempt)) {
        console.error('[node] ignored a job with a malformed attempt id');
        return;
      }
      trace('job', 'platform', 'agent', `job ${msg.attempt} · ${msg.challenge} · nonce ${msg.nonce} · ${Buffer.byteLength(String(msg.code ?? ''))} bytes of Verilog`, { attempt: msg.attempt });
      queue.push(msg as Job);
      void drain();
    }
  });
  ws.on('close', () => {
    if (rejected) return;
    if (status.connection === 'paired') trace('socket', 'platform', 'agent', 'connection closed; retrying every 3 s', { ok: false });
    status.connection = 'disconnected';
    console.log('[node] disconnected, retrying in 3s');
    setTimeout(connect, 3000);
  });
  ws.on('error', (err) => console.error(`[node] ${err.message}`));
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) await runJob(queue.shift()!);
  busy = false;
}

async function runJob(job: Job) {
  const view: JobView = {
    attempt: job.attempt,
    challenge: job.challenge,
    nonce: job.nonce,
    bytes: Buffer.byteLength(String(job.code ?? '')),
    received: Date.now(),
    at: 'agent',
    steps: [],
    result: null,
  };
  status.job = view;
  let mark = view.received;
  let pos = -1;
  // Moves the job to the next station on the dashboard, with the time spent at the one before
  const advance = (to: string, label: string) => {
    if (to === view.at) return;
    const now = Date.now();
    trace('stage', view.at, to, label, { attempt: job.attempt, ms: now - mark });
    view.steps.push({ at: to, t: now, ms: now - mark, label });
    view.at = to;
    pos = to === 'agent' ? PIPELINE.length : PIPELINE.findIndex((p) => p.id === to);
    mark = now;
  };
  const finish = (result: 'pass' | 'fail' | 'error', error?: string) => {
    Object.assign(view, { result, error, total: Date.now() - view.received });
    status.jobs.unshift(view);
    status.jobs.length = Math.min(status.jobs.length, 12);
  };

  const log = (line: string) => {
    console.log(`  ${job.attempt} ${line}`);
    send({ type: 'log', attempt: job.attempt, line });
    const tool = PREFIX[/^\[([\w-]+)\]/.exec(line)?.[1] ?? ''];
    if (tool && PIPELINE.findIndex((p) => p.id === tool) > pos) advance(tool, `${tool} running`);
    trace('log', tool ?? 'agent', tool ?? 'agent', line, { attempt: job.attempt });
  };
  const stage = (s: string) => {
    send({ type: 'status', attempt: job.attempt, stage: s });
    trace('status', 'agent', 'platform', `${job.attempt} · ${s}`, { attempt: job.attempt });
  };
  const fail = (s: string, message: string) => {
    log(`[node] ${message}`);
    send({ type: 'error', attempt: job.attempt, stage: s, message });
    trace('error', 'agent', 'platform', `${job.attempt} · ${s}: ${message}`, { attempt: job.attempt, ok: false });
    finish('error', message);
  };

  const dir = path.join(config.workDir, job.attempt);

  try {
    stage('received');
    // Checked inside the try: a challenge this node doesn't have yet (the platform was updated
    // first) is a failed attempt, not a crashed agent.
    const problem = jobProblem(job);
    if (problem) return fail('build', problem);
    const meta = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, job.challenge, 'challenge.json'), 'utf8'));
    log(`[node] job ${job.attempt}: ${meta.title}, nonce ${job.nonce}`);
    advance('lint', 'check the source');
    const lint = lintStudentCode(job.code);
    if (lint) return fail('build', lint);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dut.v'), job.code);

    let verdict: SignedVerdict;
    if (config.mode === 'sim') {
      stage('build');
      if (config.simTarget === 'bitstream') {
        // nextpnr, icepack and icebox_vlog run inside buildReadback; their log prefixes move the
        // job along the dashboard
        advance('yosys', 'synthesize, place and route, pack, read the bitstream back');
        const buildErr = await buildReadback(dir, config.pcf, log);
        if (buildErr) return fail('build', buildErr);
        advance('iverilog', 'bitstream read back to Verilog');
      } else {
        advance('yosys', 'synthesize to a gate-level netlist');
        const synthErr = await synthNetlist(dir, log);
        if (synthErr) return fail('build', synthErr);
        advance('iverilog', 'netlist ready');
      }
      const compileErr = await compileSim(dir, job.challenge, config.simTarget, log);
      if (compileErr) return fail('build', compileErr);

      stage('flash');
      log(`[node] no FPGA on this node: loading the ${config.simTarget === 'bitstream' ? 'bitstream readback' : 'netlist'} into the simulator instead of flashing`);

      stage('examine');
      advance('vvp', 'compiled with the examiner testbench');
      const out = await examineSim(dir, job.nonce, meta.maxSeconds ?? 30, log);

      stage('sign');
      advance('examiner', `measured ${JSON.stringify(out.measured)} → ${out.result}`);
      verdict = (examiner as SimExaminer).sign({
        attempt: job.attempt,
        challenge: job.challenge,
        node: config.node,
        target: config.simTarget,
        nonce: job.nonce,
        measured: out.measured,
        result: out.result,
      });
    } else {
      stage('build');
      advance('yosys', 'synthesize, then place, route and pack');
      const buildErr = await buildIce40(dir, config.pcf, log);
      if (buildErr) return fail('build', buildErr);

      stage('flash');
      advance('iceprog', 'bitstream ready');
      const flashErr = await flashIce40(dir, log);
      if (flashErr) return fail('flash', flashErr);
      advance('board', 'bitstream loaded into the FPGA');

      stage('examine');
      advance('esp32', 'the ESP32 drives and measures the pins');
      verdict = await (examiner as SerialExaminer).run(
        { attempt: job.attempt, challenge: job.challenge, node: config.node, nonce: job.nonce },
        (l) => log(`[examiner] ${l}`),
        (meta.maxSeconds ?? 30) + 10,
      );
      stage('sign');
    }

    const p = JSON.parse(verdict.payload);
    advance('agent', `signed ${String(p.result).toUpperCase()} · counter ${p.counter}`);
    log(`[examiner] signed ${p.result.toUpperCase()} with counter ${p.counter}`);
    send({ type: 'verdict', attempt: job.attempt, ...verdict });
    trace('verdict', 'agent', 'platform', `${job.attempt} · ${String(p.result).toUpperCase()} · counter ${p.counter} · ${Buffer.from(verdict.sig, 'base64').length} B signature`, {
      attempt: job.attempt,
      ok: p.result === 'pass',
    });
    status.examiner.counter = p.counter;
    view.counter = p.counter;
    finish(p.result === 'pass' ? 'pass' : 'fail');
  } catch (err) {
    fail('examine', `node error: ${(err as Error).message}`);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // WSL may still hold the folder for a moment
    }
  }
}

// The first bitstream build in a fresh node pays for loading the WebAssembly place-and-route
// toolchain and compiling the readback: about 100 s, against about 13 s afterwards, and close
// to the platform's limit for an attempt. Pay it once on a throwaway design before connecting,
// so no student's attempt does.
const WARMUP_DESIGN = `module top(input wire clk, input wire [5:0] sw, input wire [1:0] btn,
           output wire [7:0] led, input wire uart_rx, output wire uart_tx);
  reg [7:0] q = 8'd0;
  always @(posedge clk) q <= {btn, sw};
  assign led = q;
  assign uart_tx = uart_rx;
endmodule
`;

async function warmUp() {
  if (config.mode !== 'sim' || config.simTarget !== 'bitstream') return;
  status.connection = 'warming';
  const dir = path.join(config.workDir, 'warmup');
  const t0 = Date.now();
  console.log('[node] warming up the toolchain with one bitstream build before connecting');
  trace('stage', 'agent', 'yosys', 'warm-up: one throwaway bitstream build before connecting');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dut.v'), WARMUP_DESIGN);
    const err = await buildReadback(dir, config.pcf, () => {});
    const took = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    console.log(err ? `[node] warm-up build failed after ${took}: ${err}` : `[node] toolchain warm after ${took}`);
    trace(err ? 'error' : 'stage', 'yosys', 'agent', err ? `warm-up failed: ${err}` : `toolchain warm after ${took}`, err ? { ok: false } : {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  status.connection = 'connecting';
}

await warmUp();
connect();
