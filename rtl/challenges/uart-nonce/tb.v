// Simulation examiner: uart-nonce
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

    localparam integer BIT = 104;  // examiner sends at 12 MHz / 104 = 115385 baud

    integer cyc = 0;
    always @(posedge clk) cyc = cyc + 1;

    reg [23:0] nonce;
    reg        window = 1'b0;   // examiner is transmitting the nonce
    reg        early_tx = 1'b0;
    reg        sent_all = 1'b0;

    always @(negedge uart_tx) if (window) early_tx = 1'b1;

    task send_byte(input [7:0] b);
        integer n;
        begin
            uart_rx = 1'b0;
            repeat (BIT) @(posedge clk);
            for (n = 0; n < 8; n = n + 1) begin
                uart_rx = b[n];
                repeat (BIT) @(posedge clk);
            end
            uart_rx = 1'b1;
            repeat (2 * BIT) @(posedge clk);  // stop bit + one idle bit
        end
    endtask

    // reply decoding
    integer  t0, t_last, t_edge, edges, g, k, n, t_start, iv_min, iv_max, baud;
    real     bitc;
    reg      last, sync_ok, framing_ok, got_reply;
    reg [7:0] rx_bytes [0:2];
    reg [7:0] cur;

    initial begin
        if (!$value$plusargs("nonce=%h", nonce)) nonce = 24'h9c41e2;
        rx_bytes[0] = 8'h00; rx_bytes[1] = 8'h00; rx_bytes[2] = 8'h00;
        baud       = 0;
        sync_ok    = 1'b0;
        framing_ok = 1'b1;
        got_reply  = 1'b0;

        btn[1] = 1'b1;
        repeat (100) @(posedge clk);
        btn[1] = 1'b0;
        repeat (BIT * 4) @(posedge clk);

        if (uart_tx !== 1'b1) begin
            $display("LOG uart_tx is not idle-high after reset");
            early_tx = 1'b1;
        end

        $display("LOG sending nonce %h then 0x0A", nonce);
        fork
            begin : examiner_tx
                window = 1'b1;
                send_byte(nonce[23:16]);
                send_byte(nonce[15:8]);
                send_byte(nonce[7:0]);
                window = 1'b0;
                send_byte(8'h0a);
                sent_all = 1'b1;
            end
            begin : examiner_rx
                wait (window == 1'b0 && cyc > 0);
                // sync byte: wait for its start bit (allow the 0x0A frame plus 1 ms)
                g = 0;
                while (uart_tx !== 1'b0 && g < 11 * BIT + 12000) begin @(posedge clk); g = g + 1; end
                if (uart_tx === 1'b0) begin
                    got_reply = 1'b1;
                    t0 = cyc; t_last = cyc; edges = 0; last = 1'b0;
                    iv_min = 1 << 30; iv_max = 0;
                    while (edges < 9 && (cyc - t0) < 15000) begin
                        @(posedge clk);
                        if (uart_tx !== last) begin
                            last   = uart_tx;
                            edges  = edges + 1;
                            t_edge = cyc - t_last;
                            t_last = cyc;
                            if (t_edge < iv_min) iv_min = t_edge;
                            if (t_edge > iv_max) iv_max = t_edge;
                        end
                    end
                    if (edges == 9) begin
                        bitc    = (t_last - t0) / 9.0;
                        baud    = $rtoi(12000000.0 / bitc + 0.5);
                        sync_ok = (iv_max * 4 <= iv_min * 5);  // all intervals within 25%
                        if (!sync_ok) $display("LOG first reply byte is not 0x55 (edge spacing %0d..%0d cycles)", iv_min, iv_max);
                        for (k = 0; k < 3; k = k + 1) begin
                            g = 0;
                            while (uart_tx !== 1'b0 && g < 20 * BIT) begin @(posedge clk); g = g + 1; end
                            if (uart_tx !== 1'b0) begin
                                framing_ok = 1'b0;
                                $display("LOG reply byte %0d never started", k + 1);
                                k = 3;
                            end else begin
                                t_start = cyc;
                                for (n = 0; n < 8; n = n + 1) begin
                                    while (cyc < t_start + $rtoi((1.5 + n) * bitc)) @(posedge clk);
                                    cur[n] = uart_tx;
                                end
                                while (cyc < t_start + $rtoi(9.5 * bitc)) @(posedge clk);
                                if (uart_tx !== 1'b1) begin
                                    framing_ok = 1'b0;
                                    $display("LOG reply byte %0d has a bad stop bit", k + 1);
                                end
                                rx_bytes[k] = cur;
                            end
                        end
                    end else begin
                        framing_ok = 1'b0;
                        $display("LOG could not lock onto the 0x55 sync byte (%0d edges)", edges);
                    end
                end else begin
                    $display("LOG no reply within 1 ms of 0x0A");
                end
            end
        join

        if (got_reply)
            $display("LOG reply after sync byte: %h %h %h at %0d baud", rx_bytes[0], rx_bytes[1], rx_bytes[2], baud);
        if (early_tx)
            $display("LOG uart_tx toggled while the examiner was transmitting");

        $display("MEASURED {\"baud\":%0d,\"echo\":\"%h%h%h\",\"early_tx\":%0d}",
                 baud, rx_bytes[0], rx_bytes[1], rx_bytes[2], early_tx);
        if (got_reply && sync_ok && framing_ok && !early_tx &&
            {rx_bytes[0], rx_bytes[1], rx_bytes[2]} === nonce &&
            baud >= 111744 && baud <= 118656)
            $display("RESULT pass");
        else
            $display("RESULT fail");
        $finish;
    end

    initial begin
        #(83.334 * 200000);
        $display("LOG examiner timeout");
        $display("MEASURED {\"baud\":0,\"echo\":\"\",\"early_tx\":%0d}", early_tx);
        $display("RESULT fail");
        $finish;
    end
endmodule
