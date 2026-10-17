# CampusConnect Labs

**HackShift 2026 · Problem Statement 1: Alumni Network & Professional Connections**
*Building a network, not a directory.*

A professional network where people connect over what they have proven they can do on real hardware. Claims on a profile don't count.

- An **alum, recruiter or founder** posts a hardware challenge with an offer: *"Make this UART work on a real FPGA and I'll refer you."*
- A **student** sees the gap between their proven skills and the role, and gets the challenge that closes it.
- A **college club** lends an idle FPGA board as a remote lab node. A student whose college has no lab books a slot on it.
- The student writes Verilog in the browser. It's synthesized and flashed onto that board, and an **ESP32 examiner** wired to the FPGA drives its inputs, measures its outputs, and **signs the verdict** with a key that never leaves the chip.
- The platform accepts the verdict only with a valid signature, the nonce it issued, a fresh counter and a matching booking. Then the student gets a badge and a **connection to the author with the proof attached**, and the club that lent the board is linked to the student too.

There are no follow buttons. Every edge in the graph points to something that happened.

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`) and Icarus Verilog for the simulation lab node. On Windows, `iverilog` and `yosys` inside WSL are picked up automatically.

```bash
npm install
npm run seed       # demo people, challenges, two lab nodes, signed history
npm run dev        # API on :4000, web app on :5173
npm run labnode    # in a second terminal: a sim lab node for "Robotics Club bench, IIIT Delhi"
```

Open http://localhost:5173 and pick a person. No passwords in demo mode.

| Command | What it does |
|---|---|
| `npm run check:rtl` | every reference design must pass its testbench, every starter must fail |
| `npm run check:ice40` | every reference and starter must build to an iCE40 UP5K bitstream with the iCEBreaker pin map and meet 12 MHz (needs `nextpnr-ice40` and `icepack`, or `npm install --no-save @yowasp/nextpnr-ice40`) |
| `npm test -w server` | verdict verification: tampering, wrong key, stale nonce, replayed counter, expired booking |
| `npm run build && npm start` | production build served by the API server on :4000 |

## Demo people

| Who | Role | Try |
|---|---|---|
| Aarav Sharma | 3rd-year ECE, college with no FPGA lab | Home shows the gap for *FPGA Design Intern*. Book a board, pass *UART nonce echo* |
| Meera Iyer | Alum, FPGA engineer | The proof lands in her inbox. Send the referral |
| Ishaan Verma | Robotics Club lead, IIIT Delhi | Owns the live lab node, sees who it served |
| Kabir, Tanya, Diya, Farhan | Students | Seeded history: badges, referrals, a mentorship |
| Rohan Gupta, Kavya Nair | Founder, recruiter | More challenges and offers |

People, companies and two of the colleges are fictional. The full walkthrough is in [docs/DEMO.md](docs/DEMO.md).

## What's in the repo

| Folder | What lives there |
|---|---|
| [`rtl/`](rtl) | Four hardware challenges: spec, starter, reference solution, examiner testbench |
| [`server/`](server) | API, booking checks, verdict verification, WebSocket hub, SQLite |
| [`web/`](web) | Verilog editor with live console, labs and booking, profiles, proof page, network graph |
| [`labnode/`](labnode) | Agent next to a lent board: yosys/nextpnr/iceprog (hardware) or yosys/iverilog (sim) |
| [`examiner/`](examiner) | ESP32-S3 firmware that tests the FPGA pins and signs verdicts |
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Verdict protocol](docs/PROTOCOL.md) · [Hardware wiring](docs/HARDWARE.md) · [Demo script](docs/DEMO.md) |

## What is real today, and what isn't yet

| Working | Not yet |
|---|---|
| Full loop in simulation: browser → booking check → lab node → yosys synthesis check → iverilog examiner → signed verdict → verification → badge, connection, referral | Flashing a board and running the ESP32 examiner on real pins |
| Every challenge builds to an iCE40 UP5K bitstream that meets 12 MHz; the ESP32 firmware compiles | Flash/NVS encryption and secure boot on the ESP32 |
| ECDSA P-256 signatures, nonce per attempt, monotonic counter, key pinning per node | Real sign-in (demo mode signs in by email) |
| In-browser re-verification of any proof with WebCrypto | Sandboxing the toolchain on lab nodes (code is linted, not containerized) |
| Skill-gap matching from proven skills only | |

Proofs from the simulation examiner are labelled **Verified in simulation**; only an ESP32 examiner produces **Verified on silicon**.

## Team

| GitHub | Built |
|---|---|
| [@sushant-mishra-dtu](https://github.com/sushant-mishra-dtu) | RTL challenges and testbenches, lab node agent, ESP32 examiner firmware, iCE40 flow |
| [@natyavidhan](https://github.com/natyavidhan) | Server: schema, API, booking and verdict verification, WebSocket hub |
| [@agrwljinal](https://github.com/agrwljinal) | Web: app shell and design system, challenges, Verilog editor and live console, home dashboard |
| [@jazzz7468-eng](https://github.com/jazzz7468-eng) | Web: labs and booking, profiles, proof page, network graph; docs and demo |
