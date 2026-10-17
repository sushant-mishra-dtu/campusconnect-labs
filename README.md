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

> **No physical FPGA in this build.** We don't have an iCE40 board, so every lab node simulates one on a laptop. It builds the student's design into the real iCE40 UP5K bitstream, turns that bitstream back into Verilog, and runs the examiner testbench against it. Every proof says this in its signed payload (`"target":"bitstream"`) and on its badge (**Simulated, no physical FPGA**). Nothing here is labelled "Verified on silicon". See [docs/SIMULATION.md](docs/SIMULATION.md).

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`), Icarus Verilog and Python 3 for the simulation lab node. On Windows, `iverilog` inside WSL is picked up automatically. yosys, nextpnr-ice40 and icepack come from npm as WebAssembly, so there's nothing to install for them.

```bash
npm install
npm run seed       # demo people, challenges, two lab nodes, signed history, a fresh lab node token
npm run dev        # API on :4000, web app on :5173
npm run labnode    # in a second terminal: a sim lab node for "Robotics Club bench, IIIT Delhi"
```

`npm run seed` generates a new token for the demo lab node every time, prints it, and saves it to `labnode/keys/iiitd-01.token` (gitignored), where `npm run labnode` finds it. No token is committed.

Open http://localhost:5173 and pick a person. The seeded people are fictional and sign in without a password while **demo sign-in** is on; accounts you create need their password. Demo sign-in is off when `NODE_ENV=production` or `CCL_DEMO_LOGIN=0`; turn it off for any public deploy.

| Command | What it does |
|---|---|
| `npm run check:rtl` | every reference design must pass its testbench and every starter must fail, simulated as the iCE40 bitstream read back to Verilog, which is what a sim lab node runs (`-- --netlist` simulates yosys's netlist, `-- --rtl` the source) |
| `npm run check:ice40` | every reference and starter must build to an iCE40 UP5K bitstream with the iCEBreaker pin map and meet 12 MHz (native `nextpnr-ice40`/`icepack` if installed, otherwise the WebAssembly builds from npm) |
| `npm test -w server` | verdict verification (tampering, wrong key, stale nonce, replayed counter, expired booking, wrong examiner tier), node pairing and silicon enrollment, one proof connection per challenge, sign-in, booking limits |
| `npm run admin -w server -- list` | operator commands: `enroll` an ESP32 examiner key as silicon, rotate a node `token`, `unpin` a node's examiner |
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
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Verdict protocol](docs/PROTOCOL.md) · [Simulation, no FPGA](docs/SIMULATION.md) · [Hardware wiring](docs/HARDWARE.md) · [Demo script](docs/DEMO.md) |

## What is real today, and what isn't yet

| Working | Not yet |
|---|---|
| Full loop in simulation, no FPGA: browser → booking check → lab node → yosys → nextpnr → icepack → bitstream read back to Verilog → iverilog examiner → signed verdict → verification → badge, connection, referral | Any physical FPGA. We have no board, so no verdict is "Verified on silicon" |
| Every challenge builds to an iCE40 UP5K bitstream that meets 12 MHz, and that same bitstream passes (reference) or fails (starter) its testbench | Flash/NVS encryption and secure boot on the ESP32 |
| ESP32-S3 examiner firmware flashed to a real ESP32-S3: on-chip key, runs a test on its GPIOs, signs verdicts that verify | The ESP32 examining a real FPGA (nothing to wire it to) |
| ECDSA P-256 signatures, nonce per attempt, monotonic counter, key pinning per node with a pairing window | College SSO and email verification (sign-in is email and password) |
| Student code is only ever read by yosys compiled to WebAssembly, which can't see the lab node's files; the testbench runs against what was decoded from the bitstream, so a design can't print its own verdict | An OS-level sandbox around iverilog and icebox_vlog (they see only what was unpacked from the bitstream, never student source) |
| In-browser re-verification of any proof with WebCrypto | Proof of key possession when a node connects (today the node token authenticates it) |
| Skill-gap matching from proven skills only | |

Proofs from the simulation examiner are labelled **Simulated, no physical FPGA**, and the proof page says what was simulated. **Verified on silicon** needs an ESP32 examiner whose public key the platform operator enrolled for that node (`npm run admin -w server -- enroll`); what a node says about itself doesn't count.

## Team

| GitHub | Built |
|---|---|
| [@sushant-mishra-dtu](https://github.com/sushant-mishra-dtu) | RTL challenges and testbenches, lab node agent, ESP32 examiner firmware, iCE40 flow |
| [@natyavidhan](https://github.com/natyavidhan) | Server: schema, API, booking and verdict verification, WebSocket hub |
| [@agrwljinal](https://github.com/agrwljinal) | Web: app shell and design system, challenges, Verilog editor and live console, home dashboard |
| [@jazzz7468-eng](https://github.com/jazzz7468-eng) | Web: labs and booking, profiles, proof page, network graph; docs and demo |
