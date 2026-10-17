// Runs every challenge's reference (must pass) and starter (must fail) through its testbench.
// By default each design goes the way a sim lab node runs it: synthesized for iCE40 in the
// yosys sandbox, then the gate-level netlist is simulated. --rtl simulates the source instead.
// Usage: node rtl/scripts/check-all.mjs [challenge-id] [--nonce=hex] [--rtl]
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const challengesDir = path.resolve(here, '..', 'challenges');
const sandbox = path.resolve(here, '..', '..', 'labnode', 'src', 'yosys-sandbox.mjs');

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'));
const nonceArg = args.find((a) => a.startsWith('--nonce='));
const nonce = nonceArg ? nonceArg.slice(8) : '9c41e2';
const rtl = args.includes('--rtl');

function hasNative() {
  const r = spawnSync('iverilog', ['-V'], { encoding: 'utf8' });
  return r.status === 0 || (r.stdout ?? '').includes('Icarus');
}

const native = hasNative();
if (!native && process.platform !== 'win32') {
  console.error('iverilog not found on PATH');
  process.exit(2);
}

function tool(cwd, cmd, toolArgs) {
  if (native) return spawnSync(cmd, toolArgs, { cwd, encoding: 'utf8' });
  const distro = process.env.CCL_WSL_DISTRO ? ['-d', process.env.CCL_WSL_DISTRO] : [];
  return spawnSync('wsl.exe', [...distro, '--cd', cwd, '-e', cmd, ...toolArgs], { encoding: 'utf8' });
}

function runOne(id, file) {
  const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), `ccl-${id}-`));
  fs.copyFileSync(path.join(challengesDir, id, 'tb.v'), path.join(work, 'tb.v'));
  fs.copyFileSync(path.join(challengesDir, id, file), path.join(work, 'dut.v'));
  const t0 = Date.now();
  const done = (r) => {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      // WSL can hold the folder open for a moment; the OS temp cleaner will get it
    }
    return { ...r, ms: Date.now() - t0 };
  };
  let sources = ['dut.v'];
  if (!rtl) {
    const y = spawnSync(process.execPath, [sandbox, work, 'netlist'], { encoding: 'utf8' });
    if (y.status !== 0) return done({ result: 'synth-error', out: (y.stdout ?? '') + (y.stderr ?? '') });
    sources = ['synth.v', 'cells_sim.v'];
  }
  const build = tool(work, 'iverilog', ['-g2012', '-s', 'tb', '-o', 'sim.vvp', 'tb.v', ...sources]);
  if (build.status !== 0) return done({ result: 'build-error', out: build.stderr || build.stdout });
  const key = crypto.randomBytes(8).toString('hex');
  const sim = tool(work, 'vvp', ['-n', 'sim.vvp', `+nonce=${nonce}`, `+key=${key}`]);
  const out = sim.stdout ?? '';
  const result = new RegExp(`^RESULT ${key} (pass|fail)`, 'm').exec(out)?.[1] ?? 'no-result';
  const measured = new RegExp(`^MEASURED ${key} (.*)$`, 'm').exec(out)?.[1] ?? '';
  return done({ result, measured, out });
}

const ids = fs.readdirSync(challengesDir).filter((d) => !only || d === only);
console.log(rtl ? 'simulating the RTL source' : 'simulating the synthesized iCE40 netlist (what a sim lab node runs)');
let failures = 0;
for (const id of ids) {
  for (const [file, want] of [['reference.v', 'pass'], ['starter.v', 'fail']]) {
    const r = runOne(id, file);
    const ok = r.result === want;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(18)} ${file.padEnd(12)} -> ${r.result.padEnd(6)} ${String(r.ms).padStart(6)} ms  ${r.measured ?? ''}`);
    if (!ok || process.env.VERBOSE) console.log(r.out);
  }
}
process.exit(failures ? 1 : 0);
