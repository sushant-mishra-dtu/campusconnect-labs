// Debounced press counter
// Count clean presses of btn[0] on led[7:0]. btn[1] resets the count.
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    reg [7:0] presses = 8'd0;
    reg       btn_q   = 1'b0;

    // TODO: this counts every bounce. Synchronize btn[0], then only accept
    // a new level after it has been stable for 12,000 cycles (1 ms).
    always @(posedge clk) begin
        btn_q <= btn[0];
        if (btn[1])
            presses <= 8'd0;
        else if (btn[0] && !btn_q)
            presses <= presses + 8'd1;
    end

    assign led     = presses;
    assign uart_tx = 1'b1;

endmodule
