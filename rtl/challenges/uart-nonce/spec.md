## What to build

A UART store-and-echo at **115200 baud, 8N1** (idle high, LSB first) on `uart_rx` / `uart_tx`.

1. Receive bytes on `uart_rx` and buffer them (up to 8).
2. When you receive `0x0A`, transmit `0x55` followed by the buffered bytes in the order they arrived. Don't send the `0x0A` back. Then clear the buffer.
3. Keep `uart_tx` idle (high) while the examiner is transmitting. A wire from `uart_rx` to `uart_tx` fails.
4. Start replying within **1 ms** of the `0x0A` stop bit.

`btn[1]` is a synchronous reset. `uart_rx` is asynchronous to `clk`, so synchronize it. 12 MHz / 115200 = 104.17 clocks per bit.

## How the examiner tests it

1. Sends the three nonce bytes for this attempt (for nonce `9c41e2`: `0x9c 0x41 0xe2`), then `0x0A`. Watches `uart_tx` the whole time.
2. Measures your bit time from the edges of the `0x55` sync byte and converts it to a baud rate.
3. Decodes the next three bytes at your measured rate and checks the stop bits.

Passes when the echo matches the nonce, the baud rate is within ±3% of 115200, and `uart_tx` stayed quiet while the examiner was talking.

## Measured

```json
{ "baud": 115385, "echo": "9c41e2", "early_tx": 0 }
```

The nonce is fresh for every attempt, so a recording of someone else's passing run won't match.
