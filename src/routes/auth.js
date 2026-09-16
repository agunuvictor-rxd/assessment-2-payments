import { Router } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/hash.js';
import { createSession, destroySession, COOKIE_NAME, getCookieOptions } from '../auth/session.js';
import { getOrCreateSubscription } from '../payments/service.js';
import { signupSchema, signinSchema, formatZodError } from '../validation.js';

export const authRouter = Router();

authRouter.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
  }
  const { name, email, password } = parsed.data;

  const db = getDatabase();
  const userId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  try {
    const passwordHash = await hashPassword(password);
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name, email.toLowerCase().trim(), passwordHash, now);

    // Provision default free subscription
    getOrCreateSubscription(userId, db);

    const { sessionId } = createSession(userId, db);
    res.cookie(COOKIE_NAME, sessionId, getCookieOptions());

    return res.status(201).json({ success: true, message: 'Account created' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ success: false, error: 'Email already registered.' });
    }
    return res.status(500).json({ success: false, error: 'Signup failed.' });
  }
});

authRouter.post('/signin', async (req, res) => {
  const parsed = signinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
  }
  const { email, password } = parsed.data;
  const db = getDatabase();

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase().trim());
  if (!user) {
    await hashPassword('dummy-password-timing-defense');
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  const isValid = await verifyPassword(user.password_hash, password);
  if (!isValid) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  const { sessionId } = createSession(user.id, db);
  res.cookie(COOKIE_NAME, sessionId, getCookieOptions());

  return res.status(200).json({ success: true, message: 'Signed in successfully.' });
});

authRouter.post('/signout', (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (sessionId) {
    destroySession(sessionId);
  }
  res.clearCookie(COOKIE_NAME, getCookieOptions());
  return res.redirect('/signin');
});
