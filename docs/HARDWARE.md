# Hardware: one lab node

A lab node is three things on a bench:

```
 lab node PC ──USB── iCEBreaker (iCE40UP5K)        flashed with iceprog
      │                    ║ PMOD 1A / 1B / 2
      └───────USB── ESP32-S3-DevKitC-1 (examiner)   drives inputs, measures outputs, signs
```

The PC runs `labnode` in `hw` mode. It never decides a result; it only builds, flashes and relays what the ESP32 signs.

## Wiring (3.3 V on both sides, common ground)

| Harness signal | Direction | iCE40 pin | iCEBreaker header | ESP32-S3 GPIO |
|---|---|---|---|---|
| `led[0]` | FPGA → ESP | 4 | P1A1 | 1 |
| `led[1]` | FPGA → ESP | 2 | P1A2 | 2 |
| `led[2]` | FPGA → ESP | 47 | P1A3 | 42 |
| `led[3]` | FPGA → ESP | 45 | P1A4 | 41 |
| `led[4]` | FPGA → ESP | 3 | P1A7 | 40 |
| `led[5]` | FPGA → ESP | 48 | P1A8 | 39 |
| `led[6]` | FPGA → ESP | 46 | P1A9 | 38 |
| `led[7]` | FPGA → ESP | 44 | P1A10 | 21 |
| `sw[0]` | ESP → FPGA | 43 | P1B1 | 4 |
| `sw[1]` | ESP → FPGA | 38 | P1B2 | 5 |
| `sw[2]` | ESP → FPGA | 34 | P1B3 | 6 |
| `sw[3]` | ESP → FPGA | 31 | P1B4 | 7 |
| `sw[4]` | ESP → FPGA | 42 | P1B7 | 15 |
| `sw[5]` | ESP → FPGA | 36 | P1B8 | 16 |
| `btn[0]` | ESP → FPGA | 32 | P1B9 | 17 |
| `btn[1]` (reset) | ESP → FPGA | 28 | P1B10 | 18 |
| `uart_rx` | ESP → FPGA | 27 | P2_1 | 8 (Serial1 TX) |
| `uart_tx` | FPGA → ESP | 25 | P2_2 | 9 (edge capture) |
| GND | | | any PMOD GND | GND |

The FPGA side is in [`rtl/boards/icebreaker.pcf`](../rtl/boards/icebreaker.pcf), the ESP32 side in [`examiner/src/pins.h`](../examiner/src/pins.h). Package pins match the iCEBreaker v1.0 reference pin file; check them against your board revision. If the snap-off section is still attached, its LED2 and LED3 share the two UART pins and flicker with the traffic, which is harmless. ESP32 pins avoid the strapping pins (0, 3, 45, 46), USB (19, 20) and the octal-PSRAM pins (35–37).

A different iCE40 board (UPduino, Fomu-class boards) only needs a new `.pcf`; pass it with `--pcf=`.

## Toolchain on the lab node PC

```bash
sudo apt install nextpnr-ice40 fpga-icestorm   # or the OSS CAD Suite
```

yosys comes with `npm install` as WebAssembly (`@yowasp/yosys`); the lab node runs student code through it so the code can't reach this PC's files.

Check that every challenge builds for the board before plugging anything in:

```bash
npm run check:ice40
```

Without sudo, `npm install --no-save @yowasp/nextpnr-ice40` gets WebAssembly builds of nextpnr-ice40 and icepack that the check uses instead. They don't include `iceprog`, so the lab node itself still needs the real toolchain.

Then get the ESP32 enrolled. Only enrolled keys may sign "Verified on silicon", so the platform refuses an `hw` node until the operator has enrolled its ESP32's public key:

```bash
npm run examiner:info -w labnode -- --mode=hw --serial=/dev/ttyACM0 > examiner.pem
npm run admin -w server -- enroll <id> examiner.pem
```

and start the node:

```bash
npm run labnode -- --node=<id> --token=<token> --mode=hw --serial=/dev/ttyACM0
```

On Windows, `--serial=COM5` is opened natively, but `iceprog` runs in WSL when it's not on `PATH`, and WSL can't see USB devices by default. Either attach the iCEBreaker to WSL with [usbipd-win](https://github.com/dorssel/usbipd-win) (`usbipd bind` then `usbipd attach --wsl`; attach only the iCEBreaker and leave the ESP32 on Windows), or use the Windows OSS CAD Suite and give the iCEBreaker's FTDI interface 0 a WinUSB driver with Zadig.

## How each challenge is measured on the pins

| Challenge | Examiner drives | Examiner measures |
|---|---|---|
| `switch-decoder` | all 64 `sw` values in a nonce-derived order, toggles `btn[0]` | `led[7:0]` 5 µs after each change |
| `debounce-counter` | 5–12 bouncy presses on `btn[0]` (same LFSR as the testbench), 20 µs glitches | `led[7:0]` after each release |
| `pwm-duty` | `sw = 0` and four nonce-derived values | high time and period on `led[0]` with the CPU cycle counter |
| `uart-nonce` | nonce bytes + `0x0A` at 115200 baud from Serial1 | every edge on `uart_tx` timestamped in an ISR; baud from the `0x55` sync byte, bytes decoded from the edge timings |

The criteria match the simulation testbenches in `rtl/challenges/*/tb.v`, so a design that passes in sim should pass on silicon, and the `measured` object has the same fields.

## Why the verdict can be trusted

- The P-256 key is generated on the ESP32 on first boot and stored in its NVS. The lab node only ever sees the public key.
- The platform operator enrolls that public key for the node. Only enrolled keys produce "Verified on silicon"; a node can't promote itself by claiming to be an ESP32 (one whose key isn't enrolled is refused at connect).
- The platform pins the key to the node the first time the node connects (inside the pairing window, or any time for an enrolled key). A different key is refused.
- Each verdict includes the nonce the platform issued for that attempt and a counter that only goes up, saved before the verdict is sent.

Hardening for production (not done in the hackathon build): enable flash encryption and NVS encryption so the key can't be read off the flash chip, and secure boot so the firmware can't be swapped for one that signs anything.

## Status

The firmware compiles cleanly with `pio run` in `examiner/` (official `espressif32` platform 7.1.3, Arduino-ESP32 2.0.17, mbedTLS 2.28; no warnings with `-Wall -Wextra`; 6.6% RAM, 11.3% flash) but has **not** been flashed to a board yet. `signer.cpp` also has a branch for the mbedTLS 3.x API (Arduino-ESP32 3.x); that branch has not been compiled. The sim path is what has been run end to end.

`npm run check:ice40` passes. All four reference designs and all four starters go through yosys → nextpnr-ice40 → icepack for the UP5K-SG48 with this pin map, with no warnings, and produce a 104,090-byte bitstream. The largest design, `uart-nonce`, uses 261 of 5,280 logic cells and routes at 48 MHz against the 12 MHz clock. Those builds used the lab node's sandboxed yosys (YoWASP 0.68) with nextpnr 0.11 and icestorm from YoWASP. None of the bitstreams has been flashed yet.
