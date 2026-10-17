# Verdict protocol

How a pass on someone else's board becomes a connection the platform will stand behind.

## 1. Attempt

The student's browser sends `POST /api/attempts { challenge_id, node_id, code }`. The platform refuses unless:

- the student holds a booking on that node that is live right now,
- the node's agent is connected,
- the student has no other attempt running on that node.

It then creates an attempt with an 8-hex-digit id and a fresh 3-byte **nonce**, and sends the job down the node's WebSocket:

```json
{ "type": "job", "attempt": "a7f3c2e1", "challenge": "uart-nonce", "nonce": "9c41e2", "code": "module top ..." }
```

For `uart-nonce` the platform never issues a nonce containing `0x0A`, the protocol's terminator byte.

## 2. Build, flash, examine

The lab node streams `status` and `log` messages while it works:

```json
{ "type": "status", "attempt": "a7f3c2e1", "stage": "build" }
{ "type": "log", "attempt": "a7f3c2e1", "line": "[yosys] fits in UP5K: 145 LUT4 / 5280, 126 DFF, 22 carry" }
```

Stages: `received → build → flash → examine → sign`. Errors before the examiner runs (lint, synthesis, compile, iceprog) come back as `{ "type": "error" }` and are never signed.

## 3. What the examiner signs

The examiner (ESP32-S3, or the sim examiner when a node has no board) builds this string and signs its exact UTF-8 bytes with ECDSA P-256 over SHA-256. The signature is DER, base64-encoded.

```json
{"v":1,"attempt":"a7f3c2e1","challenge":"uart-nonce","node":"iiitd-01","examiner":"ex-3fa21c","kind":"esp32","nonce":"9c41e2","counter":118,"measured":{"baud":115385,"echo":"9c41e2","early_tx":0},"result":"pass"}
```

| Field | Meaning |
|---|---|
| `attempt`, `challenge`, `node`, `nonce` | copied from the job; the ESP32 only accepts `[a-z0-9-]` in them |
| `examiner` | id of the signing chip |
| `kind` | `esp32` for a hardware examiner, `sim` for the software one |
| `counter` | monotonic, persisted before the verdict is sent |
| `measured` | what the examiner observed on the pins (fields per challenge, see `rtl/challenges/*/spec.md`) |
| `result` | `pass` or `fail`, decided by the examiner |

The node relays it unchanged:

```json
{ "type": "verdict", "attempt": "a7f3c2e1", "payload": "<the string above>", "sig": "MEUCIQ..." }
```

## 4. What the platform checks

`server/src/verdict.ts`, tested in `server/src/verdict.test.ts`:

1. The signature verifies against the examiner public key **pinned** for this node.
2. `nonce` equals the nonce issued for this attempt.
3. `attempt`, `node`, `examiner` and `challenge` match the attempt and node.
4. `counter` is greater than the last counter accepted from this examiner (replay protection).
5. The attempt started inside a booking held by this student on this node, and the verdict arrived before the booking ended (plus 5 minutes grace).

A verdict that fails any check is stored with status `rejected` and the reason. A verdict that passes is stored as `verified`, along with a snapshot of the public key, so anyone can re-check it later at `/proof/<attempt>`.

## 5. What a verified pass creates

- a **badge** for the student (one per test, first pass wins),
- a `proved_for` **connection** from the student to the challenge author, with the attempt attached,
- a `lent_board` connection from the club that owns the node to the student (once per club/student/node),
- notifications to the author and the club.

The author can then act on the proof (`POST /api/connections/:id/act`), which adds a `referred` or `mentored` connection whose `parent_id` points back at the proof.

## Key pinning

The node sends its examiner identity in its first message:

```json
{ "type": "hello", "node": "iiitd-01", "token": "…", "examiner": { "id": "ex-3fa21c", "kind": "esp32", "pubkey": "-----BEGIN PUBLIC KEY-----…" } }
```

The node token authenticates the agent (only its SHA-256 is stored). The first accepted key is pinned to the node; from then on a hello with a different key is refused. The fingerprint is shown on the Labs page so the club can compare it with what the ESP32 prints.

## What this does and doesn't prove

It proves that an examiner holding the pinned key observed this design behave correctly on the pins, for this attempt, during this booking. It doesn't prove who typed the Verilog. That limit is the same as any take-home test, and the follow-up (referral interview, mentorship) is where the author finds out.

With `kind: "sim"` the key lives on the lab node PC, so the club running that node could forge results. The UI labels those proofs "Verified in simulation" for that reason.
