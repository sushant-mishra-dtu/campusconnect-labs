// Reference solution: debounced press counter
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    localparam integer STABLE_CYCLES = 12000;  // 1 ms at 12 MHz

    // Two-flop synchronizer for the asynchronous button.
    reg [1:0] sync = 2'b00;
    always @(posedge clk) sync <= {sync[0], btn[0]};
    wire raw = sync[1];

    reg [13:0] stable_cnt = 14'd0;
    reg        level      = 1'b0;
    reg  [7:0] presses    = 8'd0;

    always @(posedge clk) begin
        if (btn[1]) begin
            stable_cnt <= 14'd0;
            level      <= 1'b0;
            presses    <= 8'd0;
        end else if (raw == level) begin
            stable_cnt <= 14'd0;
        end else if (stable_cnt == STABLE_CYCLES - 1) begin
            stable_cnt <= 14'd0;
            level      <= raw;
            if (raw) presses <= presses + 8'd1;
        end else begin
            stable_cnt <= stable_cnt + 14'd1;
        end
    end

    assign led     = presses;
    assign uart_tx = 1'b1;

endmodule
