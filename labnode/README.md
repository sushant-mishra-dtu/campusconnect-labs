# Lab node agent

Runs on the machine next to a lent FPGA board. It dials out to the platform over a WebSocket (so it works behind a college firewall), takes one job at a time, and relays the examiner's signed verdict. It never decides pass or fail itself.

```bash
npm run labnode                      # sim mode, node iiitd-01, local server
npm run labnode -- --info            # print the examiner id and public key
```

## Modes

| | `sim` (default) | `hw` |
|---|---|---|
| Board | none: the FPGA is simulated | a real iCE40 board |
| Build | sandboxed `yosys` → `nextpnr-ice40 --up5k` → `icepack` → `icepack -u` → `icebox_vlog`: the bitstream read back to Verilog | sandboxed `yosys` → `nextpnr-ice40 --up5k` → `icepack` |
| Flash | none: loads the readback into `iverilog` | `iceprog` |
| Examine | the challenge's `tb.v` against the readback; nonce and a per-run verdict key as plusargs | ESP32-S3 drives inputs and measures outputs on the real pins |
| Signing key | `labnode/keys/sim-<node>.pem`, on this machine | generated on the ESP32, never leaves it |
| Signed `target` | `bitstream` (`netlist` with `--sim-target=netlist`) | `fpga` |
| Shown on the platform as | Simulated, no physical FPGA | Verified on silicon (the operator enrolls the ESP32's key first) |

yosys (`@yowasp/yosys`) and, in sim mode, nextpnr-ice40 and icepack (`@yowasp/nextpnr-ice40`) come from npm as WebAssembly. `icebox_vlog` is vendored in `vendor/icebox` and needs Python 3 (`CRTL_PYTHON` if it isn't `python` on Windows or `python3` elsewhere). iverilog and the `hw` tools run natively, or inside WSL on Windows when they are not on `PATH`. Set `CRTL_WSL_DISTRO` to pick a distro. [docs/SIMULATION.md](../docs/SIMULATION.md) covers what the simulation does and doesn't model.

## Configuration

| Flag | Env | Default |
|---|---|---|
| `--server=` | `CRTL_SERVER` | `ws://localhost:4000/ws/node` |
| `--node=` | `CRTL_NODE` | `iiitd-01` |
| `--token=` | `CRTL_NODE_TOKEN` | contents of the file `CRTL_NODE_TOKEN_FILE` names, else of `keys/<node>.token` (written by `npm run seed`); no built-in token |
| `--mode=` | `CRTL_MODE` | `sim` |
| `--sim-target=` | `CRTL_SIM_TARGET` | `bitstream` (or `netlist`: skip place and route, simulate yosys's netlist) |
| `--serial=` | `CRTL_SERIAL` | none (required for `hw`, e.g. `COM5` or `/dev/ttyACM0`) |
| `--pcf=` | `CRTL_PCF` | `rtl/boards/icebreaker.pcf` |

Sim mode needs Icarus Verilog 12 or newer; the agent refuses to start on an older one. To run the node in Docker, see [docs/DEPLOY.md](../docs/DEPLOY.md).

## Pairing and key pinning

A node's token opens a 24-hour pairing window. The first examiner key the node presents inside it is pinned, and the window closes; after that a different key is refused, and a second session for the same node is turned away while the first is connected (the agent retries). If you delete `labnode/keys/` or swap the board, the operator runs `npm run admin -w server -- unpin <node>`, which reopens pairing.

The platform doesn't take the node's word for its `kind`. A key counts as an ESP32 only if the operator enrolled it out of band, and an `hw` node whose ESP32 isn't enrolled is refused when it connects. Enroll before the first `--mode=hw` run:

```bash
npm run examiner:info -w labnode -- --mode=hw --serial=COM5 > examiner.pem   # print the ESP32's public key
npm run admin -w server -- enroll iiitd-01 examiner.pem "IIIT Delhi robotics bench"
```

## What a job looks like

```
received → build → flash → examine → sign → (platform) verify
```

Each stage and every tool output line is streamed to the student's live console.

## Running other people's code

Student Verilog runs on a lender's PC, so nothing native ever parses it:

- **yosys runs as WebAssembly** (`src/yosys-sandbox.mjs`), in a child process with a timeout. Its filesystem holds only `dut.v`, so `$readmemh("/etc/passwd")` or an `` `include `` of a host path finds nothing.
- **Only what is decoded from the bitstream is simulated.** yosys drops `$display`/assertion cells and the build fails unless every remaining cell is an iCE40 primitive. nextpnr and icepack (WebAssembly) turn that into `top.bin`, and `icebox_vlog` rebuilds Verilog from the configuration bits alone, so no name or text from the student's source survives. The primitives' models come from yosys's own `cells_sim.v`, with its one file read (`$readmemh` of a RAM `INIT_FILE`) removed. So the design can't print, read plusargs or end the run. Like on hardware, it can only drive its pins. Designs using blocks the readback can't decode faithfully (DSP, SPRAM, oscillators, PLLs, hard IP) are refused.
- **The testbench tags its verdict.** `RESULT` and `MEASURED` lines carry a random key passed only to this run's testbench; lines without it are ignored.
- nextpnr and icepack only see yosys's netlist; icebox_vlog, iverilog and vvp only see what was unpacked from the bitstream.

The lint in `src/lint.ts` (must define `module top`; no file tasks, `$finish` or `` `include ``) is there for friendly early errors, not as the boundary.
