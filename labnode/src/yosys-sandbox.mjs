// Synthesizes untrusted Verilog with yosys compiled to WebAssembly (YoWASP), in a child
// process the caller can kill. The Wasm build sees only the files handed to it here, so
// `$readmemh("/etc/passwd")` or an `include of a host path finds nothing on the lender's PC.
//
//   node yosys-sandbox.mjs <work dir> netlist   dut.v -> synth.v, stat.txt, cells_sim.v
//   node yosys-sandbox.mjs <work dir> json      dut.v -> top.json, stat.txt
//
// netlist: the design as iCE40 primitives, for simulation. Only primitives survive, so the
// simulated design cannot print, read plusargs or end the run; it can only drive its pins.
// cells_sim.v is yosys's model of those primitives with the one file read ($readmemh of a
// RAM INIT_FILE) taken out. Plain .mjs so the agent and rtl/scripts can both spawn it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';

// Node 24 needs this for the Wasm build; older versions ignore it
v8.setFlagsFromString('--experimental-wasm-exnref');

const RECIPE = (write) => [
  'read_verilog -sv dut.v',
  'synth_ice40 -top top',
  // $display/assert have no hardware; they become $print/$check cells, so drop them
  'delete t:$print t:$check t:$scopeinfo',
  'setparam -unset INIT_FILE t:SB_RAM40_4K*',
  'opt_clean',
  'tee -q -o stat.txt stat',
  'select -assert-none t:* t:SB_* %d',
  'select top',
  write,
  'select -clear',
].join('; ');

const FLOWS = {
  netlist: { script: RECIPE('write_verilog -noattr -selected synth.v'), outputs: ['synth.v', 'stat.txt'], cells: true },
  json: { script: RECIPE('write_json -selected top.json'), outputs: ['top.json', 'stat.txt'], cells: false },
};

const TASKS_IN_CELLS = /\$(readmem|writemem|fopen|fclose|fread|fgets|fgetc|fscanf|fwrite|fdisplay|system|value\$plusargs|test\$plusargs|display|write|strobe|monitor|finish|stop|dump)\w*/;

// yosys's ice40/cells_sim.v from the same package, with the INIT_FILE read removed.
export function iceCellModels() {
  const gen = path.dirname(fileURLToPath(import.meta.resolve('@yowasp/yosys')));
  const tarName = fs.readdirSync(gen).find((f) => /-resources.*\.tar$/.test(f));
  if (!tarName) throw new Error('@yowasp/yosys resources not found');
  const tar = fs.readFileSync(path.join(gen, tarName));
  for (let off = 0; off + 512 <= tar.length; ) {
    const field = (a, b) => tar.subarray(off + a, off + b).toString('latin1').replace(/\0.*$/s, '');
    const name = field(0, 100);
    if (!name) break;
    const size = parseInt(field(124, 136).trim() || '0', 8);
    const full = [field(345, 500), name].filter(Boolean).join('/');
    if (full.replace(/^\.?\//, '') === 'ice40/cells_sim.v') {
      const text = tar.subarray(off + 512, off + 512 + size).toString('utf8');
      const clean = text.replace(/\$readmem[hb]\s*\([^;]*\);/g, ';');
      const code = clean.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
      const left = TASKS_IN_CELLS.exec(code);
      if (left) throw new Error(`cells_sim.v still calls ${left[0]}; refusing to use it`);
      return clean;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('ice40/cells_sim.v not found in the yosys resources');
}

async function main() {
  const [dir, flowName] = process.argv.slice(2);
  const flow = FLOWS[flowName];
  if (!dir || !flow) {
    console.error('usage: yosys-sandbox.mjs <work dir> netlist|json');
    process.exit(2);
  }
  const { runYosys, Exit } = await import('@yowasp/yosys');
  const write = (stream) => (bytes) => bytes && stream.write(bytes);
  const files = { 'dut.v': fs.readFileSync(path.join(dir, 'dut.v')) };
  let out;
  let code = 0;
  try {
    out = await runYosys(['-q', '-p', flow.script], files, {
      stdout: write(process.stdout),
      stderr: write(process.stderr),
      fetchProgress: () => {},
    });
  } catch (err) {
    if (!(err instanceof Exit)) throw err;
    code = err.code;
    out = err.files;
  }
  if (code === 0) {
    for (const name of flow.outputs) {
      const data = out?.[name];
      if (data === undefined || (typeof data === 'object' && !(data instanceof Uint8Array))) {
        console.error(`yosys did not produce ${name}`);
        code = 1;
        break;
      }
      fs.writeFileSync(path.join(dir, name), data);
    }
    if (code === 0 && flow.cells) fs.writeFileSync(path.join(dir, 'cells_sim.v'), iceCellModels());
  }
  // exitCode rather than exit(): Windows pipes flush asynchronously
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack ?? String(err));
    process.exit(3);
  });
}
