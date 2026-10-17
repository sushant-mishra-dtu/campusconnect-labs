// Simulation examiner: switch-decoder
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

    reg [23:0] nonce;
    reg [63:0] key;    // tags MEASURED/RESULT lines; only this run's lab node knows it
    integer    i, errors;
    reg  [5:0] v;
    reg        b;
    reg  [7:0] want;
    reg        seen_bad;
    reg  [5:0] bad_sw;
    reg  [7:0] bad_want, bad_got;

    initial begin
        if (!$value$plusargs("nonce=%h", nonce)) nonce = 24'h9c41e2;
        if (!$value$plusargs("key=%h", key)) key = 64'd0;
        errors   = 0;
        seen_bad = 1'b0;

        btn[1] = 1'b1;
        repeat (100) @(posedge clk);
        btn[1] = 1'b0;
        repeat (4) @(posedge clk);
        $display("LOG reset released, sweeping 64 switch vectors");

        for (i = 0; i < 64; i = i + 1) begin
            v = i * 37 + nonce[5:0];  // 37 is odd, so this visits every value once
            b = i[0] ^ nonce[8];
            @(negedge clk);
            sw     = v;
            btn[0] = b;
            repeat (4) @(posedge clk);
            #1;
            want = {b, ^v, v ^ (v >> 1)};
            if (led !== want) begin
                errors = errors + 1;
                if (!seen_bad) begin
                    seen_bad = 1'b1;
                    bad_sw   = v;
                    bad_want = want;
                    bad_got  = led;
                end
            end
        end

        if (seen_bad)
            $display("LOG first mismatch: sw=%b expected led=%b got %b", bad_sw, bad_want, bad_got);
        $display("LOG %0d of 64 vectors correct", 64 - errors);
        $display("MEASURED %h {\"vectors\":64,\"errors\":%0d}", key, errors);
        if (errors == 0) $display("RESULT %h pass", key);
        else             $display("RESULT %h fail", key);
        $finish;
    end

    initial begin
        #(83.334 * 20000);
        $display("LOG examiner timeout");
        $display("MEASURED %h {\"vectors\":64,\"errors\":-1}", key);
        $display("RESULT %h fail", key);
        $finish;
    end
endmodule
