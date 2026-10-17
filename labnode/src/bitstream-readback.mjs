// Builds the real iCE40 bitstream from yosys's top.json, then turns that bitstream back into
// Verilog so the examiner testbench can run against exactly what a board would be flashed with.
//
//   node bitstream-readback.mjs <work dir> <pcf>
//
//   top.json -> nextpnr-ice40 (UP5K, SG48, 12 MHz) -> top.asc -> icepack -> top.bin
//            -> icepack -u -> readback.asc -> icebox_vlog -> readback.v (+ cells_sim.v)
//
// The readback starts from top.bin, which holds configuration bits only, so nothing the
// student wrote (names, attributes, $display) survives into readback.v. nextpnr and icepack
// are the YoWASP WebAssembly builds, so like yosys they see only the files handed to them.
// icebox_vlog (Project IceStorm, vendored under labnode/vendor/icebox) needs Python 3:
// set CCL_PYTHON if it isn't `python` on Windows or `python3` elsewhere.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { iceCellModels } from './yosys-sandbox.mjs';

// Node 24 needs this for the Wasm build; older versions ignore it
v8.setFlagsFromString('--experimental-wasm-exnref');

const ICEBOX_VLOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'icebox', 'icebox_vlog.py');

// Cells the readback turns back into Verilog that simulates like the silicon. icebox_vlog
// only half-models DSPs and leaves out SPRAM, oscillators and the hard IP, so a design that
// uses them is refused rather than examined against a model that isn't the chip.
const MODELLED = /^SB_(LUT4|CARRY|DFF\w*|RAM40_4K\w*|IO|GB|GB_IO)$/;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function checkCells(dir) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'top.json'), 'utf8'));
  const types = new Set();
  for (const mod of Object.values(json.modules ?? {})) for (const cell of Object.values(mod.cells ?? {})) types.add(cell.type);
  const unmodelled = [...types].filter((t) => !MODELLED.test(t)).sort();
  if (unmodelled.length) {
    fail(`the bitstream readback can't simulate ${unmodelled.join(', ')}; use LUTs, flip-flops, carries and block RAM only`);
  }
}

async function yowasp(dir, tool, args) {
  const { commands, Exit } = await import('@yowasp/nextpnr-ice40');
  const files = {};
  for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).isFile()) files[f] = fs.readFileSync(path.join(dir, f));
  let log = '';
  const sink = (bytes) => {
    if (bytes) log += new TextDecoder().decode(bytes);
  };
  let out;
  let code = 0;
  try {
    out = await commands[tool](args, files, { stdout: sink, stderr: sink, fetchProgress: () => {} });
  } catch (err) {
    if (!(err instanceof Exit)) throw err;
    code = err.code;
    out = err.files;
  }
  for (const [name, data] of Object.entries(out ?? {})) {
    // text outputs (top.asc) come back as strings, binary ones (top.bin) as bytes
    if ((typeof data === 'string' || data instanceof Uint8Array) && !(name in files)) fs.writeFileSync(path.join(dir, name), data);
  }
  return { code, log };
}

// icebox_vlog declares the ports ANSI-style and then declares some of them again as wires or
// regs, which Verilog only allows with non-ANSI ports. Move the directions into the body.
export function nonAnsiPorts(verilog) {
  const m = /module (\w+) \(([^)]*)\);/.exec(verilog);
  if (!m) throw new Error('icebox_vlog output has no module header');
  const ports = m[2].split(',').map((p) => {
    const pm = /^\s*(input|output|inout)\s*(\[[^\]]*\])?\s*(\S+)\s*$/.exec(p);
    if (!pm) throw new Error(`unexpected port in icebox_vlog output: ${p.trim()}`);
    return { dir: pm[1], range: pm[2] ? `${pm[2]} ` : '', name: pm[3] };
  });
  // trailing spaces end escaped identifiers like \led
  const header = `module ${m[1]} (${ports.map((p) => `${p.name} `).join(', ')});\n${ports.map((p) => `${p.dir} ${p.range}${p.name} ;`).join('\n')}`;
  return verilog.slice(0, m.index) + header + verilog.slice(m.index + m[0].length);
}

function python() {
  return process.env.CCL_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
}

async function main() {
  const [dir, pcf] = process.argv.slice(2);
  if (!dir || !pcf) {
    console.error('usage: bitstream-readback.mjs <work dir> <pcf>');
    process.exit(2);
  }
  checkCells(dir);
  fs.copyFileSync(pcf, path.join(dir, 'board.pcf'));

  console.log('[nextpnr-ice40] --up5k --package sg48 --freq 12 --pcf board.pcf');
  const pnr = await yowasp(dir, 'nextpnr-ice40', ['--up5k', '--package', 'sg48', '--freq', '12', '--pcf', 'board.pcf', '--json', 'top.json', '--asc', 'top.asc']);
  const lc = /ICESTORM_LC:\s+(\d+)\/\s*(\d+)/.exec(pnr.log);
  if (lc) console.log(`[nextpnr-ice40] placed ${lc[1]} of ${lc[2]} logic cells`);
  // nextpnr reports Fmax after placement and again after routing; the last one counts
  const fmax = [...pnr.log.matchAll(/Max frequency for clock\s+'[^']+':\s+([\d.]+) MHz \((PASS|FAIL)/g)].pop();
  if (fmax) console.log(`[nextpnr-ice40] routed Fmax ${fmax[1]} MHz, ${fmax[2] === 'PASS' ? 'meets' : 'misses'} the 12 MHz board clock`);
  if (pnr.code !== 0) {
    for (const l of pnr.log.split(/\r?\n/).filter((x) => /error/i.test(x)).slice(0, 10)) console.log(`[nextpnr-ice40] ${l}`);
    fail(fmax?.[2] === 'FAIL' ? 'the design does not meet 12 MHz after routing' : 'place and route failed');
  }

  console.log('[icepack] top.asc -> top.bin');
  if ((await yowasp(dir, 'icepack', ['top.asc', 'top.bin'])).code !== 0) fail('icepack failed');
  console.log(`[icepack] bitstream ${fs.statSync(path.join(dir, 'top.bin')).size} bytes; unpacking it again for the readback`);
  if ((await yowasp(dir, 'icepack', ['-u', 'top.bin', 'readback.asc'])).code !== 0) fail('icepack -u failed');

  console.log('[icebox_vlog] bitstream -> Verilog');
  const r = spawnSync(python(), [ICEBOX_VLOG, '-s', '-c', '-n', 'top', '-d', 'sg48', '-p', 'board.pcf', 'readback.asc'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) fail(`could not run ${python()} for icebox_vlog (${r.error.message}); install Python 3 or set CCL_PYTHON`);
  if (r.status !== 0) fail(`icebox_vlog failed: ${(r.stderr ?? '').trim().split(/\r?\n/).pop()}`);
  fs.writeFileSync(path.join(dir, 'readback.v'), nonAnsiPorts(r.stdout));
  fs.writeFileSync(path.join(dir, 'cells_sim.v'), iceCellModels());
  console.log(`[icebox_vlog] readback.v: ${r.stdout.split('\n').length} lines rebuilt from the bitstream`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack ?? String(err));
    process.exit(3);
  });
}
