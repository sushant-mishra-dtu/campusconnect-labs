// Screenshots for the README: the demo story stage by stage, through the real web app and both
// dashboards. Aarav (no FPGA lab at his college) proves the UART skill on a lent board and Meera
// sends the referral. Run on the platform machine; it uses up Aarav's demo story, so reseed after.
//
//   docker run --rm --network host --ipc=host --user 1000:1000 -e HOME=/tmp \
//     -v "$PWD/tools:/work" -v "$PWD:/repo:ro" -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
//     sh -c "npm i --no-save playwright@1.64.1 >/dev/null && node readme-shots.mjs"
//
// Images land in tools/readme-shots/; copy the ones the README uses into docs/screenshots/.
import fs from 'node:fs';
import { chromium } from 'playwright';

const PLATFORM = process.env.PLATFORM ?? 'http://127.0.0.1:4000';
const NODE_DASH = process.env.NODE_DASH ?? 'http://127.0.0.1:4100';
const NODE_ID = process.env.NODE_ID ?? 'iiitd-01';
const OUT = process.env.OUT ?? '/work/readme-shots';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const reference = fs.readFileSync(process.env.REFERENCE ?? '/repo/rtl/challenges/uart-nonce/reference.v', 'utf8');

const browser = await chromium.launch();
const errors = [];
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  return ctx;
}
async function page(ctx, name) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  return p;
}
const shot = async (p, name) => {
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
};
async function signIn(ctx, p, email, draft) {
  const r = await ctx.request.post(`${PLATFORM}/api/auth/login`, { data: { email } });
  const { token } = await r.json();
  await p.goto(`${PLATFORM}/about`);
  await p.evaluate(([t, code]) => {
    localStorage.setItem('crtl.token', t);
    if (code) localStorage.setItem('crtl.draft.c_uart', code);
  }, [token, draft]);
}

// 1. What a visitor sees
const anon = await context();
const landing = await page(anon, 'landing');
await landing.goto(`${PLATFORM}/about`);
await landing.waitForTimeout(1200);
await shot(landing, '01-landing');

// 2-4. Aarav: his gap, the challenge, the boards he can borrow
const student = await context();
const app = await page(student, 'student app');
await signIn(student, app, 'aarav@demo.c-rtl', reference);
await app.goto(`${PLATFORM}/`);
await app.getByText('Your gap').first().waitFor();
await app.waitForTimeout(800);
await shot(app, '02-student-gap');
await app.goto(`${PLATFORM}/challenges/c_uart`);
await app.waitForTimeout(1000);
await shot(app, '03-challenge');
await app.goto(`${PLATFORM}/labs`);
await app.waitForTimeout(1000);
await shot(app, '04-labs');

// 5-11. Book the board, build, watch it move on both dashboards
const watcher = await context();
const flow = await page(watcher, 'flow');
await flow.goto(`${PLATFORM}/flow`);
const node = await page(watcher, 'node dashboard');
await node.goto(NODE_DASH);

await app.goto(`${PLATFORM}/challenges/c_uart/attempt`);
await app.waitForSelector('select');
await app.selectOption('select', NODE_ID);
await app.waitForTimeout(800);
if (!(await app.getByText(/min left/).isVisible())) await app.getByRole('button', { name: /Book 30 min/ }).click();
await app.getByText(/min left/).waitFor({ timeout: 15000 });
await shot(app, '05-booked');

await app.getByRole('button', { name: /^(Build & simulate|Build, flash & examine)$/ }).click();
await app.waitForTimeout(6000);
await shot(node, '06-node-running');
await shot(flow, '07-flow-running');
await shot(app, '08-attempt-running');
await app.getByText('PASS · verified').waitFor({ timeout: 120000 });
await app.waitForTimeout(800);
await shot(app, '09-attempt-pass');
await flow.waitForTimeout(1500);
await shot(node, '10-node-done');
await shot(flow, '11-flow-done');
const footer = await app.getByText(/attempt [0-9a-f]{8}/).first().textContent();
const attemptId = /attempt ([0-9a-f]{8})/.exec(footer)[1];

// 12-13. Meera gets the proof and sends the referral; Aarav's profile now shows both
const author = await context();
const inbox = await page(author, 'author app');
await signIn(author, inbox, 'meera@demo.c-rtl');
await inbox.goto(`${PLATFORM}/`);
const section = inbox.getByText('Proofs addressed to you');
await section.waitFor();
await section.scrollIntoViewIfNeeded();
await inbox.evaluate(() => window.scrollBy(0, -80));
await inbox.waitForTimeout(800);
await shot(inbox, '12-author-inbox');
await inbox.getByPlaceholder(/Optional note/).first().fill('Referred you to our FPGA prototyping team.');
await inbox.getByRole('button', { name: 'Send referral' }).first().click();
await inbox.getByText('When someone passes one of your challenges').waitFor();
await app.goto(`${PLATFORM}/u/u_aarav`);
await app.getByText('Connections, each backed by something that happened').waitFor();
await app.waitForTimeout(1000);
await app.screenshot({ path: `${OUT}/13-student-profile.png`, fullPage: true });
console.log('shot 13-student-profile');

// 14. Anyone can check the proof, in their own browser
await app.goto(`${PLATFORM}/proof/${attemptId}`);
await app.getByRole('button', { name: 'Verify signature' }).click();
await app.getByText('Valid. The examiner signed exactly this payload.').waitFor({ timeout: 10000 });
await app.evaluate(() => window.scrollTo(0, 0)); // or the sticky header lands mid-page
await app.waitForTimeout(500);
await app.screenshot({ path: `${OUT}/14-proof-verified.png`, fullPage: true });
console.log('shot 14-proof-verified');

// 15. The network: every edge is something that happened
await app.goto(`${PLATFORM}/network`);
await app.waitForTimeout(6000);
await shot(app, '15-network');

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
