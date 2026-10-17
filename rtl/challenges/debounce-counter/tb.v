// Simulation examiner: debounce-counter
`timescale 1ns/1ps
module tb;
    reg        clk     = 1'b0;
    reg  [5:0] sw      = 6'd0;
    reg  [1:0] btn     = 2'b00;
    reg        uart_rx = 1'b1;
    wire [7:0] led;
    wire       uart_tx;

    always #41.667 clk = ~clk;  // 12 MHz

    top dut (
        .clk(clk), .sw(sw), .btn(btn), .led(led),
        .uart_rx(uart_rx), .uart_tx(uart_tx)
    );

    localparam integer MS = 12000;  // cycles per millisecond

    reg [23:0] nonce;
    reg [63:0] key;    // tags MEASURED/RESULT lines; only this run's lab node knows it
    reg [31:0] lfsr;
    integer    presses, p, errors;
    reg  [7:0] got;

    task step_lfsr;
        lfsr = {lfsr[30:0], lfsr[31] ^ lfsr[21] ^ lfsr[1] ^ lfsr[0]};
    endtask

    // Toggle around the target level with 1-36 us pulses, ending on the target.
    // Nine pulses of at most 432 cycles keeps a burst under 400 us.
    task bounce(input lvl);
        integer n, w;
        begin
            for (n = 0; n < 9; n = n + 1) begin
                step_lfsr;
                w = 12 + (lfsr % 420);
                btn[0] = (n % 2 == 0) ? lvl : ~lvl;
                repeat (w) @(posedge clk);
            end
            btn[0] = lvl;
        end
    endtask

    initial begin
        if (!$value$plusargs("nonce=%h", nonce)) nonce = 24'h9c41e2;
        if (!$value$plusargs("key=%h", key)) key = 64'd0;
        lfsr    = {8'ha5, nonce} | 32'h1;
        presses = 5 + (nonce[3:0] % 8);
        errors  = 0;

        btn = 2'b10;
        repeat (100) @(posedge clk);
        btn[1] = 1'b0;
        repeat (2 * MS) @(posedge clk);
        $display("LOG reset released, making %0d bouncy presses", presses);

        for (p = 1; p <= presses; p = p + 1) begin
            bounce(1'b1);
            repeat (3 * MS) @(posedge clk);
            bounce(1'b0);
            repeat (3 * MS) @(posedge clk);
            #1 got = led;
            if (got !== p[7:0]) begin
                errors = errors + 1;
                if (errors == 1) $display("LOG after press %0d the LEDs show %0d", p, got);
            end
            // a 20 us glitch while released: must not count
            btn[0] = 1'b1;
            repeat (240) @(posedge clk);
            btn[0] = 1'b0;
            repeat (2 * MS) @(posedge clk);
        end

        #1 got = led;
        if (^got === 1'bx) begin
            $display("LOG LEDs are undriven (x)");
            $display("MEASURED %h {\"presses\":%0d,\"counted\":-1}", key, presses);
            $display("RESULT %h fail", key);
        end else begin
            $display("LOG counted %0d of %0d presses", got, presses);
            $display("MEASURED %h {\"presses\":%0d,\"counted\":%0d}", key, presses, got);
            if (errors == 0 && got == presses) $display("RESULT %h pass", key);
            else                               $display("RESULT %h fail", key);
        end
        $finish;
    end

    initial begin
        #(83.334 * 2000000);
        $display("LOG examiner timeout");
        $display("MEASURED %h {\"presses\":%0d,\"counted\":-1}", key, presses);
        $display("RESULT %h fail", key);
        $finish;
    end
endmodule
