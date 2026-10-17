// Re-verify an examiner signature in the browser with WebCrypto, so nobody has to
// take the platform's word for it.

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pemToDer(pem: string) {
  return b64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
}

// Examiners emit DER (what mbedTLS and Node produce); WebCrypto wants raw r||s.
function derToRaw(der: Uint8Array, size = 32) {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('signature is not a DER sequence');
  const len = der[i++];
  if (len & 0x80) i += len & 0x7f;
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error('bad DER integer');
    const l = der[i++];
    let v = der.slice(i, i + l);
    i += l;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

export function webCryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export async function verifySignature(publicKeyPem: string, payload: string, sigB64: string) {
  const key = await crypto.subtle.importKey('spki', pemToDer(publicKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(b64ToBytes(sigB64)), new TextEncoder().encode(payload));
}
