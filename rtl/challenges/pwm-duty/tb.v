// Simulation examiner: pwm-duty
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

    localparam integer SETTLE = 30000;  // 2.5 ms
    localparam integer GUARD  = 40000;  // give up on an edge after 3.3 ms

    reg [23:0] nonce;
    integer    k, s, n, high, period, hz, hz_min, hz_max, errors, points;
    real       err, worst;
    reg        ok, stuck_high;

    // Measure one full period of led[0], starting at a rising edge.
    task measure(output integer hi, output integer per, output reg good);
        integer g;
        begin
            good = 1'b1;
            hi   = 0;
            per  = 0;
            g    = 0;
            while (led[0] !== 1'b0 && g < GUARD) begin @(posedge clk); g = g + 1; end
            while (led[0] !== 1'b1 && g < GUARD) begin @(posedge clk); g = g + 1; end
            if (g >= GUARD) good = 1'b0;
            else begin
                while (led[0] === 1'b1 && hi < GUARD) begin @(posedge clk); hi = hi + 1; end
                per = hi;
                while (led[0] === 1'b0 && per < GUARD) begin @(posedge clk); per = per + 1; end
                if (hi >= GUARD || per >= GUARD || led[0] !== 1'b1) good = 1'b0;
            end
        end
    endtask

    initial begin
        if (!$value$plusargs("nonce=%h", nonce)) nonce = 24'h9c41e2;
        errors = 0;
        points = 0;
        hz_min = 0;
        hz_max = 0;
        worst  = 0.0;

        btn[1] = 1'b1;
        repeat (100) @(posedge clk);
        btn[1] = 1'b0;

        // Point 0: sw = 0 must stay low.
        sw = 6'd0;
        repeat (SETTLE) @(posedge clk);
        stuck_high = 1'b0;
        for (n = 0; n < SETTLE; n = n + 1) begin
            @(posedge clk);
            if (led[0] !== 1'b0) stuck_high = 1'b1;
        end
        points = points + 1;
        if (stuck_high) begin
            errors = errors + 1;
            $display("LOG sw=0: led[0] was not held low");
        end else begin
            $display("LOG sw=0: led[0] held low");
        end

        // Points 1-4: switch values from the nonce.
        for (k = 0; k < 4; k = k + 1) begin
            s  = 1 + (((nonce >> (6 * k)) & 24'h3f) % 63);
            sw = s;
            repeat (SETTLE) @(posedge clk);
            measure(high, period, ok);
            points = points + 1;
            if (!ok) begin
                errors = errors + 1;
                $display("LOG sw=%0d: no clean PWM edges on led[0]", s);
            end else begin
                hz  = 12000000 / period;
                err = (high * 64.0 - s * period) / period;
                if (err < 0) err = -err;
                if (err > worst) worst = err;
                if (hz_min == 0 || hz < hz_min) hz_min = hz;
                if (hz > hz_max) hz_max = hz;
                $display("LOG sw=%0d: %0d Hz, high %0d of %0d cycles (want %0.1f)", s, hz, high, period, s * period / 64.0);
                if (hz < 950 || hz > 1050 || err > 1.0) errors = errors + 1;
            end
        end

        $display("MEASURED {\"points\":%0d,\"hz_min\":%0d,\"hz_max\":%0d,\"worst_duty_err\":\"%0.2f\"}", points, hz_min, hz_max, worst);
        if (errors == 0) $display("RESULT pass");
        else             $display("RESULT fail");
        $finish;
    end

    initial begin
        #(83.334 * 600000);
        $display("LOG examiner timeout");
        $display("MEASURED {\"points\":%0d,\"hz_min\":0,\"hz_max\":0,\"worst_duty_err\":\"-1\"}", points);
        $display("RESULT fail");
        $finish;
    end
endmodule
