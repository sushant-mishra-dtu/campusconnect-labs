// No board attached: synthesize for iCE40 in the yosys sandbox, then run the challenge
// testbench in iverilog against the synthesized netlist, not the source. The netlist is
// only iCE40 primitives, so the design cannot print a verdict, read the nonce plusarg or
// end the run early: like on hardware, all it can do is drive its pins.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHALLENGES_DIR } from '../config.js';
import { runTool, sandboxedYosys } from '../hdl.js';

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

export async function compileSim(dir: string, testId: string, log: Log): Promise<string | null> {
  fs.copyFileSync(path.join(CHALLENGES_DIR, testId, 'tb.v'), path.join(dir, 'tb.v'));
  log('[iverilog] compiling the netlist with the examiner testbench');
  const r = await runTool('iverilog', ['-g2012', '-s', 'tb', '-o', 'sim.vvp', 'tb.v', 'synth.v', 'cells_sim.v'], dir, {
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
