import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = process.env.CRTL_DB ?? path.join(here, '..', 'data', 'c-rtl.db');
export const REPO_DIR = path.resolve(here, '..', '..');
export const WEB_DIST = path.join(REPO_DIR, 'web', 'dist');
