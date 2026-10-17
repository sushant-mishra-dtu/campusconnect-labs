## What to build

`btn[0]` is a raw mechanical button. Count presses and show the count on `led[7:0]`.

- A **press** is registered when `btn[0]` has been stable high for **1 ms** (12,000 cycles at 12 MHz) after being stable low.
- Contact bounce lasts up to **400 µs**, with pulses as short as 1 µs.
- Short glitches (about 20 µs) while the button is released must **not** count.
- `btn[1]` is a synchronous reset that clears the count.
- `btn[0]` is asynchronous to `clk`. Synchronize it before you use it.

Leave `uart_tx` idle (`1`).

## How the examiner tests it

1. Resets the design and waits 2 ms.
2. Makes between 5 and 12 presses (the number comes from the attempt nonce). Each press bounces on the way down and on the way up, is held for 3 ms and released for 3 ms.
3. Fires one 20 µs glitch after every press.
4. Reads the LEDs after each release. The count must go up by exactly one per press.

## Measured

```json
{ "presses": 9, "counted": 9 }
```

On real hardware the ESP32 examiner generates the same bounce pattern from GPIO with microsecond timing.
