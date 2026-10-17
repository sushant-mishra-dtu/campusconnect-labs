// Real board: yosys (sandboxed) -> nextpnr-ice40 -> icepack -> iceprog, for an iCE40 UP5K (SG48).
// Only yosys reads the student's source; nextpnr and icepack see the netlist it wrote.
import fs from 'node:fs';
import path from 'node:path';
import { runTool, sandboxedYosys } from '../hdl.js';
import { logStat } from './sim.js';

type Log = (line: string) => void;

const steps = (pcf: string): [string, string[], number][] => [
  ['nextpnr-ice40', ['--up5k', '--package', 'sg48', '--freq', '12', '--pcf', pcf, '--json', 'top.json', '--asc', 'top.asc', '-q'], 180],
  ['icepack', ['top.asc', 'top.bin'], 30],
];

export async function buildIce40(dir: string, pcfPath: string, log: Log): Promise<string | null> {
  log('[yosys] synth_ice40 -top top (sandboxed)');
  const y = await sandboxedYosys(dir, 'json', { timeoutSec: 120, onLine: (l) => l.trim() && log(`[yosys] ${l}`) });
  if (y.timedOut) return 'yosys timed out';
  if (y.code !== 0) return 'yosys failed';
  logStat(dir, log);

  fs.copyFileSync(pcfPath, path.join(dir, 'board.pcf'));
  for (const [tool, args, timeoutSec] of steps('board.pcf')) {
    log(`[${tool}] ${args.join(' ')}`);
    const r = await runTool(tool, args, dir, { timeoutSec, onLine: (l) => l.trim() && log(`[${tool}] ${l}`) });
    if (r.timedOut) return `${tool} timed out`;
    if (r.code !== 0) return `${tool} failed`;
  }
  return null;
}

export async function flashIce40(dir: string, log: Log): Promise<string | null> {
  log('[iceprog] writing top.bin to the board');
  const r = await runTool('iceprog', ['top.bin'], dir, { timeoutSec: 60, onLine: (l) => l.trim() && log(`[iceprog] ${l}`) });
  if (r.timedOut) return 'iceprog timed out';
  return r.code === 0 ? null : 'iceprog failed (is the board plugged in?)';
}
