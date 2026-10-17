// Software stand-in for the ESP32 examiner, used when a node has no board attached.
// Same protocol and payload, but the key lives in a file on the lab node machine, so
// the platform labels these proofs "simulation" rather than "verified on silicon".
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildPayload, type SignedVerdict } from '../payload.js';

export interface ExaminerIdentity {
  id: string;
  kind: 'sim' | 'esp32';
  pubkey: string;
}

export class SimExaminer {
  private key: crypto.KeyObject;
  private counterPath: string;
  readonly identity: ExaminerIdentity;

  constructor(keysDir: string, nodeId: string) {
    fs.mkdirSync(keysDir, { recursive: true });
    const keyPath = path.join(keysDir, `sim-${nodeId}.pem`);
    this.counterPath = path.join(keysDir, `sim-${nodeId}.counter`);
    if (!fs.existsSync(keyPath)) {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    this.key = crypto.createPrivateKey(fs.readFileSync(keyPath));
    const pubkey = crypto.createPublicKey(this.key).export({ type: 'spki', format: 'pem' }).toString();
    this.identity = { id: `sim-${nodeId}`, kind: 'sim', pubkey };
  }

  // Monotonic counter, persisted before the verdict leaves, so a crash can't reuse a value.
  private nextCounter() {
    const cur = fs.existsSync(this.counterPath) ? Number(fs.readFileSync(this.counterPath, 'utf8')) || 0 : 0;
    const next = cur + 1;
    fs.writeFileSync(this.counterPath, String(next));
    return next;
  }

  sign(fields: { attempt: string; challenge: string; node: string; nonce: string; measured: Record<string, unknown>; result: 'pass' | 'fail' }): SignedVerdict {
    const payload = buildPayload({ ...fields, examiner: this.identity.id, kind: 'sim', counter: this.nextCounter() });
    const sig = crypto.sign('sha256', Buffer.from(payload, 'utf8'), this.key).toString('base64');
    return { payload, sig };
  }
}
