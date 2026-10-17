// Hardware versions of the rtl/challenges/*/tb.v examiners. Same stimulus (derived from
// the nonce with the same LFSR), same pass criteria, same "measured" fields.
#pragma once
#include <Arduino.h>

namespace tests {

using Log = void (*)(const String &);

struct Result {
  bool pass;
  String measured;  // one JSON object, copied verbatim into the signed payload
};

void begin();

Result switchDecoder(uint32_t nonce, Log log);
Result debounceCounter(uint32_t nonce, Log log);
Result pwmDuty(uint32_t nonce, Log log);
Result uartNonce(uint32_t nonce, Log log);

}  // namespace tests
