// Reference solution: 1 kHz PWM from the switches
// Period = 188 * 64 = 12,032 cycles -> 997.3 Hz. Duty = sw/64 exactly.
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    localparam integer PRESCALE = 188;

    reg [7:0] pre   = 8'd0;
    reg [5:0] phase = 6'd0;
    reg       pwm   = 1'b0;

    always @(posedge clk) begin
        if (btn[1]) begin
            pre   <= 8'd0;
            phase <= 6'd0;
            pwm   <= 1'b0;
        end else begin
            if (pre == PRESCALE - 1) begin
                pre   <= 8'd0;
                phase <= phase + 6'd1;
            end else begin
                pre <= pre + 8'd1;
            end
            pwm <= (phase < sw);
        end
    end

    assign led     = {7'b0, pwm};
    assign uart_tx = 1'b1;

endmodule
