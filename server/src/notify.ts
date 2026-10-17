import { run } from './db.js';
import { pushToUser } from './presence.js';
import { now, prefixedId } from './util.js';

export function notify(userId: string, body: string, link: string | null = null) {
  const n = { id: prefixedId('n'), user_id: userId, body, link, read: 0, created_at: now() };
  run('INSERT INTO notifications (id, user_id, body, link, read, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    n.id, userId, body, link, n.created_at);
  pushToUser(userId, { type: 'notification', notification: n });
}
