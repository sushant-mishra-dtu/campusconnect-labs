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

Needs Node 22.13+ (uses the built-in `node:sqlite`) and Icarus Verilog 12 or newer for the simulation lab node (Ubuntu 22.04's package is 11, which can't read the iCE40 cell models). On Windows, `iverilog` inside WSL is picked up automatically. yosys comes from npm as WebAssembly, so there's nothing to install for it.

With Docker, `docker compose up -d --build` runs the platform and a simulation lab node together on http://localhost:4000. See [docs/DEPLOY.md](docs/DEPLOY.md), which also covers running a college lab node on its own.

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
| `npm run check:rtl` | every reference design must pass its testbench and every starter must fail, simulated as the synthesized iCE40 netlist a sim lab node runs (`-- --rtl` simulates the source) |
| `npm run check:ice40` | every reference and starter must build to an iCE40 UP5K bitstream with the iCEBreaker pin map and meet 12 MHz (needs `nextpnr-ice40` and `icepack`, or `npm install --no-save @yowasp/nextpnr-ice40`) |
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
| [`docs/`](docs) | [Architecture](docs/ARCHITECTURE.md) · [Verdict protocol](docs/PROTOCOL.md) · [Hardware wiring](docs/HARDWARE.md) · [Demo script](docs/DEMO.md) |

## What is real today, and what isn't yet

| Working | Not yet |
|---|---|
| Full loop in simulation: browser → booking check → lab node → yosys synthesis → iverilog examiner on the gate-level netlist → signed verdict → verification → badge, connection, referral | Flashing a board and running the ESP32 examiner on real pins |
| Every challenge builds to an iCE40 UP5K bitstream that meets 12 MHz; the ESP32 firmware compiles | Flash/NVS encryption and secure boot on the ESP32 |
| ECDSA P-256 signatures, nonce per attempt, monotonic counter, key pinning per node with a pairing window | College SSO and email verification (sign-in is email and password) |
| Student code is only ever read by yosys compiled to WebAssembly, which can't see the lab node's files; the testbench runs against the synthesized netlist, so a design can't print its own verdict | An OS-level sandbox around iverilog and nextpnr (they see only yosys's netlist, never student source) |
| In-browser re-verification of any proof with WebCrypto | Proof of key possession when a node connects (today the node token authenticates it) |
| Skill-gap matching from proven skills only | |

Proofs from the simulation examiner are labelled **Verified in simulation**. **Verified on silicon** needs an ESP32 examiner whose public key the platform operator enrolled for that node (`npm run admin -w server -- enroll`); what a node says about itself doesn't count.

## Team

| GitHub | Built |
|---|---|
| [@sushant-mishra-dtu](https://github.com/sushant-mishra-dtu) | RTL challenges and testbenches, lab node agent, ESP32 examiner firmware, iCE40 flow |
| [@natyavidhan](https://github.com/natyavidhan) | Server: schema, API, booking and verdict verification, WebSocket hub |
| [@agrwljinal](https://github.com/agrwljinal) | Web: app shell and design system, challenges, Verilog editor and live console, home dashboard |
| [@jazzz7468-eng](https://github.com/jazzz7468-eng) | Web: labs and booking, profiles, proof page, network graph; docs and demo |
