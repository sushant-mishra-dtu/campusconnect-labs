// Operator commands for lab nodes. Run on the server machine, not exposed over HTTP.
//
//   npm run admin -w server -- list
//   npm run admin -w server -- enroll <node> <examiner-pubkey.pem> [note]
//   npm run admin -w server -- revoke <node>
//   npm run admin -w server -- token <node>
//   npm run admin -w server -- unpin <node>
//
// enroll: trust this key as an ESP32 examiner (key generated on the chip, never exported) for
//   the node. Only enrolled keys earn "Verified on silicon", and an enrolled key may pair with
//   the node even after the pairing window closed. Get the key from the board with
//   `npm run examiner:info -w labnode -- --mode=hw --serial=<port>`.
// token: issue a new node token (the old one stops working) and, if no key is pinned yet,
//   reopen the 24 h pairing window.
// unpin: forget the pinned examiner key and reopen pairing, e.g. after replacing the board.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { all, enforceEnrollment, one, run, type NodeRow } from './db.js';
import { fingerprint, keyHash, now, PAIRING_WINDOW_MS, sha256 } from './util.js';

const [cmd, nodeId, ...rest] = process.argv.slice(2);

function node(): NodeRow {
  const n = nodeId ? one<NodeRow>('SELECT * FROM nodes WHERE id = ?', nodeId) : undefined;
  if (!n) {
    console.error(nodeId ? `no node ${nodeId}` : 'which node?');
    process.exit(1);
  }
  return n;
}

function when(ms: number | null) {
  return ms ? new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : '-';
}

switch (cmd) {
  case 'list': {
    for (const n of all<NodeRow>('SELECT * FROM nodes ORDER BY id')) {
      const enrolled = all<{ key_sha256: string; note: string | null }>('SELECT * FROM silicon_examiners WHERE node_id = ?', n.id);
      console.log(`${n.id}  ${n.name}`);
      console.log(`  pinned:   ${n.examiner_pubkey ? `${n.examiner_id} ${fingerprint(n.examiner_pubkey)} (${n.examiner_kind})` : 'nothing'}`);
      if (!n.examiner_pubkey) console.log(`  pairing:  ${n.pin_open_until && n.pin_open_until > now() ? `open until ${when(n.pin_open_until)}` : 'closed'}`);
      for (const e of enrolled) console.log(`  silicon:  sha256 ${e.key_sha256.slice(0, 16)}… ${e.note ?? ''}`);
    }
    break;
  }
  case 'enroll': {
    const n = node();
    const [pemPath, ...note] = rest;
    if (!pemPath) {
      console.error('enroll <node> <examiner-pubkey.pem> [note]');
      process.exit(1);
    }
    // the file may be examiner:info output, with log lines around the key
    const pem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(fs.readFileSync(pemPath, 'utf8'))?.[0];
    if (!pem) {
      console.error(`no PEM public key in ${pemPath}`);
      process.exit(1);
    }
    const hash = keyHash(pem);
    const der = crypto.createPublicKey(pem);
    if (der.asymmetricKeyType !== 'ec' || der.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      console.error('expected an ECDSA P-256 public key');
      process.exit(1);
    }
    run('INSERT OR REPLACE INTO silicon_examiners (key_sha256, node_id, note, enrolled_at) VALUES (?, ?, ?, ?)',
      hash, n.id, note.join(' ') || null, now());
    if (n.examiner_pubkey && keyHash(n.examiner_pubkey) === hash) {
      run("UPDATE nodes SET examiner_kind = 'esp32' WHERE id = ?", n.id);
    } else if (n.examiner_pubkey) {
      console.log(`note: ${n.id} has a different key pinned (${fingerprint(n.examiner_pubkey)}); run "unpin ${n.id}" to switch to this one`);
    } else {
      console.log(`${n.id} has no key pinned; this examiner gets pinned when its lab node connects`);
    }
    console.log(`enrolled ${fingerprint(pem)} as a silicon examiner for ${n.id}`);
    break;
  }
  case 'revoke': {
    const n = node();
    const r = run('DELETE FROM silicon_examiners WHERE node_id = ?', n.id);
    enforceEnrollment();
    console.log(`removed ${r.changes} enrollment(s) for ${n.id}; its proofs are now labelled simulation and its ESP32 is refused until enrolled again`);
    break;
  }
  case 'token': {
    const n = node();
    const token = crypto.randomBytes(18).toString('base64url');
    run('UPDATE nodes SET token_hash = ?, pin_open_until = ? WHERE id = ?',
      sha256(token), n.examiner_pubkey ? null : now() + PAIRING_WINDOW_MS, n.id);
    console.log(`new token for ${n.id} (shown once, only its hash is stored):\n${token}`);
    break;
  }
  case 'unpin': {
    const n = node();
    run('UPDATE nodes SET examiner_id = NULL, examiner_kind = NULL, examiner_pubkey = NULL, last_counter = -1, pin_open_until = ? WHERE id = ?',
      now() + PAIRING_WINDOW_MS, n.id);
    console.log(`unpinned ${n.id}; the next examiner to connect with its token in the next 24 h gets pinned`);
    break;
  }
  default:
    console.error('usage: admin list | enroll <node> <pubkey.pem> [note] | revoke <node> | token <node> | unpin <node>');
    process.exit(1);
}
