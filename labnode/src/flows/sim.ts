// No board attached. By default the design is built all the way to the iCE40 bitstream a board
// would be flashed with, that bitstream is read back to Verilog, and the challenge testbench
// runs in iverilog against the readback (target "bitstream"). With --sim-target=netlist it runs
// against yosys's gate-level netlist instead. Either way the simulated design is only iCE40
// primitives, so it cannot print a verdict, read the nonce plusarg or end the run early: like
// on hardware, all it can do is drive its pins.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHALLENGES_DIR } from '../config.js';
import { bitstreamReadback, runTool, sandboxedYosys } from '../hdl.js';

type Log = (line: string) => void;

// yosys `stat` prints "count  cell" (newer) or "cell  count" (older)
export function parseStat(text: string) {
  const cells: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(SB_\w+)\s*$/.exec(line) ?? /^\s*(SB_\w+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const [n, name] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    cells[name] = Number(n);
  }
  const dffs = Object.entries(cells).reduce((s, [k, v]) => (k.startsWith('SB_DFF') ? s + v : s), 0);
  return { luts: cells.SB_LUT4 ?? 0, dffs, carries: cells.SB_CARRY ?? 0 };
}

export function logStat(dir: string, log: Log) {
  const statPath = path.join(dir, 'stat.txt');
  if (!fs.existsSync(statPath)) return;
  const s = parseStat(fs.readFileSync(statPath, 'utf8'));
  log(`[yosys] fits in UP5K: ${s.luts} LUT4 / 5280, ${s.dffs} DFF, ${s.carries} carry`);
}

export async function synthNetlist(dir: string, log: Log): Promise<string | null> {
  log('[yosys] synth_ice40 -top top (sandboxed), writing the gate-level netlist');
  const r = await sandboxedYosys(dir, 'netlist', {
    timeoutSec: 90,
    onLine: (l) => l.trim() && log(`[yosys] ${l}`),
  });
  if (r.timedOut) return 'synthesis timed out';
  if (r.code !== 0) return 'synthesis failed';
  logStat(dir, log);
  return null;
}

export async function buildReadback(dir: string, pcf: string, log: Log): Promise<string | null> {
  log('[yosys] synth_ice40 -top top (sandboxed)');
  const y = await sandboxedYosys(dir, 'json', { timeoutSec: 90, onLine: (l) => l.trim() && log(`[yosys] ${l}`) });
  if (y.timedOut) return 'synthesis timed out';
  if (y.code !== 0) return 'synthesis failed';
  logStat(dir, log);
  const r = await bitstreamReadback(dir, pcf, { timeoutSec: 240, onLine: (l, stream) => stream === 'out' && l.trim() && log(l) });
  if (r.timedOut) return 'place and route timed out';
  if (r.code !== 0) return r.stderr.trim().split(/\r?\n/).pop() || 'building the bitstream failed';
  return null;
}

export const SIM_SOURCES = { netlist: ['synth.v', 'cells_sim.v'], bitstream: ['readback.v', 'cells_sim.v'] };

export async function compileSim(dir: string, testId: string, target: keyof typeof SIM_SOURCES, log: Log): Promise<string | null> {
  fs.copyFileSync(path.join(CHALLENGES_DIR, testId, 'tb.v'), path.join(dir, 'tb.v'));
  log(`[iverilog] compiling the ${target === 'bitstream' ? 'bitstream readback' : 'netlist'} with the examiner testbench`);
  const r = await runTool('iverilog', ['-g2012', '-s', 'tb', '-o', 'sim.vvp', 'tb.v', ...SIM_SOURCES[target]], dir, {
    timeoutSec: 60,
    onLine: (l) => l.trim() && log(`[iverilog] ${l}`),
  });
  if (r.timedOut) return 'compile timed out';
  return r.code === 0 ? null : 'compile failed';
}

export interface SimOutcome {
  result: 'pass' | 'fail';
  measured: Record<string, unknown>;
}

// The testbench tags its verdict lines with a key passed as a plusarg for this run only.
// The netlist can't print anyway; the key means a line it somehow printed still wouldn't count.
export async function examineSim(dir: string, nonce: string, timeoutSec: number, log: Log): Promise<SimOutcome> {
  const key = crypto.randomBytes(8).toString('hex');
  let result: 'pass' | 'fail' | null = null;
  let measured: Record<string, unknown> = {};
  const r = await runTool('vvp', ['-n', 'sim.vvp', `+nonce=${nonce}`, `+key=${key}`], dir, {
    timeoutSec,
    onLine: (line, stream) => {
      if (stream !== 'out') return;
      if (line.startsWith('LOG ')) log(`[examiner] ${line.slice(4)}`);
      else if (line.startsWith(`MEASURED ${key} `) && result === null) {
        const text = line.slice(`MEASURED ${key} `.length).trim();
        try {
          measured = JSON.parse(text);
        } catch {
          measured = { raw: text };
        }
        log(`[examiner] measured ${text}`);
      } else if (line.startsWith(`RESULT ${key} `) && result === null) {
        result = line.slice(`RESULT ${key} `.length).trim() === 'pass' ? 'pass' : 'fail';
      } else if (/^(RESULT|MEASURED)\b/.test(line)) {
        log('[examiner] ignored a verdict line without this run’s key');
      }
    },
  });
  if (r.timedOut) {
    log('[examiner] the design ran past the time limit');
    return { result: 'fail', measured: { ...measured, timeout: true } };
  }
  return { result: result ?? 'fail', measured };
}
