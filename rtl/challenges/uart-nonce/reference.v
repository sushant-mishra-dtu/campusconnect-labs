// Reference solution: UART nonce echo, 115200 baud 8N1 from a 12 MHz clock
module top (
    input  wire       clk,
    input  wire [5:0] sw,
    input  wire [1:0] btn,
    output wire [7:0] led,
    input  wire       uart_rx,
    output wire       uart_tx
);

    localparam integer CLKS_PER_BIT = 104;
    localparam [7:0]   SYNC_BYTE    = 8'h55;
    localparam [7:0]   TERMINATOR   = 8'h0A;

    wire rst = btn[1];

    // ---------------- receiver ----------------
    reg [1:0] rx_sync = 2'b11;
    always @(posedge clk) rx_sync <= {rx_sync[0], uart_rx};
    wire rx = rx_sync[1];

    localparam [1:0] RX_IDLE = 2'd0, RX_START = 2'd1, RX_DATA = 2'd2, RX_STOP = 2'd3;
    reg [1:0] rx_state = RX_IDLE;
    reg [6:0] rx_clk   = 7'd0;
    reg [2:0] rx_bit   = 3'd0;
    reg [7:0] rx_shift = 8'd0;
    reg       rx_valid = 1'b0;
    reg [7:0] rx_byte  = 8'd0;

    always @(posedge clk) begin
        rx_valid <= 1'b0;
        if (rst) begin
            rx_state <= RX_IDLE;
            rx_clk   <= 7'd0;
        end else begin
            case (rx_state)
                RX_IDLE: if (!rx) begin
                    rx_state <= RX_START;
                    rx_clk   <= 7'd0;
                end
                RX_START: if (rx_clk == CLKS_PER_BIT / 2 - 1) begin
                    rx_clk <= 7'd0;
                    if (!rx) begin
                        rx_state <= RX_DATA;
                        rx_bit   <= 3'd0;
                    end else begin
                        rx_state <= RX_IDLE;  // glitch, not a start bit
                    end
                end else rx_clk <= rx_clk + 7'd1;
                RX_DATA: if (rx_clk == CLKS_PER_BIT - 1) begin
                    rx_clk   <= 7'd0;
                    rx_shift <= {rx, rx_shift[7:1]};
                    if (rx_bit == 3'd7) rx_state <= RX_STOP;
                    else                rx_bit   <= rx_bit + 3'd1;
                end else rx_clk <= rx_clk + 7'd1;
                RX_STOP: if (rx_clk == CLKS_PER_BIT - 1) begin
                    rx_clk   <= 7'd0;
                    rx_state <= RX_IDLE;
                    if (rx) begin
                        rx_valid <= 1'b1;
                        rx_byte  <= rx_shift;
                    end
                end else rx_clk <= rx_clk + 7'd1;
            endcase
        end
    end

    // ---------------- buffer + reply sequencer ----------------
    reg [7:0] buffer [0:7];
    reg [3:0] count    = 4'd0;
    reg [3:0] rd_idx   = 4'd0;
    reg       replying = 1'b0;

    // ---------------- transmitter ----------------
    reg [9:0] tx_frame = 10'h3ff;
    reg [3:0] tx_bit   = 4'd0;
    reg [6:0] tx_clk   = 7'd0;
    reg       tx_busy  = 1'b0;
    reg       tx_out   = 1'b1;

    always @(posedge clk) begin
        if (rst) begin
            count    <= 4'd0;
            rd_idx   <= 4'd0;
            replying <= 1'b0;
            tx_busy  <= 1'b0;
            tx_out   <= 1'b1;
        end else begin
            if (rx_valid && !replying) begin
                if (rx_byte == TERMINATOR) begin
                    replying <= 1'b1;
                    rd_idx   <= 4'd0;
                end else if (count < 4'd8) begin
                    buffer[count[2:0]] <= rx_byte;
                    count              <= count + 4'd1;
                end
            end

            if (tx_busy) begin
                if (tx_clk == CLKS_PER_BIT - 1) begin
                    tx_clk <= 7'd0;
                    if (tx_bit == 4'd9) begin
                        tx_busy <= 1'b0;
                    end else begin
                        tx_bit <= tx_bit + 4'd1;
                        tx_out <= tx_frame[tx_bit + 4'd1];
                    end
                end else tx_clk <= tx_clk + 7'd1;
            end else if (replying) begin
                if (rd_idx <= count) begin
                    tx_frame <= {1'b1, (rd_idx == 4'd0) ? SYNC_BYTE : buffer[rd_idx[2:0] - 3'd1], 1'b0};
                    tx_bit   <= 4'd0;
                    tx_clk   <= 7'd0;
                    tx_busy  <= 1'b1;
                    tx_out   <= 1'b0;  // start bit
                    rd_idx   <= rd_idx + 4'd1;
                end else begin
                    replying <= 1'b0;
                    count    <= 4'd0;
                end
            end
        end
    end

    assign uart_tx = tx_out;
    assign led     = {4'd0, count};

endmodule
