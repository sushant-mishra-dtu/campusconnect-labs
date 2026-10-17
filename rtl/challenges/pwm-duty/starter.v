// 1 kHz PWM from the switches
// led[0] = PWM, frequency 1 kHz +/- 5%, duty = sw / 64. btn[1] = reset.
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    reg pwm = 1'b0;

    // TODO: divide the 12 MHz clock down to a PWM period near 1 ms and
    // compare a phase counter against sw.
    always @(posedge clk) begin
        pwm <= 1'b0;
    end

    assign led     = {7'b0, pwm};
    assign uart_tx = 1'b1;

endmodule
