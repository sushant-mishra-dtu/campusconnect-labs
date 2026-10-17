// Runs every challenge's reference (must pass) and starter (must fail) through its testbench.
// Usage: node rtl/scripts/check-all.mjs [challenge-id] [--nonce=hex]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const challengesDir = path.resolve(here, '..', 'challenges');

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'));
const nonceArg = args.find((a) => a.startsWith('--nonce='));
const nonce = nonceArg ? nonceArg.slice(8) : '9c41e2';

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
  const build = tool(work, 'iverilog', ['-g2012', '-s', 'tb', '-o', 'sim.vvp', 'tb.v', 'dut.v']);
  if (build.status !== 0) return { result: 'build-error', out: build.stderr || build.stdout, ms: Date.now() - t0 };
  const sim = tool(work, 'vvp', ['-n', 'sim.vvp', `+nonce=${nonce}`]);
  const out = sim.stdout ?? '';
  const result = /^RESULT (pass|fail)/m.exec(out)?.[1] ?? 'no-result';
  const measured = /^MEASURED (.*)$/m.exec(out)?.[1] ?? '';
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    // WSL can hold the folder open for a moment; the OS temp cleaner will get it
  }
  return { result, measured, out, ms: Date.now() - t0 };
}

const ids = fs.readdirSync(challengesDir).filter((d) => !only || d === only);
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
