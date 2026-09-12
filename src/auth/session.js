import crypto from 'node:crypto';
import { getDatabase } from '../db.js';
import { config } from '../config.js';

export const COOKIE_NAME = 'pay_sid';

export function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: 86400 * 1000,
  };
}

export function createSession(userId, db = getDatabase()) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 86400;

  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    sessionId,
    userId,
    expiresAt,
    now
  );

  return { sessionId, expiresAt };
}

export function validateSession(sessionId, db = getDatabase()) {
  if (!sessionId) return null;

  const stmt = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.name, u.email
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `);
  const session = stmt.get(sessionId);
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }

  return {
    id: session.session_id,
    user: {
      id: session.user_id,
      name: session.name,
      email: session.email,
    },
  };
}

export function destroySession(sessionId, db = getDatabase()) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
