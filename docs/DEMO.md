# Demo script (about 4 minutes)

## Before you go on stage

```bash
npm run seed        # resets everything
npm run dev
npm run labnode     # leave this terminal visible: judges like seeing the node work
```

- Open two browser windows side by side: **Aarav** (student) on the left, **Meera** (alum) on the right.
- Have `rtl/challenges/uart-nonce/reference.v` open in an editor, ready to copy.
- If the venue Wi-Fi is bad, nothing here needs the internet.

## 1. The problem (30 s)

Show the landing page. Point at the two cards: a directory entry (skills typed by the student, struck through) and a connection (signed by an examiner).

> "Anyone can type FPGA on a profile. Aarav is at a college with no FPGA lab, so he can't even get the chance to show it."

## 2. See your gap (30 s) · Aarav

Home → **Your gap** for *FPGA Design Intern · Siliconvale*. 0 of 6 skills proven. His typed claims are shown and don't count. The top suggestion is Meera's UART challenge, with her offer: a referral.

## 3. Borrow a board (20 s) · Aarav

Click **Attempt**. Board: *Robotics Club bench · IIIT Delhi*, online. Click **Book 30 min on this board**.

> "This board is in a club room on another campus. The club lends it in slots."

## 4. Fail first (40 s) · Aarav

Submit the starter as-is. Watch the pipeline: booking → yosys synthesis → examiner. The examiner sends the nonce, gets nothing back, and **signs a FAIL**. The platform still verifies it: a failed attempt is a real, signed result too.

## 5. Pass (50 s) · Aarav

Paste the reference UART, **Build, flash & examine**. Read out the console:

- `fits in UP5K: 145 LUT4 / 5280` (it's real hardware-sized RTL)
- `sending nonce 7fb874 then 0x0A` (fresh for this attempt)
- `reply after sync byte: 7f b8 74 at 115385 baud` (measured on the wire)
- five green checks: signature, nonce, node/examiner, counter, booking

**PASS · verified.** Badge issued, connected to Meera.

## 6. The author follows through (30 s) · Meera

Meera's bell lights up. Home → **Proofs addressed to you** shows the connection card: from, to, challenge, board, signed by, when. Click **Send referral**.

## 7. Don't trust us, check it (30 s)

Open **View the signed proof**. **Verify signature** → valid, in the browser, with WebCrypto. Click **Flip the result** → invalid.

> "Change one character and the signature breaks. The server only accepted it because the nonce, counter and booking all matched."

## 8. The network (20 s)

Network page. The new edges pulse: Aarav → Meera (proved_for), Ishaan → Aarav (lent_board), Meera → Aarav (referred).

> "Every edge is something that happened. There are no follow buttons."

## Judge questions you'll get

**"Isn't this just simulation?"** Today's demo uses the simulation examiner, and the UI says so ("Verified in simulation"). The ESP32-S3 firmware and the yosys → nextpnr → iceprog flow are in the repo (`examiner/`, `labnode/src/flows/ice40.ts`), with the wiring in `docs/HARDWARE.md`. Every challenge already builds to a real UP5K bitstream that meets timing (`npm run check:ice40`), and the firmware compiles. Switching a node to hardware is `--mode=hw --serial=…`.

**"Can the lab node cheat?"** With an ESP32 examiner, no: the node never has the key; it only relays what the ESP32 signs, and the platform pins the ESP32's public key. With the sim examiner, the club running the node could, which is why those proofs are labelled differently.

**"Can a student replay someone else's pass?"** No. Every attempt gets a fresh nonce that the examiner must echo inside the signed payload, and the counter has to go up.

**"Can a student wire uart_rx to uart_tx?"** No. The examiner watches `uart_tx` while it transmits and fails any design that talks early. Try it: `assign uart_tx = uart_rx;`.

**"Who pays?"** Recruiters and companies post challenges as a hiring filter (per-challenge or subscription). Colleges get placement analytics. Clubs lending boards earn credits or sponsorship. Students never pay.

**"Why would a club lend a board?"** Every pass on their board creates a `lent_board` connection to the student and shows up on the club's profile: proof the club is useful, which is what sponsors look for.
