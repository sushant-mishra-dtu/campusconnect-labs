# Running and developing C-RTL

## Run it

Needs Node 22.13+ (uses the built-in `node:sqlite`), Icarus Verilog 12 or newer and Python 3 for the simulation lab node (Ubuntu 22.04's Icarus package is 11, which can't read the iCE40 cell models). On Windows, `iverilog` inside WSL is picked up automatically. yosys, nextpnr-ice40 and icepack come from npm as WebAssembly, so there's nothing to install for them.

With Docker, `docker compose up -d --build` runs the platform and a simulation lab node together on http://localhost:4000, with live data-flow dashboards at http://localhost:4000/flow and http://localhost:4100. See [DEPLOY.md](DEPLOY.md), which also covers running a college lab node on its own.

```bash
npm install
npm run seed       # demo people, challenges, two lab nodes, signed history, a fresh lab node token
npm run dev        # API on :4000, web app on :5173
npm run labnode    # in a second terminal: a sim lab node for "Robotics Club bench, IIIT Delhi"
```

`npm run seed` generates a new token for the demo lab node every time, prints it, and saves it to `labnode/keys/iiitd-01.token` (gitignored), where `npm run labnode` finds it. No token is committed.

Open http://localhost:5173 and pick a person. The seeded people are fictional and sign in without a password while **demo sign-in** is on; accounts you create need their password. Demo sign-in is off when `NODE_ENV=production` or `CRTL_DEMO_LOGIN=0`; turn it off for any public deploy.

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

People, companies and two of the colleges are fictional. The full walkthrough is in [DEMO.md](DEMO.md).

## README screenshots

`tools/readme-shots.mjs` drives the demo story through the real web app and both dashboards in a headless browser and saves every stage. It uses up Aarav's demo story, so reseed afterwards. The command is at the top of the file; copy the images the README uses into `docs/screenshots/`.

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
