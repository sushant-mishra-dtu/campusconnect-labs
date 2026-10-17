# Hardware challenges

Every challenge targets the same board harness, so one lab node can run any of them without rewiring.

```verilog
module top (
    input  wire       clk,      // 12 MHz board oscillator
    input  wire [5:0] sw,       // driven by the examiner
    input  wire [1:0] btn,      // btn[0] = user button, btn[1] = synchronous reset (active high)
    output wire [7:0] led,      // read by the examiner
    input  wire       uart_rx,  // examiner -> FPGA
    output wire       uart_tx   // FPGA -> examiner
);
```

The examiner (an ESP32-S3 on real hardware, or the testbench in simulation) holds `btn[1]` high for at least 100 clock cycles before each test.

## Folder layout

```
challenges/<id>/
  challenge.json   metadata the platform reads (title, difficulty, skills)
  spec.md          what the student sees
  starter.v        compiles, does nothing useful
  reference.v      known-good solution, used by check-all and the seed script
  tb.v             simulation examiner: drives inputs, measures outputs, prints a verdict
boards/
  icebreaker.pcf   pin map for an iCEBreaker wired to the ESP32-S3 examiner
```

## Testbench output contract

The lab node agent parses three kinds of lines from `vvp`:

```
LOG <free text>                        shown in the student's live console
MEASURED <key> <one-line JSON object>  copied into the signed verdict as "measured"
RESULT <key> pass|fail                 the verdict
```

The nonce and the key arrive as plusargs: `vvp sim.vvp +nonce=9c41e2 +key=<16 hex digits>`. Every test derives its stimulus from the nonce, so a recorded output from one attempt is useless for the next. The key is random per run and only the testbench reads it; verdict lines without it are ignored.

The lab node simulates the testbench against the design's **synthesized iCE40 netlist** (`synth.v` plus yosys's `cells_sim.v`), not the source. A testbench must therefore only touch the harness ports, never internal signals of `dut`.

## Check everything

```bash
npm run check:rtl
```

This runs each `reference.v` (must pass) and each `starter.v` (must fail) through its testbench, the way a sim lab node does: synthesized by the sandboxed yosys, then the netlist simulated. `npm run check:rtl -- --rtl` simulates the source instead, which is faster while writing a challenge. It uses a native `iverilog` if one is on `PATH`, otherwise the one inside WSL.

```bash
npm run check:ice40
```

This builds each `reference.v` and `starter.v` for the real board, with the same sandboxed yosys → nextpnr-ice40 → icepack steps a hardware lab node runs (UP5K-SG48, `boards/icebreaker.pcf`, 12 MHz). Both must produce a bitstream that meets timing. Without `nextpnr-ice40` and `icepack` installed, it falls back to the WebAssembly builds from `npm install --no-save @yowasp/nextpnr-ice40`.
