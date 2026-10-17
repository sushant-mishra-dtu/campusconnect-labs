// ESP32-S3-DevKitC-1 wiring to the iCEBreaker PMODs. See docs/HARDWARE.md.
// Avoids strapping pins (0, 3, 45, 46), USB (19, 20) and the octal-PSRAM pins (35-37).
#pragma once
#include <Arduino.h>

// examiner -> FPGA
static const uint8_t PIN_SW[6] = {4, 5, 6, 7, 15, 16};  // sw[0..5]   -> PMOD 1B
static const uint8_t PIN_BTN0 = 17;                      // btn[0]     -> P1B9
static const uint8_t PIN_BTN1 = 18;                      // btn[1]     -> P1B10 (reset)
static const uint8_t PIN_FPGA_RX = 8;                    // Serial1 TX -> FPGA uart_rx (P2_1)

// FPGA -> examiner
static const uint8_t PIN_LED[8] = {1, 2, 42, 41, 40, 39, 38, 21};  // led[0..7] <- PMOD 1A
static const uint8_t PIN_FPGA_TX = 9;                                // FPGA uart_tx (P2_2)
