// Runs open-source FPGA tools either natively or, on Windows, inside WSL.
// Student Verilog never reaches these tools directly: yosys runs it in a WebAssembly
// sandbox (sandboxedYosys below) and everything here only sees what that produces.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Runner = 'native' | 'wsl';

const cache = new Map<string, Runner | null>();

function probe(tool: string): Runner | null {
  if (cache.has(tool)) return cache.get(tool)!;
  let found: Runner | null = null;
  // Only ENOENT matters here; feed empty stdin so tools that read it (icepack) exit.
  const native = spawnSync(tool, ['-V'], { encoding: 'utf8', timeout: 5000, input: '' });
  if ((native.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') found = 'native';
  else if (process.platform === 'win32') {
    const r = spawnSync('wsl.exe', [...distroArgs(), '-e', 'which', tool], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) found = 'wsl';
  }
  cache.set(tool, found);
  return found;
}

function distroArgs() {
  return process.env.CCL_WSL_DISTRO ? ['-d', process.env.CCL_WSL_DISTRO] : [];
}

export function toolAvailable(tool: string) {
  return probe(tool) !== null;
}

export function describeTools(tools: string[]) {
  return tools.map((t) => `${t}: ${probe(t) ?? 'missing'}`).join(', ');
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type RunOpts = { timeoutSec: number; onLine?: (line: string, stream: 'out' | 'err') => void };

// Spawns `tool args...` in `cwd`, calling onLine for every output line.
export function runTool(tool: string, args: string[], cwd: string, opts: RunOpts): Promise<RunResult> {
  const runner = probe(tool);
  if (!runner) return Promise.resolve({ code: 127, stdout: '', stderr: `${tool} is not installed`, timedOut: false });
  if (runner === 'native') return runProcess(tool, args, cwd, opts);
  // `timeout` inside WSL, because killing wsl.exe does not always stop the Linux process
  return runProcess('wsl.exe', [...distroArgs(), '--cd', cwd, '-e', 'timeout', String(opts.timeoutSec), tool, ...args], undefined, opts, true);
}

const SANDBOX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'yosys-sandbox.mjs');

// yosys on student code, compiled to WebAssembly so it can't see the host filesystem.
// netlist: dut.v -> synth.v + cells_sim.v (for simulation). json: dut.v -> top.json (for nextpnr).
export function sandboxedYosys(dir: string, flow: 'netlist' | 'json', opts: RunOpts): Promise<RunResult> {
  return runProcess(process.execPath, [SANDBOX, dir, flow], dir, opts);
}

function runProcess(cmd: string, argv: string[], cwd: string | undefined, opts: RunOpts, wsl = false): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const bufs = { out: '', err: '' };

    const feed = (stream: 'out' | 'err', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'out') stdout += text;
      else stderr += text;
      bufs[stream] += text;
      const lines = bufs[stream].split(/\r?\n/);
      bufs[stream] = lines.pop() ?? '';
      for (const l of lines) opts.onLine?.(l, stream);
    };
    child.stdout.on('data', (c) => feed('out', c));
    child.stderr.on('data', (c) => feed('err', c));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, (opts.timeoutSec + 5) * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      for (const s of ['out', 'err'] as const) if (bufs[s]) opts.onLine?.(bufs[s], s);
      const wslTimeout = wsl && code === 124;
      resolve({ code: timedOut || wslTimeout ? null : code, stdout, stderr, timedOut: timedOut || wslTimeout });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(err), timedOut: false });
    });
  });
}
