// P-256 key that is generated on the chip and never leaves it, plus the replay counter.
#pragma once
#include <Arduino.h>

namespace signer {

// Loads the key from NVS, or generates and stores one on first boot.
bool begin();

// Short id derived from the chip's MAC, e.g. "ex-3fa21c".
const char *examinerId();

// SubjectPublicKeyInfo PEM, what the platform pins for this node.
const char *publicKeyPem();

uint32_t counter();

// Increments and persists the counter before returning it, so a crash can't reuse one.
uint32_t nextCounter();

// ECDSA-SHA256 over the exact payload bytes; DER signature, base64 encoded.
bool sign(const String &payload, String &sigB64);

}  // namespace signer
