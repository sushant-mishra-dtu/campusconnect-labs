## What to build

Drive the LEDs from the switches:

| Output | Value |
|---|---|
| `led[5:0]` | `sw` converted to Gray code: `sw ^ (sw >> 1)` |
| `led[6]` | even parity of `sw`: 1 when an odd number of switches are on |
| `led[7]` | mirrors `btn[0]` |

Leave `uart_tx` idle (`1`).

## How the examiner tests it

1. Holds `btn[1]` (reset) high, then releases it.
2. Applies all 64 switch values in an order derived from the attempt nonce, toggling `btn[0]` as it goes.
3. Reads the LEDs 4 clock cycles after each change. Registered outputs are fine as long as they settle within 4 cycles.

Passes when all 64 vectors match.

## Measured

```json
{ "vectors": 64, "errors": 0 }
```
