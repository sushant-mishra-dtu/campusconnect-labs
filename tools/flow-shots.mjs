// Drives one attempt through the real web app on a lab node (NODE_ID), screenshotting the
// platform's flow dashboard and the node dashboards while the data moves, then the result and
// the proof page. Run it on the platform machine, in a headless browser:
//
//   docker run --rm --network host --ipc=host -v "$PWD/tools:/work" -v "$PWD:/repo:ro" -w /work \
//     -e REMOTE_NODE=http://<node machine>:4100 mcr.microsoft.com/playwright:v1.64.1-noble \
//     sh -c "npm i --no-save playwright@1.64.1 >/dev/null && node flow-shots.mjs"
//
// Screenshots land in tools/shots/. The student signs in with demo sign-in, so it must be on.
import fs from 'node:fs';
import { chromium } from 'playwright';

const PLATFORM = process.env.PLATFORM ?? 'http://127.0.0.1:4000';
const REMOTE_NODE = process.env.REMOTE_NODE ?? 'http://127.0.0.1:4101'; // the node the attempt runs on
const LOCAL_NODE = process.env.LOCAL_NODE ?? 'http://127.0.0.1:4100'; // another node's dashboard, idle
const NODE_ID = process.env.NODE_ID ?? 'iiitd-02';
const STUDENT = process.env.STUDENT ?? 'diya@demo.c-rtl';
const OUT = process.env.OUT ?? '/work/shots';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const reference = fs.readFileSync(process.env.REFERENCE ?? '/repo/rtl/challenges/uart-nonce/reference.v', 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
};
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);
let n = 0;
const shot = async (page, name) => {
  const file = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`${stamp()}  ${file}`);
};

const flow = await ctx.newPage();
watch(flow, 'platform /flow');
await flow.goto(`${PLATFORM}/flow`);
const remote = await ctx.newPage();
watch(remote, 'iiitd-02 dashboard');
await remote.goto(REMOTE_NODE);
const local = await ctx.newPage();
watch(local, 'iiitd-01 dashboard');
await local.goto(LOCAL_NODE);
await flow.waitForTimeout(2500);
await shot(flow, 'platform-flow-idle');
await shot(remote, 'node-iiitd-02-idle');
await shot(local, 'node-iiitd-01-idle');

// A student signs in (demo sign-in), with the reference design as the editor's draft
const login = await ctx.request.post(`${PLATFORM}/api/auth/login`, { data: { email: STUDENT } });
const { token } = await login.json();
const app = await ctx.newPage();
watch(app, 'web app');
await app.goto(`${PLATFORM}/about`);
await app.evaluate(([t, code]) => {
  localStorage.setItem('crtl.token', t);
  localStorage.setItem('crtl.draft.c_uart', code);
}, [token, reference]);
await app.goto(`${PLATFORM}/challenges/c_uart/attempt`);
await app.waitForSelector('select');
await app.selectOption('select', NODE_ID);
await app.waitForTimeout(800);
// An earlier run's slot may still be live; otherwise book one
if (!(await app.getByText(/min left/).isVisible())) await app.getByRole('button', { name: /Book 30 min/ }).click();
await app.getByText(/min left/).waitFor({ timeout: 15000 });
await shot(app, 'app-booked-on-iiitd-02');
await shot(flow, 'platform-flow-after-booking');

// "Build & simulate" on a sim node, "Build, flash & examine" on a board; then watch the data move
await app.getByRole('button', { name: /^(Build & simulate|Build, flash & examine)$/ }).click();
const started = Date.now();
for (const at of [600, 1500, 2600, 3800]) {
  await app.waitForTimeout(Math.max(0, at - (Date.now() - started)));
  const tag = `+${(at / 1000).toFixed(1)}s`;
  await shot(flow, `platform-flow-${tag}`);
  await shot(remote, `node-iiitd-02-${tag}`);
}
await app.getByText('PASS · verified').waitFor({ timeout: 90000 });
console.log(`${stamp()}  the app shows PASS · verified ${((Date.now() - started) / 1000).toFixed(1)} s after the click`);
await shot(app, 'app-pass-verified');
await flow.waitForTimeout(1500);
await shot(flow, 'platform-flow-recorded');
await shot(remote, 'node-iiitd-02-done');

// The public proof, re-verified in the browser
const footer = await app.getByText(/attempt [0-9a-f]{8}/).first().textContent();
const attemptId = /attempt ([0-9a-f]{8})/.exec(footer)[1];
await app.goto(`${PLATFORM}/proof/${attemptId}`);
await app.getByRole('button', { name: 'Verify signature' }).click();
await app.getByText('Valid. The examiner signed exactly this payload.').waitFor({ timeout: 10000 });
await shot(app, 'app-proof-verified-in-browser');

console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
