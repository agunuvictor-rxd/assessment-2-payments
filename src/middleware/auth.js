import { validateSession, COOKIE_NAME } from '../auth/session.js';

export function requireAuth(req, res, next) {
  const sessionId = req.cookies?.[COOKIE_NAME];
  const session = validateSession(sessionId);

  if (!session) {
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      return res.redirect('/signin');
    }
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in.',
    });
  }

  req.session = session;
  req.user = session.user;
  next();
}
