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

export const config = {
  server: arg('server') ?? process.env.CCL_SERVER ?? 'ws://localhost:4000/ws/node',
  node: arg('node') ?? process.env.CCL_NODE ?? 'iiitd-01',
  token: arg('token') ?? process.env.CCL_NODE_TOKEN ?? 'demo-iiitd-01-token',
  // sim: iverilog + a software examiner key. hw: yosys/nextpnr/iceprog + the ESP32-S3 examiner.
  mode: (arg('mode') ?? process.env.CCL_MODE ?? 'sim') as 'sim' | 'hw',
  serial: arg('serial') ?? process.env.CCL_SERIAL,
  pcf: arg('pcf') ?? process.env.CCL_PCF ?? path.join(REPO_DIR, 'rtl', 'boards', 'icebreaker.pcf'),
  keysDir: process.env.CCL_KEYS_DIR ?? path.join(LABNODE_DIR, 'keys'),
  workDir: process.env.CCL_WORK_DIR ?? path.join(LABNODE_DIR, '.work'),
  info: process.argv.includes('--info'),
};
