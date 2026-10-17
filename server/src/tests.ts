// The test library comes straight from rtl/challenges, so the spec a student reads
// and the testbench the lab node runs can never drift apart.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RTL_DIR = path.resolve(here, '..', '..', 'rtl', 'challenges');

export interface TestDef {
  id: string;
  title: string;
  summary: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  skills: string[];
  maxSeconds: number;
  spec: string;
  starter: string;
}

function load(): Map<string, TestDef> {
  const out = new Map<string, TestDef>();
  for (const dir of fs.readdirSync(RTL_DIR)) {
    const base = path.join(RTL_DIR, dir);
    const metaPath = path.join(base, 'challenge.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    out.set(meta.id, {
      ...meta,
      spec: fs.readFileSync(path.join(base, 'spec.md'), 'utf8'),
      starter: fs.readFileSync(path.join(base, 'starter.v'), 'utf8'),
    });
  }
  return out;
}

export const TESTS = load();

export const DIFFICULTY_RANK = { beginner: 0, intermediate: 1, advanced: 2 } as const;

export function referenceSolution(testId: string) {
  return fs.readFileSync(path.join(RTL_DIR, testId, 'reference.v'), 'utf8');
}

// Three random bytes. The UART test uses 0x0A as its terminator, so no nonce
// byte may be 0x0A.
export function makeNonce(testId: string) {
  for (;;) {
    const bytes = crypto.randomBytes(3);
    if (testId === 'uart-nonce' && bytes.includes(0x0a)) continue;
    return bytes.toString('hex');
  }
}
