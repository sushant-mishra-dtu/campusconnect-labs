# Lab node agent

Runs on the machine next to a lent FPGA board. It dials out to the platform over a WebSocket (so it works behind a college firewall), takes one job at a time, and relays the examiner's signed verdict. It never decides pass or fail itself.

```bash
npm run labnode                      # sim mode, node iiitd-01, local server
npm run labnode -- --info            # print the examiner id and public key
```

## Modes

| | `sim` (default) | `hw` |
|---|---|---|
| Build | `yosys synth_ice40` (resource check) + `iverilog` | `yosys` → `nextpnr-ice40 --up5k` → `icepack` |
| Flash | none: loads the compiled model | `iceprog` |
| Examine | the challenge's `tb.v`, nonce passed as a plusarg | ESP32-S3 drives inputs and measures outputs on the real pins |
| Signing key | `labnode/keys/sim-<node>.pem`, on this machine | generated on the ESP32, never leaves it |
| Shown on the platform as | Verified in simulation | Verified on silicon |

On Windows, tools are run inside WSL automatically when they are not on `PATH`. Set `CCL_WSL_DISTRO` to pick a distro.

## Configuration

| Flag | Env | Default |
|---|---|---|
| `--server=` | `CCL_SERVER` | `ws://localhost:4000/ws/node` |
| `--node=` | `CCL_NODE` | `iiitd-01` |
| `--token=` | `CCL_NODE_TOKEN` | `demo-iiitd-01-token` |
| `--mode=` | `CCL_MODE` | `sim` |
| `--serial=` | `CCL_SERIAL` | none (required for `hw`, e.g. `COM5` or `/dev/ttyACM0`) |
| `--pcf=` | `CCL_PCF` | `rtl/boards/icebreaker.pcf` |

## Key pinning

The first time a node connects, the platform pins its examiner public key. After that, a node presenting a different key is refused. If you delete `labnode/keys/`, re-seed the database (or ask the platform admin to unpin) before the node can reconnect.

## What a job looks like

```
received → build → flash → examine → sign → (platform) verify
```

Each stage and every tool output line is streamed to the student's live console.

Student code is linted before it is compiled: it must define `module top`, and file-touching system tasks (`$fopen`, `$readmemh`, …), `$finish`, and `` `include`` are refused. Running the toolchain in a container is on the roadmap.
