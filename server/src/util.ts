import crypto from 'node:crypto';

export const now = () => Date.now();

// A node's agent has this long after its token is issued to connect and pin its examiner key.
export const PAIRING_WINDOW_MS = 24 * 60 * 60_000;

export function hexId(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function prefixedId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export function sha256(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Short, human-checkable fingerprint of a PEM public key (SHA-256 over the DER bytes).
export function fingerprint(pem: string | null | undefined) {
  if (!pem) return null;
  try {
    const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
    const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
    return hex.match(/.{4}/g)!.join(':');
  } catch {
    return null;
  }
}

// Full SHA-256 over the DER public key: what an enrollment matches against.
export function keyHash(pem: string) {
  const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
