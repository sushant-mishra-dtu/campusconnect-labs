import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DB_PATH = process.env.CCL_DB ?? path.join(here, '..', 'data', 'ccl.db');
export const WEB_DIST = path.resolve(here, '..', '..', 'web', 'dist');
