# Lab node agent

Runs on the machine next to a lent FPGA board. It dials out to the platform over a WebSocket (so it works behind a college firewall), takes one job at a time, and relays the examiner's signed verdict. It never decides pass or fail itself.

```bash
npm run labnode                      # sim mode, node iiitd-01, local server
npm run labnode -- --info            # print the examiner id and public key
```

## Modes

| | `sim` (default) | `hw` |
|---|---|---|
| Build | sandboxed `yosys synth_ice40` → gate-level netlist, then `iverilog` | sandboxed `yosys` → `nextpnr-ice40 --up5k` → `icepack` |
| Flash | none: loads the compiled model | `iceprog` |
| Examine | the challenge's `tb.v` against the netlist; nonce and a per-run verdict key as plusargs | ESP32-S3 drives inputs and measures outputs on the real pins |
| Signing key | `labnode/keys/sim-<node>.pem`, on this machine | generated on the ESP32, never leaves it |
| Shown on the platform as | Verified in simulation | Verified on silicon (the operator enrolls the ESP32's key first) |

yosys is `@yowasp/yosys` from npm (WebAssembly). The other tools run natively, or inside WSL on Windows when they are not on `PATH`. Set `CCL_WSL_DISTRO` to pick a distro.

## Configuration

| Flag | Env | Default |
|---|---|---|
| `--server=` | `CCL_SERVER` | `ws://localhost:4000/ws/node` |
| `--node=` | `CCL_NODE` | `iiitd-01` |
| `--token=` | `CCL_NODE_TOKEN` | contents of `keys/<node>.token` (written by `npm run seed`); no built-in token |
| `--mode=` | `CCL_MODE` | `sim` |
| `--serial=` | `CCL_SERIAL` | none (required for `hw`, e.g. `COM5` or `/dev/ttyACM0`) |
| `--pcf=` | `CCL_PCF` | `rtl/boards/icebreaker.pcf` |

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
- **Only the synthesized netlist is simulated.** yosys drops `$display`/assertion cells and the build fails unless every remaining cell is an iCE40 primitive. The primitives' models come from yosys's own `cells_sim.v`, with its one file read (`$readmemh` of a RAM `INIT_FILE`) removed. So the design can't print, read plusargs or end the run. Like on hardware, it can only drive its pins.
- **The testbench tags its verdict.** `RESULT` and `MEASURED` lines carry a random key passed only to this run's testbench; lines without it are ignored.
- iverilog, vvp, nextpnr and icepack only ever see that netlist.

The lint in `src/lint.ts` (must define `module top`; no file tasks, `$finish` or `` `include ``) is there for friendly early errors, not as the boundary.
