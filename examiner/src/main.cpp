// C-RTL examiner firmware (ESP32-S3).
//
// Talks line-delimited JSON over USB CDC to the lab node agent:
//   -> {"cmd":"info"}
//   <- {"type":"info","examiner":"ex-3fa21c","kind":"esp32","pubkey":"-----BEGIN PUBLIC KEY-----...","counter":118}
//   -> {"cmd":"run","attempt":"a7f3c2e1","challenge":"uart-nonce","node":"iiitd-01","nonce":"9c41e2"}
//   <- {"type":"log","line":"..."} ...
//   <- {"type":"verdict","payload":"{...}","sig":"MEUCIQ..."}
//
// The examiner, not the lab node, decides pass/fail, and the private key never leaves
// this chip. The lab node only relays.
#include <Arduino.h>
#include <ArduinoJson.h>

#include "pins.h"
#include "signer.h"
#include "tests.h"

static String lineBuf;
static bool ready = false;

static void sendJson(JsonDocument &doc) {
  serializeJson(doc, Serial);
  Serial.print('\n');
}

static void logLine(const String &s) {
  JsonDocument d;
  d["type"] = "log";
  d["line"] = s;
  sendJson(d);
}

static void sendError(const String &msg) {
  JsonDocument d;
  d["type"] = "error";
  d["message"] = msg;
  sendJson(d);
}

// Fields copied into the payload come from the lab node, so only allow [a-z0-9-].
static bool safeToken(const char *s, size_t maxLen) {
  if (!s) return false;
  size_t n = strlen(s);
  if (n == 0 || n > maxLen) return false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (!(isdigit(c) || (c >= 'a' && c <= 'z') || c == '-')) return false;
  }
  return true;
}

static void sendInfo() {
  JsonDocument d;
  d["type"] = "info";
  d["examiner"] = signer::examinerId();
  d["kind"] = "esp32";
  d["pubkey"] = signer::publicKeyPem();
  d["counter"] = signer::counter();
  sendJson(d);
}

static void handleRun(JsonDocument &cmd) {
  const char *attempt = cmd["attempt"];
  const char *challenge = cmd["challenge"];
  const char *node = cmd["node"];
  const char *nonceHex = cmd["nonce"];
  if (!safeToken(attempt, 32) || !safeToken(challenge, 32) || !safeToken(node, 32) || !safeToken(nonceHex, 6) || strlen(nonceHex) != 6) {
    sendError("bad run command");
    return;
  }
  uint32_t nonce = strtoul(nonceHex, nullptr, 16);

  tests::Result r;
  if (!strcmp(challenge, "switch-decoder")) r = tests::switchDecoder(nonce, logLine);
  else if (!strcmp(challenge, "debounce-counter")) r = tests::debounceCounter(nonce, logLine);
  else if (!strcmp(challenge, "pwm-duty")) r = tests::pwmDuty(nonce, logLine);
  else if (!strcmp(challenge, "uart-nonce")) r = tests::uartNonce(nonce, logLine);
  else {
    sendError(String("unknown challenge ") + challenge);
    return;
  }
  logLine("measured " + r.measured);

  uint32_t counter = signer::nextCounter();
  String payload = String("{\"v\":2,\"attempt\":\"") + attempt + "\",\"challenge\":\"" + challenge + "\",\"node\":\"" + node +
                   "\",\"examiner\":\"" + signer::examinerId() + "\",\"kind\":\"esp32\",\"target\":\"fpga\",\"nonce\":\"" + nonceHex +
                   "\",\"counter\":" + String(counter) + ",\"measured\":" + r.measured + ",\"result\":\"" + (r.pass ? "pass" : "fail") + "\"}";
  String sig;
  if (!signer::sign(payload, sig)) {
    sendError("signing failed");
    return;
  }
  JsonDocument d;
  d["type"] = "verdict";
  d["payload"] = payload;
  d["sig"] = sig;
  sendJson(d);
}

static void handleLine(const String &line) {
  JsonDocument cmd;
  if (deserializeJson(cmd, line)) {
    sendError("bad JSON");
    return;
  }
  const char *c = cmd["cmd"];
  if (!c) return;
  if (!ready) {
    sendError("examiner key not initialised");
    return;
  }
  if (!strcmp(c, "info")) sendInfo();
  else if (!strcmp(c, "run")) handleRun(cmd);
  else sendError(String("unknown command ") + c);
}

void setup() {
  Serial.begin(115200);
  // RX on an unused pin: the reply is captured with edge timestamps, not the UART.
  Serial1.begin(115200, SERIAL_8N1, 10, PIN_FPGA_RX);
  tests::begin();
  ready = signer::begin();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      lineBuf.trim();
      if (lineBuf.length()) handleLine(lineBuf);
      lineBuf = "";
    } else if (lineBuf.length() < 512) {
      lineBuf += c;
    }
  }
}
