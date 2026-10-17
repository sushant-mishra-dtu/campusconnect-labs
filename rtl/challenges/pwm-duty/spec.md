## What to build

Output a PWM signal on `led[0]`:

- Frequency **1 kHz ± 5%** (950–1050 Hz) from the 12 MHz clock.
- Duty cycle **`sw / 64`**, within ±1/64. `sw = 0` keeps `led[0]` low all the time.
- `btn[1]` is a synchronous reset.

`led[7:1]` and `uart_tx` are not checked (keep `uart_tx` at `1`).

Hint: 12,000,000 / 1000 = 12,000 cycles per period, and 12,000 doesn't divide evenly by 64. Pick a prescaler that lands inside the tolerance.

## How the examiner tests it

1. Sets `sw = 0` and checks that `led[0]` stays low for 2.5 ms.
2. Sets four non-zero switch values taken from the attempt nonce. For each, waits 2.5 ms, then measures one full period: high time and total time.

Passes when every point is inside both tolerances.

## Measured

```json
{ "points": 5, "hz_min": 997, "hz_max": 997, "worst_duty_err": "0.00" }
```

`worst_duty_err` is in 64ths: `0.00` is exact, `1.00` is the limit.
