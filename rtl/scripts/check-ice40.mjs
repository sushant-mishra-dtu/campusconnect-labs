// Builds every challenge for the real board, with the same steps as labnode/src/flows/ice40.ts:
// yosys (the lab node's WebAssembly sandbox) -> nextpnr-ice40 (UP5K, SG48, iCEBreaker pin map,
// 12 MHz) -> icepack. Reference and starter must both produce a bitstream that meets timing,
// since either can be flashed.
// Usage: node rtl/scripts/check-ice40.mjs [challenge-id]
//
// nextpnr-ice40 and icepack come from PATH or WSL when installed; otherwise the YoWASP builds
// are used if present (no sudo needed): npm install --no-save @yowasp/nextpnr-ice40
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const challengesDir = path.resolve(here, '..', 'challenges');
const pcfPath = path.resolve(here, '..', 'boards', 'icebreaker.pcf');
const sandbox = path.resolve(here, '..', '..', 'labnode', 'src', 'yosys-sandbox.mjs');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const distro = process.env.CCL_WSL_DISTRO ? ['-d', process.env.CCL_WSL_DISTRO] : [];

function probe(tool) {
  const native = spawnSync(tool, ['-V'], { encoding: 'utf8', input: '' });
  if (native.error?.code !== 'ENOENT') return 'native';
  if (process.platform !== 'win32') return null;
  const r = spawnSync('wsl.exe', [...distro, '-e', 'which', tool], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? 'wsl' : null;
}

let yowasp = null;
async function loadYowasp() {
  // Node 24 needs this for the Wasm build; older versions just print a warning for an unknown flag
  v8.setFlagsFromString('--experimental-wasm-exnref');
  try {
    yowasp = await import('@yowasp/nextpnr-ice40');
  } catch {
    return false;
  }
  return true;
}

const runners = { yosys: 'sandbox' };
for (const tool of ['nextpnr-ice40', 'icepack']) runners[tool] = probe(tool);
if ((!runners['nextpnr-ice40'] || !runners.icepack) && (await loadYowasp())) {
  runners['nextpnr-ice40'] ??= 'yowasp';
  runners.icepack ??= 'yowasp';
}
if (!runners['nextpnr-ice40'] || !runners.icepack) {
  console.error('nextpnr-ice40 / icepack not found. Install them (apt: nextpnr-ice40 fpga-icestorm, or the OSS CAD Suite),');
  console.error('or get the WebAssembly builds: npm install --no-save @yowasp/nextpnr-ice40');
  process.exit(2);
}
console.log(Object.entries(runners).map(([t, r]) => `${t}: ${r}`).join(', '));

// Runs a tool in `work` and returns { code, log }.
async function run(tool, args, work) {
  if (runners[tool] === 'sandbox') {
    const r = spawnSync(process.execPath, [sandbox, work, ...args], { encoding: 'utf8' });
    return { code: r.status, log: (r.stdout ?? '') + (r.stderr ?? '') };
  }
  if (runners[tool] === 'yowasp') {
    const files = {};
    for (const f of fs.readdirSync(work)) files[f] = fs.readFileSync(path.join(work, f));
    let log = '';
    const sink = (b) => {
      if (b) log += new TextDecoder().decode(b);
    };
    let code = 0;
    let out;
    try {
      out = await yowasp.commands[tool](args, files, { stdout: sink, stderr: sink });
    } catch (e) {
      if (!(e instanceof yowasp.Exit)) throw e;
      code = e.code;
      out = e.files;
    }
    for (const [f, data] of Object.entries(out ?? {})) if (!(f in files)) fs.writeFileSync(path.join(work, f), data);
    return { code, log };
  }
  const r =
    runners[tool] === 'native'
      ? spawnSync(tool, args, { cwd: work, encoding: 'utf8' })
      : spawnSync('wsl.exe', [...distro, '--cd', work, '-e', tool, ...args], { encoding: 'utf8' });
  return { code: r.status, log: (r.stdout ?? '') + (r.stderr ?? '') };
}

async function buildOne(id, file) {
  const work = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), `ccl-ice40-${id}-`));
  fs.copyFileSync(path.join(challengesDir, id, file), path.join(work, 'dut.v'));
  fs.copyFileSync(pcfPath, path.join(work, 'board.pcf'));
  const t0 = Date.now();
  const steps = [
    ['yosys', ['json']],
    // -q left off so nextpnr prints utilisation and timing
    ['nextpnr-ice40', ['--up5k', '--package', 'sg48', '--freq', '12', '--pcf', 'board.pcf', '--json', 'top.json', '--asc', 'top.asc']],
    ['icepack', ['top.asc', 'top.bin']],
  ];
  const res = { ms: 0, lc: '-', fmax: '-', warnings: [], error: '' };
  for (const [tool, args] of steps) {
    const r = await run(tool, args, work);
    if (tool === 'nextpnr-ice40') {
      res.lc = /ICESTORM_LC:\s+(\d+\/\s*\d+)/.exec(r.log)?.[1].replace(/\s/g, '') ?? '?';
      // nextpnr reports Fmax after placement and again after routing; the last one counts
      const fmax = [...r.log.matchAll(/Max frequency for clock\s+'[^']+':\s+([\d.]+) MHz \((PASS|FAIL)/g)].pop();
      res.fmax = fmax ? `${fmax[1]} MHz` : 'no clock';
      res.warnings = r.log.split(/\r?\n/).filter((l) => l.startsWith('Warning'));
      if (fmax?.[2] === 'FAIL') {
        res.error = '     misses 12 MHz';
        break;
      }
    }
    if (r.code !== 0) {
      const lines = r.log.split(/\r?\n/).filter((l) => l.trim());
      const errors = lines.filter((l) => /error/i.test(l));
      res.error = [`     ${tool} failed`, ...(errors.length ? errors : lines.slice(-15)).map((l) => `     ${l}`)].join('\n');
      break;
    }
  }
  if (!res.error && !fs.existsSync(path.join(work, 'top.bin'))) res.error = 'no top.bin';
  res.bytes = res.error ? 0 : fs.statSync(path.join(work, 'top.bin')).size;
  res.ms = Date.now() - t0;
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    // WSL can hold the folder open for a moment; the OS temp cleaner will get it
  }
  return res;
}

const ids = fs.readdirSync(challengesDir).filter((d) => !only || d === only);
let failures = 0;
for (const id of ids) {
  for (const file of ['reference.v', 'starter.v']) {
    const r = await buildOne(id, file);
    if (r.error) failures++;
    console.log(
      `${r.error ? 'FAIL' : 'ok  '} ${id.padEnd(18)} ${file.padEnd(12)} ${`${r.lc} LC`.padEnd(12)} ${r.fmax.padEnd(12)} ${String(r.bytes).padStart(6)} B ${String(r.ms).padStart(6)} ms`,
    );
    for (const w of r.warnings) console.log(`     ${w}`);
    if (r.error) console.log(r.error);
  }
}
process.exit(failures ? 1 : 0);
