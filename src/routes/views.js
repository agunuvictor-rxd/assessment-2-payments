import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDatabase } from '../db.js';
import { getOrCreateSubscription } from '../payments/service.js';
import { getProviderCheckoutSession } from '../payments/provider.js';
import {
  plansView,
  checkoutView,
  paymentReturnView,
  billingView,
  signinView,
  signupView,
} from '../views/pages.js';

export const viewsRouter = Router();

viewsRouter.get('/', (req, res) => {
  res.redirect('/billing');
});

viewsRouter.get('/signin', (req, res) => {
  res.send(signinView());
});

viewsRouter.get('/signup', (req, res) => {
  res.send(signupView());
});

/**
 * Billing View (Protected)
 */
viewsRouter.get('/billing', requireAuth, (req, res) => {
  const db = getDatabase();
  const subscription = getOrCreateSubscription(req.user.id, db);

  const paymentLogs = db.prepare(`
    SELECT * FROM payment_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 25
  `).all(req.user.id);

  res.send(billingView({ user: req.user, subscription, paymentLogs }));
});

/**
 * Plans View (Protected)
 */
viewsRouter.get('/plans', requireAuth, (req, res) => {
  const db = getDatabase();
  const subscription = getOrCreateSubscription(req.user.id, db);
  res.send(plansView({ user: req.user, subscription }));
});

/**
 * Checkout Initiation View (Protected)
 */
viewsRouter.get('/checkout', requireAuth, (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.redirect('/plans');
  }

  const session = getProviderCheckoutSession(sessionId);
  if (!session) {
    return res.status(404).send('Checkout session expired or not found.');
  }

  if (session.userId !== req.user.id) {
    return res.status(404).send('Checkout session not found.');
  }

  // Retrieve proration if stored in initiation payment log
  const db = getDatabase();
  const initLog = db.prepare(`
    SELECT metadata FROM payment_logs
    WHERE provider_event_id = ? AND stage = 'initiation'
  `).get('evt_init_' + sessionId);

  let proration = null;
  if (initLog && initLog.metadata) {
    try {
      const parsed = JSON.parse(initLog.metadata);
      proration = parsed.proration || null;
    } catch (e) {}
  }

  res.send(checkoutView({ user: req.user, session, proration }));
});

/**
 * Payment Return View (Protected)
 */
viewsRouter.get('/payment/return', requireAuth, (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.redirect('/billing');
  }
  res.send(paymentReturnView({ user: req.user, sessionId }));
});
