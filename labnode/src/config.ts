import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LABNODE_DIR = path.resolve(here, '..');
export const REPO_DIR = path.resolve(LABNODE_DIR, '..');
export const CHALLENGES_DIR = path.join(REPO_DIR, 'rtl', 'challenges');

function arg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const node = arg('node') ?? process.env.CCL_NODE ?? 'iiitd-01';
const keysDir = process.env.CCL_KEYS_DIR ?? path.join(LABNODE_DIR, 'keys');

// The token comes from --token, CCL_NODE_TOKEN, the file named by CCL_NODE_TOKEN_FILE, or
// keys/<node>.token (where `npm run seed` leaves the demo node's). There is no default: a token
// in the repo is a token for everyone.
function token() {
  const given = arg('token') ?? process.env.CCL_NODE_TOKEN;
  if (given) return given;
  const file = process.env.CCL_NODE_TOKEN_FILE ?? path.join(keysDir, `${node}.token`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

export const config = {
  server: arg('server') ?? process.env.CCL_SERVER ?? 'ws://localhost:4000/ws/node',
  node,
  token: token(),
  // sim: iverilog + a software examiner key. hw: yosys/nextpnr/iceprog + the ESP32-S3 examiner.
  mode: (arg('mode') ?? process.env.CCL_MODE ?? 'sim') as 'sim' | 'hw',
  serial: arg('serial') ?? process.env.CCL_SERIAL,
  pcf: arg('pcf') ?? process.env.CCL_PCF ?? path.join(REPO_DIR, 'rtl', 'boards', 'icebreaker.pcf'),
  keysDir,
  workDir: process.env.CCL_WORK_DIR ?? path.join(LABNODE_DIR, '.work'),
  info: process.argv.includes('--info'),
};
