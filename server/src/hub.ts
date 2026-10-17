// WebSocket hub. Lab node agents connect on /ws/node, browsers on /ws/client.
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { userFromToken } from './auth.js';
import { all, one, run, tx, type AttemptRow, type ChallengeRow, type NodeRow } from './db.js';
import { notify } from './notify.js';
import { broadcast, clients, nodeSockets, pushToWatchers } from './presence.js';
import { TESTS } from './tests.js';
import { fingerprint, keyHash, now, prefixedId, sha256 } from './util.js';
import { checkVerdict } from './verdict.js';
import { attemptView } from './views.js';

const LOG_CAP = 64 * 1024;
const timers = new Map<string, NodeJS.Timeout>();

type NodeMsg =
  | { type: 'hello'; node: string; token: string; examiner: { id: string; kind: string; pubkey: string }; mode?: string }
  | { type: 'status'; attempt: string; stage: string }
  | { type: 'log'; attempt: string; line: string }
  | { type: 'verdict'; attempt: string; payload: string; sig: string }
  | { type: 'error'; attempt: string; stage?: string; message: string };

function getAttempt(id: string) {
  return one<AttemptRow>('SELECT * FROM attempts WHERE id = ?', id);
}

function publishAttempt(id: string) {
  const a = getAttempt(id);
  if (a) pushToWatchers(id, { type: 'attempt', attempt: attemptView(a) });
}

function appendLog(id: string, line: string) {
  const a = getAttempt(id);
  if (!a) return;
  const next = (a.log + line + '\n').slice(-LOG_CAP);
  run('UPDATE attempts SET log = ? WHERE id = ?', next, id);
  pushToWatchers(id, { type: 'log', attempt: id, line });
}

function finishWithError(id: string, message: string, stage?: string) {
  const a = getAttempt(id);
  if (!a || !['queued', 'running'].includes(a.status)) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  appendLog(id, `[platform] ${message}`);
  run("UPDATE attempts SET status = 'error', stage = ?, reject_reason = ?, finished_at = ? WHERE id = ?",
    stage ?? a.stage, message, now(), id);
  publishAttempt(id);
}

export function cancelAttemptsForBooking(bookingId: string) {
  for (const a of all<AttemptRow>("SELECT * FROM attempts WHERE booking_id = ? AND status IN ('queued','running')", bookingId)) {
    finishWithError(a.id, 'booking cancelled');
  }
}

// ------------------------------------------------------------------ dispatch

export function dispatchAttempt(a: AttemptRow) {
  const ws = nodeSockets.get(a.node_id);
  if (!ws) {
    finishWithError(a.id, 'lab node is offline');
    return;
  }
  ws.send(JSON.stringify({ type: 'job', attempt: a.id, challenge: a.test_id, nonce: a.nonce, code: a.code }));
  appendLog(a.id, `[platform] booking ok, nonce ${a.nonce} issued, sent to ${a.node_id}`);
  const limit = ((TESTS.get(a.test_id)?.maxSeconds ?? 30) + 90) * 1000;
  timers.set(a.id, setTimeout(() => finishWithError(a.id, 'lab node did not return a verdict in time'), limit));
}

// ------------------------------------------------------------------ verdicts

function acceptVerdict(nodeId: string, attemptId: string, payloadText: string, sig: string) {
  const a = getAttempt(attemptId);
  const node = one<NodeRow>('SELECT * FROM nodes WHERE id = ?', nodeId);
  if (!a || !node || a.node_id !== nodeId) return;
  if (!['queued', 'running'].includes(a.status)) {
    appendLog(attemptId, '[platform] ignored a second verdict for a finished attempt');
    return;
  }
  clearTimeout(timers.get(attemptId));
  timers.delete(attemptId);

  const check = checkVerdict(a, node, payloadText, sig);
  for (const c of check.checks) appendLog(attemptId, `[platform] ✓ ${c}`);

  if (!check.ok) {
    appendLog(attemptId, `[platform] ✗ verdict rejected: ${check.reason}`);
    run(`UPDATE attempts SET status = 'rejected', stage = 'verify', payload = ?, sig = ?, reject_reason = ?,
         examiner_id = ?, examiner_kind = ?, examiner_pubkey = ?, finished_at = ? WHERE id = ?`,
      payloadText, sig, check.reason, node.examiner_id, node.examiner_kind, node.examiner_pubkey, now(), attemptId);
    publishAttempt(attemptId);
    return;
  }

  const p = check.payload;
  const ch = one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', a.challenge_id)!;
  const t = now();
  let newBadge = false;
  let newProof = false;

  tx(() => {
    run('UPDATE nodes SET last_counter = ? WHERE id = ?', p.counter, nodeId);
    run(`UPDATE attempts SET status = 'verified', stage = 'verified', payload = ?, sig = ?, result = ?, verified = 1,
         examiner_id = ?, examiner_kind = ?, examiner_pubkey = ?, finished_at = ? WHERE id = ?`,
      payloadText, sig, p.result, node.examiner_id, node.examiner_kind, node.examiner_pubkey, t, attemptId);

    if (p.result !== 'pass') return;

    newBadge = run('INSERT OR IGNORE INTO badges (id, user_id, test_id, attempt_id, kind, issued_at) VALUES (?, ?, ?, ?, ?, ?)',
      prefixedId('bd'), a.user_id, a.test_id, a.id, node.examiner_kind ?? 'sim', t).changes > 0;

    // The proof creates the connection: student -> challenge author. Once per challenge,
    // so passing again doesn't put the same student in the author's inbox twice.
    if (ch.author_id !== a.user_id &&
        !one("SELECT 1 FROM connections WHERE from_id = ? AND to_id = ? AND type = 'proved_for' AND challenge_id = ?", a.user_id, ch.author_id, ch.id)) {
      run(`INSERT INTO connections (id, from_id, to_id, type, attempt_id, challenge_id, node_id, created_at)
           VALUES (?, ?, ?, 'proved_for', ?, ?, ?, ?)`,
        prefixedId('e'), a.user_id, ch.author_id, a.id, ch.id, nodeId, t);
      newProof = true;
    }
    // And the club that lent the board is linked to the student it served.
    if (node.owner_id !== a.user_id &&
        !one("SELECT 1 FROM connections WHERE from_id = ? AND to_id = ? AND type = 'lent_board' AND node_id = ?", node.owner_id, a.user_id, nodeId)) {
      run(`INSERT INTO connections (id, from_id, to_id, type, attempt_id, node_id, created_at)
           VALUES (?, ?, ?, 'lent_board', ?, ?, ?)`,
        prefixedId('e'), node.owner_id, a.user_id, a.id, nodeId, t);
    }
  });

  appendLog(attemptId, `[platform] verdict accepted: ${p.result.toUpperCase()}`);
  if (p.result === 'pass') {
    const student = one<{ name: string }>('SELECT name FROM users WHERE id = ?', a.user_id)!;
    appendLog(attemptId, `[platform] ${newBadge ? 'badge issued' : 'badge already held'}, ${
      newProof ? 'connection created' : ch.author_id === a.user_id ? 'no connection to yourself' : 'already connected for this challenge'}`);
    if (newProof) notify(ch.author_id, `${student.name} passed “${ch.title}” on ${node.name}. The signed proof is attached.`, `/proof/${a.id}`);
    notify(node.owner_id, `Your board ${node.name} just verified a pass for ${student.name}.`, `/proof/${a.id}`);
    broadcast({ type: 'network' });
  }
  publishAttempt(attemptId);
}

// ------------------------------------------------------------------ node sockets

function handleNode(ws: WebSocket) {
  let nodeId: string | null = null;

  ws.on('message', (raw) => {
    let msg: NodeMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      const reject = (reason: string, retry = false) => {
        ws.send(JSON.stringify({ type: 'rejected', reason, retry }));
        ws.close();
      };
      const node = one<NodeRow>('SELECT * FROM nodes WHERE id = ?', msg.node);
      if (!node || node.token_hash !== sha256(String(msg.token ?? ''))) return reject('unknown node or bad token');
      const ex = msg.examiner;
      if (!ex?.pubkey || !ex.id) return reject('hello must include the examiner id and public key');
      let exHash: string;
      try {
        exHash = keyHash(ex.pubkey);
      } catch {
        return reject('examiner public key is not a valid PEM key');
      }
      // A second session doesn't replace a live one; the agent retries until the old one is gone.
      const live = nodeSockets.get(node.id);
      if (live && live !== ws && live.readyState === WebSocket.OPEN) return reject('this node already has an open session', true);

      // Silicon trust comes only from the operator's enrollment list, never from the hello.
      const enrolled = !!one('SELECT 1 FROM silicon_examiners WHERE node_id = ? AND key_sha256 = ?', node.id, exHash);
      const kind = enrolled ? 'esp32' : 'sim';
      // The examiner signs its own kind into every verdict, and a verdict whose kind disagrees with
      // the platform's is refused. Turn the node away now instead of failing each attempt later.
      if ((ex.kind ?? 'sim') !== kind) {
        console.warn(`[hub] node ${node.id}: examiner ${fingerprint(ex.pubkey)} says ${ex.kind}, enrollment says ${kind}; refused`);
        return reject(kind === 'sim'
          ? `ESP32 examiner ${fingerprint(ex.pubkey)} is not enrolled for ${node.id}. Send its public key to the platform operator, who runs: npm run admin -w server -- enroll ${node.id} <examiner.pem>`
          : `key ${fingerprint(ex.pubkey)} is enrolled as an ESP32 examiner for ${node.id}; start the lab node with --mode=hw`);
      }

      if (node.examiner_pubkey) {
        if (keyHash(node.examiner_pubkey) !== exHash) {
          return reject(`examiner key ${fingerprint(ex.pubkey)} does not match the pinned key ${fingerprint(node.examiner_pubkey)}`);
        }
        if (node.examiner_kind !== kind) run('UPDATE nodes SET examiner_kind = ? WHERE id = ?', kind, node.id);
      } else {
        // Trust on first use, but only inside the pairing window opened when the token was issued
        // (or for an enrolled key). Pinning closes the window.
        if (!enrolled && !(node.pin_open_until && node.pin_open_until > now())) {
          return reject('no examiner key is pinned and the pairing window has closed; ask the platform operator to reopen it');
        }
        run('UPDATE nodes SET examiner_id = ?, examiner_kind = ?, examiner_pubkey = ?, last_counter = -1, pin_open_until = NULL WHERE id = ?',
          ex.id, kind, ex.pubkey, node.id);
      }
      nodeSockets.set(node.id, ws);
      nodeId = node.id;
      run('UPDATE nodes SET last_seen = ? WHERE id = ?', now(), node.id);
      ws.send(JSON.stringify({ type: 'welcome', node: node.id, fingerprint: fingerprint(ex.pubkey), kind }));
      console.log(`[hub] node ${node.id} online (examiner ${ex.id}, ${fingerprint(ex.pubkey)}, ${kind})`);
      broadcast({ type: 'nodes' });
      return;
    }

    if (!nodeId) return;
    const a = 'attempt' in msg ? getAttempt(msg.attempt) : undefined;
    if (!a || a.node_id !== nodeId) return;

    switch (msg.type) {
      case 'status':
        run("UPDATE attempts SET status = 'running', stage = ? WHERE id = ? AND status IN ('queued','running')", msg.stage, a.id);
        publishAttempt(a.id);
        break;
      case 'log':
        appendLog(a.id, String(msg.line).slice(0, 2000));
        break;
      case 'verdict':
        acceptVerdict(nodeId, a.id, String(msg.payload), String(msg.sig));
        break;
      case 'error':
        finishWithError(a.id, msg.message, msg.stage);
        break;
    }
  });

  ws.on('close', () => {
    if (nodeId && nodeSockets.get(nodeId) === ws) {
      nodeSockets.delete(nodeId);
      run('UPDATE nodes SET last_seen = ? WHERE id = ?', now(), nodeId);
      console.log(`[hub] node ${nodeId} offline`);
      failOrphanedAttempts(nodeId);
      broadcast({ type: 'nodes' });
    }
  });
}

// ------------------------------------------------------------------ browser sockets

function handleClient(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = userFromToken(url.searchParams.get('token'));
  clients.set(ws, { userId: user?.id ?? null, watching: new Set() });

  ws.on('message', (raw) => {
    let msg: { type: string; attempt?: string };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const st = clients.get(ws);
    if (!st) return;
    if (msg.type === 'watch' && msg.attempt) {
      const a = getAttempt(msg.attempt);
      if (a && a.user_id === st.userId) {
        st.watching.add(a.id);
        ws.send(JSON.stringify({ type: 'attempt', attempt: attemptView(a, { log: true }) }));
      }
    }
    if (msg.type === 'unwatch' && msg.attempt) st.watching.delete(msg.attempt);
  });

  ws.on('close', () => clients.delete(ws));
}

// ------------------------------------------------------------------ wiring

export function attachHub(server: Server) {
  const nodeWss = new WebSocketServer({ noServer: true });
  const clientWss = new WebSocketServer({ noServer: true });
  nodeWss.on('connection', (ws) => handleNode(ws));
  clientWss.on('connection', (ws, req) => handleClient(ws, req));

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/ws/node') nodeWss.handleUpgrade(req, socket, head, (ws) => nodeWss.emit('connection', ws, req));
    else if (path === '/ws/client') clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
    else socket.destroy();
  });

  // Drop dead sockets so the Labs page doesn't show a node as online when it isn't.
  const alive = new WeakMap<WebSocket, boolean>();
  for (const wss of [nodeWss, clientWss]) {
    wss.on('connection', (ws) => {
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
    });
  }
  setInterval(() => {
    for (const wss of [nodeWss, clientWss]) {
      for (const ws of wss.clients) {
        if (!alive.get(ws)) {
          ws.terminate();
          continue;
        }
        alive.set(ws, false);
        ws.ping();
      }
    }
  }, 15_000).unref();
}

// A node that drops mid-attempt can't deliver a verdict; fail those attempts so the
// student isn't left watching a spinner. Also runs at startup for attempts left over
// from a previous server process.
export function failOrphanedAttempts(onlyNode?: string) {
  const rows = all<AttemptRow>("SELECT * FROM attempts WHERE status IN ('queued','running')");
  for (const a of rows) {
    if (onlyNode && a.node_id !== onlyNode) continue;
    if (!timers.has(a.id) || !nodeSockets.has(a.node_id)) {
      finishWithError(a.id, 'lab node went offline before returning a verdict');
    }
  }
}
