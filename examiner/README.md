# Examiner firmware (ESP32-S3)

Tests the student's design on the real FPGA pins and signs the verdict with a P-256 key that is generated on the chip and never leaves it.

```bash
pio run -t upload          # build and flash (PlatformIO)
pio device monitor         # then type {"cmd":"info"} to see the examiner id and public key
```

| File | What it does |
|---|---|
| `src/main.cpp` | line-delimited JSON protocol with the lab node over USB CDC |
| `src/tests.cpp` | one hardware test per challenge, mirroring `rtl/challenges/*/tb.v` |
| `src/signer.cpp` | key generation and storage in NVS, replay counter, ECDSA-SHA256 signing (mbedTLS) |
| `src/pins.h` | GPIO map, see [docs/HARDWARE.md](../docs/HARDWARE.md) |

Protocol and payload format: [docs/PROTOCOL.md](../docs/PROTOCOL.md).

Compiles cleanly with `pio run` (Arduino-ESP32 2.0.17 on the official `espressif32` platform) but has not been flashed to hardware yet: the simulation examiner in `labnode/` is what has been exercised end to end.
