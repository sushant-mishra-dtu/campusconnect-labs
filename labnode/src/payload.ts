// The exact bytes the examiner signs. Field order is fixed so the ESP32 firmware
// (which builds this string with snprintf) and the sim examiner produce the same shape.
// The server verifies the signature over the string as received, so order only matters
// for humans reading it.
export interface VerdictFields {
  attempt: string;
  challenge: string;
  node: string;
  examiner: string;
  kind: 'sim' | 'esp32';
  nonce: string;
  counter: number;
  measured: Record<string, unknown>;
  result: 'pass' | 'fail';
}

export function buildPayload(f: VerdictFields) {
  return JSON.stringify({
    v: 1,
    attempt: f.attempt,
    challenge: f.challenge,
    node: f.node,
    examiner: f.examiner,
    kind: f.kind,
    nonce: f.nonce,
    counter: f.counter,
    measured: f.measured,
    result: f.result,
  });
}

export interface SignedVerdict {
  payload: string;
  sig: string;
}
