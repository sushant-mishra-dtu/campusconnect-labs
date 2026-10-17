// Reference solution: Gray code & parity decoder
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    reg [7:0] led_q = 8'd0;

    // Registered so the outputs don't glitch while the switches settle.
    always @(posedge clk) begin
        led_q <= {btn[0], ^sw, sw ^ (sw >> 1)};
    end

    assign led     = led_q;
    assign uart_tx = 1'b1;

endmodule
