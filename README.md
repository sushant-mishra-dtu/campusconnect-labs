# CampusConnect Labs

HackShift 2026 · Problem Statement 1: Alumni Network & Professional Connections.

A professional network where people connect over what they have proven they can do on real hardware. Claims on a profile don't count.

## Layout

| Folder | What lives there |
|---|---|
| `rtl/` | Hardware challenges: spec, starter, reference solution and examiner testbench for each |
| `server/` | Platform API, booking checks, verdict verification, WebSocket hub |
| `web/` | Browser app: Verilog editor, labs, profiles, network graph |
| `labnode/` | Agent that runs on the machine next to a lent FPGA board |
| `examiner/` | ESP32-S3 firmware that tests the FPGA and signs the verdict |
| `docs/` | Architecture, verdict protocol, hardware wiring, demo script |

Work in progress.
