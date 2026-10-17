// No board attached: synthesize for iCE40 with yosys (so non-synthesizable designs still
// fail, exactly as they would on hardware), then run the challenge testbench in iverilog.
import fs from 'node:fs';
import path from 'node:path';
import { CHALLENGES_DIR } from '../config.js';
import { runTool, toolAvailable } from '../hdl.js';

type Log = (line: string) => void;

function parseStat(text: string) {
  const pick = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
  const luts = pick(/SB_LUT4\s+(\d+)/);
  const carries = pick(/SB_CARRY\s+(\d+)/);
  const dffs = [...text.matchAll(/SB_DFF\w*\s+(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  return { luts, dffs, carries };
}

export async function synthCheck(dir: string, log: Log): Promise<string | null> {
  if (!toolAvailable('yosys')) {
    log('[yosys] not installed on this node, skipping the synthesis check');
    return null;
  }
  log('[yosys] synth_ice40 -top top');
  const r = await runTool('yosys', ['-q', '-p', 'read_verilog -sv dut.v; synth_ice40 -top top; tee -q -o stat.txt stat'], dir, {
    timeoutSec: 90,
    onLine: (l) => l.trim() && log(`[yosys] ${l}`),
  });
  if (r.timedOut) return 'synthesis timed out';
  if (r.code !== 0) return 'synthesis failed';
  const statPath = path.join(dir, 'stat.txt');
  if (fs.existsSync(statPath)) {
    const s = parseStat(fs.readFileSync(statPath, 'utf8'));
    log(`[yosys] fits in UP5K: ${s.luts} LUT4 / 5280, ${s.dffs} DFF, ${s.carries} carry`);
  }
  return null;
}

export async function compileSim(dir: string, testId: string, log: Log): Promise<string | null> {
  fs.copyFileSync(path.join(CHALLENGES_DIR, testId, 'tb.v'), path.join(dir, 'tb.v'));
  log('[iverilog] compiling design with the examiner testbench');
  const r = await runTool('iverilog', ['-g2012', '-s', 'tb', '-o', 'sim.vvp', 'tb.v', 'dut.v'], dir, {
    timeoutSec: 30,
    onLine: (l) => l.trim() && log(`[iverilog] ${l}`),
  });
  if (r.timedOut) return 'compile timed out';
  return r.code === 0 ? null : 'compile failed';
}

export interface SimOutcome {
  result: 'pass' | 'fail';
  measured: Record<string, unknown>;
}

export async function examineSim(dir: string, nonce: string, timeoutSec: number, log: Log): Promise<SimOutcome> {
  let result: 'pass' | 'fail' | null = null;
  let measured: Record<string, unknown> = {};
  const r = await runTool('vvp', ['-n', 'sim.vvp', `+nonce=${nonce}`], dir, {
    timeoutSec,
    onLine: (line) => {
      if (line.startsWith('LOG ')) log(`[examiner] ${line.slice(4)}`);
      else if (line.startsWith('MEASURED ')) {
        const text = line.slice(9).trim();
        try {
          measured = JSON.parse(text);
        } catch {
          measured = { raw: text };
        }
        log(`[examiner] measured ${text}`);
      } else if (line.startsWith('RESULT ')) result = line.slice(7).trim() === 'pass' ? 'pass' : 'fail';
    },
  });
  if (r.timedOut) {
    log('[examiner] the design ran past the time limit');
    return { result: 'fail', measured: { ...measured, timeout: true } };
  }
  return { result: result ?? 'fail', measured };
}
