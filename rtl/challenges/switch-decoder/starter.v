// Gray code & parity decoder
// led[5:0] = Gray code of sw, led[6] = parity of sw, led[7] = btn[0]
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    // TODO: replace this with the decoder
    assign led     = 8'b0000_0000;

    assign uart_tx = 1'b1;

endmodule
