// The exact bytes the examiner signs. Field order is fixed so the ESP32 firmware
// (which builds this string with snprintf) and the sim examiner produce the same shape.
// The server verifies the signature over the string as received, so order only matters
// for humans reading it.

// What the examiner actually tested. Signed, so a proof can't later claim more than it was:
//   netlist    the synthesized iCE40 gate-level netlist, in a simulator (no FPGA)
//   bitstream  the placed-and-routed iCE40 bitstream read back to Verilog, in a simulator (no FPGA)
//   fpga       a physical iCE40 board, driven and measured by the ESP32 examiner
export type Target = 'netlist' | 'bitstream' | 'fpga';

export interface VerdictFields {
  attempt: string;
  challenge: string;
  node: string;
  examiner: string;
  kind: 'sim' | 'esp32';
  target: Target;
  nonce: string;
  counter: number;
  measured: Record<string, unknown>;
  result: 'pass' | 'fail';
}

export function buildPayload(f: VerdictFields) {
  return JSON.stringify({
    v: 2,
    attempt: f.attempt,
    challenge: f.challenge,
    node: f.node,
    examiner: f.examiner,
    kind: f.kind,
    target: f.target,
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
