// CampusConnect Labs lab node agent.
// Connects out to the platform (so a college firewall is fine), takes one job at a time,
// builds and flashes the student's design, and relays the examiner's signed verdict.
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { CHALLENGES_DIR, config } from './config.js';
import { SerialExaminer } from './examiners/serial.js';
import { SimExaminer, type ExaminerIdentity } from './examiners/sim.js';
import { buildIce40, flashIce40 } from './flows/ice40.js';
import { compileSim, examineSim, synthNetlist } from './flows/sim.js';
import { describeTools, toolVersion } from './hdl.js';
import { lintStudentCode } from './lint.js';
import type { SignedVerdict } from './payload.js';

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

const examiner: { identity: ExaminerIdentity } =
  config.mode === 'hw'
    ? await (async () => {
        if (!config.serial) throw new Error('hw mode needs --serial=<port> for the ESP32 examiner');
        return SerialExaminer.open(config.serial);
      })()
    : new SimExaminer(config.keysDir, config.node);

console.log(`[node] ${config.node} · mode ${config.mode}`);
if (!config.token && !config.info) {
  console.error(`[node] no token for ${config.node}: pass --token=, set CCL_NODE_TOKEN, or run \`npm run seed\` for the demo node`);
  process.exit(1);
}
console.log(`[node] examiner ${examiner.identity.id} (${examiner.identity.kind})`);
if (config.info) {
  console.log(examiner.identity.pubkey);
  process.exit(0);
}
console.log(`[node] tools: yosys: wasm sandbox, ${describeTools(config.mode === 'hw' ? ['nextpnr-ice40', 'icepack', 'iceprog'] : ['iverilog', 'vvp'])}`);

// The netlist is simulated against yosys's cells_sim.v, which gives some primitive inputs default
// values in the port list. Icarus Verilog reads that from version 12; with 11 (Ubuntu 22.04's
// package) every build fails with "Errors in port declarations", so refuse to start instead.
if (config.mode === 'sim') {
  const version = toolVersion('iverilog');
  const major = Number(/version (\d+)/i.exec(version ?? '')?.[1]);
  if (version === null || major < 12) {
    console.error(`[node] sim mode needs Icarus Verilog 12 or newer, found ${version === null ? 'none' : `"${version.trim()}"`}`);
    process.exit(1);
  }
  if (Number.isNaN(major)) console.warn(`[node] couldn't read the Icarus Verilog version from "${version.trim()}"; builds need 12 or newer`);
}

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
  });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'welcome') console.log(`[node] connected to ${config.server}, examiner key ${msg.fingerprint}`);
    else if (msg.type === 'rejected') {
      console.error(`[node] platform rejected this node: ${msg.reason}`);
      if (msg.retry) return; // another session for this node is still open; the close handler retries
      rejected = true;
      process.exit(1);
    } else if (msg.type === 'job') {
      // The attempt id names the work folder; without a sane one there's nothing to report back to
      if (typeof msg.attempt !== 'string' || !ID.test(msg.attempt)) {
        console.error('[node] ignored a job with a malformed attempt id');
        return;
      }
      queue.push(msg as Job);
      void drain();
    }
  });
  ws.on('close', () => {
    if (rejected) return;
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
  const log = (line: string) => {
    console.log(`  ${job.attempt} ${line}`);
    send({ type: 'log', attempt: job.attempt, line });
  };
  const stage = (s: string) => send({ type: 'status', attempt: job.attempt, stage: s });
  const fail = (s: string, message: string) => {
    log(`[node] ${message}`);
    send({ type: 'error', attempt: job.attempt, stage: s, message });
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
    const lint = lintStudentCode(job.code);
    if (lint) return fail('build', lint);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dut.v'), job.code);

    let verdict: SignedVerdict;
    if (config.mode === 'sim') {
      stage('build');
      const synthErr = await synthNetlist(dir, log);
      if (synthErr) return fail('build', synthErr);
      const compileErr = await compileSim(dir, job.challenge, log);
      if (compileErr) return fail('build', compileErr);

      stage('flash');
      log('[node] sim mode: no board on this node, loading the compiled model instead of flashing');

      stage('examine');
      const out = await examineSim(dir, job.nonce, meta.maxSeconds ?? 30, log);

      stage('sign');
      verdict = (examiner as SimExaminer).sign({
        attempt: job.attempt,
        challenge: job.challenge,
        node: config.node,
        nonce: job.nonce,
        measured: out.measured,
        result: out.result,
      });
    } else {
      stage('build');
      const buildErr = await buildIce40(dir, config.pcf, log);
      if (buildErr) return fail('build', buildErr);

      stage('flash');
      const flashErr = await flashIce40(dir, log);
      if (flashErr) return fail('flash', flashErr);

      stage('examine');
      verdict = await (examiner as SerialExaminer).run(
        { attempt: job.attempt, challenge: job.challenge, node: config.node, nonce: job.nonce },
        (l) => log(`[examiner] ${l}`),
        (meta.maxSeconds ?? 30) + 10,
      );
      stage('sign');
    }

    const p = JSON.parse(verdict.payload);
    log(`[examiner] signed ${p.result.toUpperCase()} with counter ${p.counter}`);
    send({ type: 'verdict', attempt: job.attempt, ...verdict });
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

connect();
