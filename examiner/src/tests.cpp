#include "tests.h"

#include "pins.h"
#include "soc/gpio_reg.h"

namespace {

inline uint32_t IRAM_ATTR ccount() {
  uint32_t c;
  asm volatile("rsr %0, ccount" : "=r"(c));
  return c;
}

uint32_t cpuHz() { return getCpuFrequencyMhz() * 1000000UL; }

void setSw(uint8_t v) {
  for (int i = 0; i < 6; i++) digitalWrite(PIN_SW[i], (v >> i) & 1);
}

uint8_t readLeds() {
  uint8_t v = 0;
  for (int i = 0; i < 8; i++) v |= (digitalRead(PIN_LED[i]) ? 1 : 0) << i;
  return v;
}

// btn[1] is the DUT's synchronous reset: hold it for 1 ms (12,000 FPGA clocks).
void resetDut() {
  digitalWrite(PIN_BTN0, LOW);
  setSw(0);
  digitalWrite(PIN_BTN1, HIGH);
  delay(1);
  digitalWrite(PIN_BTN1, LOW);
  delayMicroseconds(500);
}

// Same LFSR as the simulation examiner (rtl/challenges/debounce-counter/tb.v).
uint32_t lfsr;
void stepLfsr() {
  uint32_t b = ((lfsr >> 31) ^ (lfsr >> 21) ^ (lfsr >> 1) ^ lfsr) & 1;
  lfsr = (lfsr << 1) | b;
}

// FPGA uart_tx edge capture, timestamped with the CPU cycle counter.
const int MAX_EDGES = 128;
volatile uint32_t edgeT[MAX_EDGES];
volatile uint8_t edgeL[MAX_EDGES];
volatile int edgeN = 0;
volatile bool capturing = false;

inline int IRAM_ATTR txLevel() { return (REG_READ(GPIO_IN_REG) >> PIN_FPGA_TX) & 1; }

void IRAM_ATTR onTxEdge() {
  if (!capturing) return;
  int n = edgeN;
  if (n < MAX_EDGES) {
    edgeT[n] = ccount();
    edgeL[n] = txLevel();
    edgeN = n + 1;
  }
}

}  // namespace

namespace tests {

void begin() {
  for (uint8_t p : PIN_SW) pinMode(p, OUTPUT);
  pinMode(PIN_BTN0, OUTPUT);
  pinMode(PIN_BTN1, OUTPUT);
  for (uint8_t p : PIN_LED) pinMode(p, INPUT_PULLDOWN);
  pinMode(PIN_FPGA_TX, INPUT_PULLUP);
  setSw(0);
  digitalWrite(PIN_BTN0, LOW);
  digitalWrite(PIN_BTN1, LOW);
  attachInterrupt(PIN_FPGA_TX, onTxEdge, CHANGE);
}

// ------------------------------------------------------------------ switch-decoder

Result switchDecoder(uint32_t nonce, Log log) {
  resetDut();
  log("reset released, sweeping 64 switch vectors");
  int errors = 0;
  for (int i = 0; i < 64; i++) {
    uint8_t v = (i * 37 + (nonce & 0x3f)) & 0x3f;
    uint8_t b = (i & 1) ^ ((nonce >> 8) & 1);
    setSw(v);
    digitalWrite(PIN_BTN0, b);
    delayMicroseconds(5);
    uint8_t want = (b << 7) | (__builtin_parity(v) << 6) | (v ^ (v >> 1));
    uint8_t got = readLeds();
    if (got != want) {
      if (errors == 0) log("first mismatch: sw=" + String(v, BIN) + " expected " + String(want, BIN) + " got " + String(got, BIN));
      errors++;
    }
  }
  log(String(64 - errors) + " of 64 vectors correct");
  return {errors == 0, "{\"vectors\":64,\"errors\":" + String(errors) + "}"};
}

// ------------------------------------------------------------------ debounce-counter

static void bounce(bool lvl) {
  for (int n = 0; n < 9; n++) {
    stepLfsr();
    uint32_t w = 12 + (lfsr % 420);  // FPGA clock cycles, 12 per microsecond
    digitalWrite(PIN_BTN0, (n % 2 == 0) ? lvl : !lvl);
    delayMicroseconds(max<uint32_t>(1, w / 12));
  }
  digitalWrite(PIN_BTN0, lvl);
}

Result debounceCounter(uint32_t nonce, Log log) {
  lfsr = (0xa5UL << 24) | nonce | 1;
  int presses = 5 + ((nonce & 0xf) % 8);
  int errors = 0;
  resetDut();
  delay(2);
  log("reset released, making " + String(presses) + " bouncy presses");
  uint8_t got = 0;
  for (int p = 1; p <= presses; p++) {
    bounce(true);
    delay(3);
    bounce(false);
    delay(3);
    got = readLeds();
    if (got != p) {
      if (errors == 0) log("after press " + String(p) + " the LEDs show " + String(got));
      errors++;
    }
    digitalWrite(PIN_BTN0, HIGH);  // a 20 us glitch that must not count
    delayMicroseconds(20);
    digitalWrite(PIN_BTN0, LOW);
    delay(2);
  }
  got = readLeds();
  log("counted " + String(got) + " of " + String(presses) + " presses");
  return {errors == 0 && got == presses, "{\"presses\":" + String(presses) + ",\"counted\":" + String(got) + "}"};
}

// ------------------------------------------------------------------ pwm-duty

static bool measurePwm(uint32_t &high, uint32_t &period) {
  const uint32_t limit = cpuHz() / 1000 * 4;  // 4 ms
  uint32_t g = ccount();
  auto led = []() { return digitalRead(PIN_LED[0]); };
  while (led()) if (ccount() - g > limit) return false;
  while (!led()) if (ccount() - g > limit) return false;
  uint32_t t0 = ccount();
  while (led()) if (ccount() - g > limit) return false;
  uint32_t t1 = ccount();
  while (!led()) if (ccount() - g > limit) return false;
  uint32_t t2 = ccount();
  high = t1 - t0;
  period = t2 - t0;
  return true;
}

Result pwmDuty(uint32_t nonce, Log log) {
  resetDut();
  int errors = 0, points = 0;
  uint32_t hzMin = 0, hzMax = 0;
  float worst = 0;

  setSw(0);
  delayMicroseconds(2500);
  bool stuck = false;
  uint32_t t = micros();
  while (micros() - t < 2500) if (digitalRead(PIN_LED[0])) stuck = true;
  points++;
  if (stuck) errors++;
  log(stuck ? "sw=0: led[0] was not held low" : "sw=0: led[0] held low");

  for (int k = 0; k < 4; k++) {
    uint8_t s = 1 + (((nonce >> (6 * k)) & 0x3f) % 63);
    setSw(s);
    delayMicroseconds(2500);
    uint32_t high, period;
    points++;
    if (!measurePwm(high, period)) {
      errors++;
      log("sw=" + String(s) + ": no clean PWM edges on led[0]");
      continue;
    }
    uint32_t hz = cpuHz() / period;
    float err = fabsf((float)high * 64.0f / (float)period - (float)s);
    if (err > worst) worst = err;
    if (hzMin == 0 || hz < hzMin) hzMin = hz;
    if (hz > hzMax) hzMax = hz;
    log("sw=" + String(s) + ": " + String(hz) + " Hz, duty error " + String(err, 2) + "/64");
    if (hz < 950 || hz > 1050 || err > 1.0f) errors++;
  }
  String m = "{\"points\":" + String(points) + ",\"hz_min\":" + String(hzMin) + ",\"hz_max\":" + String(hzMax) +
             ",\"worst_duty_err\":\"" + String(worst, 2) + "\"}";
  return {errors == 0, m};
}

// ------------------------------------------------------------------ uart-nonce

static String hex2(uint8_t b) {
  const char *d = "0123456789abcdef";
  return String(d[b >> 4]) + d[b & 0xf];
}

Result uartNonce(uint32_t nonce, Log log) {
  resetDut();
  delayMicroseconds(400);
  bool early = txLevel() != 1;
  if (early) log("uart_tx is not idle-high after reset");

  uint8_t nb[3] = {(uint8_t)(nonce >> 16), (uint8_t)(nonce >> 8), (uint8_t)nonce};
  log("sending nonce " + hex2(nb[0]) + hex2(nb[1]) + hex2(nb[2]) + " then 0x0A");

  // Window 1: while the nonce goes out, uart_tx must stay quiet.
  edgeN = 0;
  capturing = true;
  Serial1.write(nb, 3);
  Serial1.flush();
  capturing = false;
  if (edgeN > 0) early = true;

  // Window 2: the terminator, then the reply.
  edgeN = 0;
  capturing = true;
  Serial1.write((uint8_t)0x0a);
  const uint32_t idle = cpuHz() / 1000000 * 200;  // 200 us of silence ends the reply
  uint32_t start = micros();
  while (micros() - start < 5000) {
    int n = edgeN;
    if (n >= 10 && txLevel() == 1 && ccount() - edgeT[n - 1] > idle) break;
  }
  capturing = false;
  int n = edgeN;

  uint32_t baud = 0;
  uint8_t echo[3] = {0, 0, 0};
  bool syncOk = false, framingOk = false;

  if (n < 10 || edgeL[0] != 0) {
    log(n == 0 ? "no reply within 1 ms of 0x0A" : "could not lock onto the 0x55 sync byte");
  } else {
    // 0x55 is start + 01010101 + stop: nine one-bit intervals.
    double bit = (double)(edgeT[9] - edgeT[0]) / 9.0;
    uint32_t ivMin = UINT32_MAX, ivMax = 0;
    for (int i = 0; i < 9; i++) {
      uint32_t iv = edgeT[i + 1] - edgeT[i];
      ivMin = min(ivMin, iv);
      ivMax = max(ivMax, iv);
    }
    syncOk = (uint64_t)ivMax * 4 <= (uint64_t)ivMin * 5;
    baud = (uint32_t)(cpuHz() / bit + 0.5);

    // Rebuild the bit stream from edge timings, then frame it.
    uint8_t bits[160];
    int nbits = 0;
    for (int i = 0; i < n && nbits < 150; i++) {
      int k = (i + 1 < n) ? (int)((edgeT[i + 1] - edgeT[i]) / bit + 0.5) : 12;
      for (int j = 0; j < k && nbits < 160; j++) bits[nbits++] = edgeL[i];
    }
    int idx = 0, frames = 0;
    uint8_t got[4] = {0, 0, 0, 0};
    framingOk = true;
    while (frames < 4) {
      while (idx < nbits && bits[idx] == 1) idx++;
      if (idx + 10 > nbits) break;
      uint8_t v = 0;
      for (int b = 0; b < 8; b++) v |= bits[idx + 1 + b] << b;
      if (bits[idx + 9] != 1) framingOk = false;
      got[frames++] = v;
      idx += 10;
    }
    if (frames < 4) framingOk = false;
    if (got[0] != 0x55) syncOk = false;
    memcpy(echo, got + 1, 3);
    log("reply after sync byte: " + hex2(echo[0]) + " " + hex2(echo[1]) + " " + hex2(echo[2]) + " at " + String(baud) + " baud");
  }
  if (early) log("uart_tx toggled while the examiner was transmitting");

  bool match = echo[0] == nb[0] && echo[1] == nb[1] && echo[2] == nb[2];
  bool pass = syncOk && framingOk && !early && match && baud >= 111744 && baud <= 118656;
  String m = "{\"baud\":" + String(baud) + ",\"echo\":\"" + hex2(echo[0]) + hex2(echo[1]) + hex2(echo[2]) + "\",\"early_tx\":" + String(early ? 1 : 0) + "}";
  return {pass, m};
}

}  // namespace tests
