# Architecture

```
 Browser (React)                    Platform (Node, Express, SQLite)               Lab node PC (any campus)
 ───────────────                    ────────────────────────────────               ────────────────────────
 Verilog editor ── POST /attempts ─▶ booking check, nonce            ── job ──▶   lint → yosys (wasm) → nextpnr → iceprog
 live console   ◀── /ws/client ───── hub fans out status + logs      ◀─ logs ──   (sim, no FPGA: yosys → nextpnr → bitstream → readback → iverilog)
 proof page     ◀── /proofs/:id ──── verdict.ts: sig, nonce,          ◀─ verdict ─ ESP32-S3 examiner signs
 (WebCrypto re-check)                counter, booking                              (sim: software key)
                                     │
                                     ├─ badges
                                     └─ connections (proved_for, lent_board, referred, mentored)
```

## Components

| Part | Tech | Notes |
|---|---|---|
| `web/` | Vite, React 18, Tailwind 4, CodeMirror 6, d3-force | One WebSocket per tab for live logs, node status, notifications, graph updates |
| `server/` | Express 4, `ws`, `node:sqlite` | No external services. One process, one SQLite file. Serves the built web app in production |
| `labnode/` | Node, `ws`, `@yowasp/yosys`, optional `serialport` | Dials *out* to the platform, so it works behind a college firewall. One job at a time per board. Student code is only parsed by WebAssembly yosys |
| `examiner/` | ESP32-S3, Arduino, mbedTLS, ArduinoJson | Holds the signing key; decides pass/fail from the pins |
| `rtl/` | Verilog, iverilog | Spec, starter, reference and testbench per challenge. The platform reads specs from here, the lab node runs testbenches from here |

## Data model

`colleges` · `users` (role: student / alum / recruiter / founder / club, plus self-typed `claims`) · `roles` (skills a job needs) · `challenges` (an author posts a test from `rtl/` with an offer) · `nodes` (a lent board, its pinned examiner key, last counter and pairing window) · `silicon_examiners` (ESP32 keys the operator enrolled; the only source of "Verified on silicon") · `bookings` · `attempts` (code, nonce, log, signed payload, verdict status, key snapshot) · `badges` · `connections` · `notifications`.

There is no follow table. `connections` rows are only written by the verdict path (`proved_for`, `lent_board`) or by an author acting on a proof (`referred`, `mentored`).

## Skill gap

`server/src/gap.ts`. A role lists skill slugs. A student's proven skills are the union of the skills of every test they hold a badge for (typed claims are ignored). The missing skills are scored against every posted challenge: +10 per missing skill it covers, +5 if it is linked to that role, +3 if the role's author posted it, minus difficulty. The top three are suggested.

## Running it on the venue network

Everything works offline on one laptop: the server, the web app (fonts are bundled) and a sim lab node. A second laptop on the same network can be the lab node:

```bash
npm run labnode -- --server=ws://<platform-ip>:4000/ws/node
```
