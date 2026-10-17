// UART nonce echo, 115200 baud 8N1
// Buffer bytes from uart_rx. On 0x0A, send 0x55 then the buffered bytes on uart_tx.
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    localparam integer CLKS_PER_BIT = 104;  // 12 MHz / 115200

    // TODO 1: synchronize uart_rx and build a receiver that samples mid-bit
    // TODO 2: store received bytes in a small buffer until 0x0A arrives
    // TODO 3: build a transmitter and send 0x55 + the buffer

    assign uart_tx = 1'b1;
    assign led     = 8'd0;

endmodule
