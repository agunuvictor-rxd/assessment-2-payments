import crypto from 'node:crypto';
import { getDatabase } from '../db.js';
import { config } from '../config.js';
import { createProviderCheckoutSession, getProviderCheckoutSession } from './provider.js';
import { calculateProration } from './proration.js';

/**
 * Inserts a stage record into the payment_logs history table.
 */
export function recordPaymentLog({
  userId,
  subscriptionId = null,
  providerEventId,
  stage,
  amountCents,
  currency = config.currency,
  status,
  metadata = null,
}, db = getDatabase()) {
  const logId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO payment_logs (
      id, user_id, subscription_id, provider_event_id, stage, amount_cents, currency, status, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    logId,
    userId,
    subscriptionId,
    providerEventId,
    stage,
    amountCents,
    currency,
    status,
    metadata ? JSON.stringify(metadata) : null,
    now
  );

  return logId;
}

/**
 * Returns user subscription or creates initial Free tier subscription.
 */
export function getOrCreateSubscription(userId, db = getDatabase()) {
  let sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);

  if (!sub) {
    const subId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    // Free plan has lifetime expiration or rolling period
    const periodEnd = now + (365 * 10 * 86400);

    db.prepare(`
      INSERT INTO subscriptions (
        id, user_id, plan_id, interval, status, current_period_start, current_period_end,
        cancel_at_period_end, cancellation_reason, created_at, updated_at
      ) VALUES (?, ?, 'free', 'none', 'active', ?, ?, 0, null, ?, ?)
    `).run(subId, userId, now, periodEnd, now, now);

    sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
  }

  return sub;
}

/**
 * Initiates checkout session with proration calculation when upgrading mid-cycle.
 */
export function initiateCheckout({ userId, planId, interval }, db = getDatabase()) {
  const currentSub = getOrCreateSubscription(userId, db);
  let amountCents = 0;
  let proration = null;

  if (planId === 'pro' && interval === 'monthly') {
    amountCents = config.pricing.proMonthly.amountCents;
  } else if (planId === 'pro' && interval === 'yearly') {
    amountCents = config.pricing.proYearly.amountCents;

    // Mid-cycle upgrade: if currently on active Pro Monthly, apply proration credit
    if (currentSub.plan_id === 'pro' && currentSub.interval === 'monthly' && currentSub.status === 'active') {
      proration = calculateProration({
        currentAmountCents: config.pricing.proMonthly.amountCents,
        periodStart: currentSub.current_period_start,
        periodEnd: currentSub.current_period_end,
        newAmountCents: config.pricing.proYearly.amountCents,
      });
      amountCents = proration.amountChargedCents;
    }
  } else {
    throw new Error('Invalid plan selection');
  }

  const session = createProviderCheckoutSession({
    userId,
    planId,
    interval,
    amountCents,
    currency: config.currency,
  });

  const eventId = 'evt_init_' + session.id;

  // Stage 1: Initiation
  recordPaymentLog({
    userId,
    subscriptionId: currentSub.id,
    providerEventId: eventId,
    stage: 'initiation',
    amountCents,
    currency: config.currency,
    status: 'pending',
    metadata: {
      planId,
      interval,
      checkoutSessionId: session.id,
      proration,
    },
  }, db);

  return {
    sessionId: session.id,
    amountCents,
    currency: config.currency,
    proration,
  };
}

/**
 * Server-side payment verification and idempotent fulfilment.
 * Never grants entitlement without server verification.
 */
export function verifyAndFulfillPayment({ checkoutSessionId, providerEventId, userId }, db = getDatabase()) {
  const session = getProviderCheckoutSession(checkoutSessionId);
  if (!session) {
    throw new Error('Invalid or non-existent checkout session');
  }

  if (userId && session.userId !== userId) {
    throw new Error('Unauthorized: checkout session does not belong to the authenticated user.');
  }

  // Server-side verification check
  if (session.paymentStatus !== 'paid') {
    recordPaymentLog({
      userId: session.userId,
      providerEventId: providerEventId || ('evt_fail_' + checkoutSessionId),
      stage: 'failure',
      amountCents: session.amountCents,
      currency: session.currency,
      status: 'failed',
      metadata: { reason: 'Payment not completed or declined by provider' },
    }, db);
    throw new Error('Payment verification failed: transaction was not completed by the provider.');
  }

  const currentSub = getOrCreateSubscription(session.userId, db);
  const effectiveEventId = providerEventId || session.providerEventId || ('evt_succ_' + checkoutSessionId);

  // Stage 2: Verification
  recordPaymentLog({
    userId: session.userId,
    subscriptionId: currentSub.id,
    providerEventId: effectiveEventId,
    stage: 'verification',
    amountCents: session.amountCents,
    currency: session.currency,
    status: 'succeeded',
    metadata: { checkoutSessionId: session.id },
  }, db);

  // Webhook & event Idempotency Check is performed INSIDE the write transaction.
  // BEGIN IMMEDIATE serializes writers; a concurrent duplicate (multi-instance)
  // blocks here and sees the first writer's fulfilment record.
  db.exec('BEGIN IMMEDIATE;');
  try {
    const existingFulfilment = db.prepare(`
      SELECT id FROM payment_logs
      WHERE provider_event_id = ? AND stage = 'fulfilment' AND status = 'succeeded'
    `).get(effectiveEventId);

    if (existingFulfilment) {
      // Record duplicate event without reapplying effects
      recordPaymentLog({
        userId: session.userId,
        subscriptionId: currentSub.id,
        providerEventId: effectiveEventId,
        stage: 'fulfilment',
        amountCents: session.amountCents,
        currency: session.currency,
        status: 'duplicate',
        metadata: { message: 'Recognized duplicate webhook/event; effect was not reapplied.' },
      }, db);

      db.exec('COMMIT;');
      return {
        success: true,
        duplicate: true,
        subscription: currentSub,
      };
    }

    // Stage 3: Fulfilment - Update Subscription State in DB
    const now = Math.floor(Date.now() / 1000);
    const periodDurationSeconds = session.interval === 'yearly' ? 365 * 86400 : 30 * 86400;
    const periodEnd = now + periodDurationSeconds;

    db.prepare(`
      UPDATE subscriptions
      SET plan_id = ?,
          interval = ?,
          status = 'active',
          current_period_start = ?,
          current_period_end = ?,
          cancel_at_period_end = 0,
          cancellation_reason = NULL,
          scheduled_plan_id = NULL,
          scheduled_interval = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(session.planId, session.interval, now, periodEnd, now, currentSub.id);

    recordPaymentLog({
      userId: session.userId,
      subscriptionId: currentSub.id,
      providerEventId: effectiveEventId,
      stage: 'fulfilment',
      amountCents: session.amountCents,
      currency: session.currency,
      status: 'succeeded',
      metadata: {
        planId: session.planId,
        interval: session.interval,
        currentPeriodEnd: periodEnd,
      },
    }, db);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const updatedSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(currentSub.id);
  return {
    success: true,
    duplicate: false,
    subscription: updatedSub,
  };
}

/**
 * Schedules a downgrade at the end of the current billing cycle.
 * Does NOT immediately remove access.
 */
export function scheduleDowngrade({ userId, targetPlanId = 'free' }, db = getDatabase()) {
  const currentSub = getOrCreateSubscription(userId, db);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE subscriptions
    SET scheduled_plan_id = ?,
        scheduled_interval = 'none',
        updated_at = ?
    WHERE id = ?
  `).run(targetPlanId, now, currentSub.id);

  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(currentSub.id);
}

/**
 * Cancels a subscription at period end.
 * Retains access until current_period_end and stores optional cancellation reason.
 */
export function cancelSubscription({ userId, reason = null }, db = getDatabase()) {
  const currentSub = getOrCreateSubscription(userId, db);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE subscriptions
    SET cancel_at_period_end = 1,
        cancellation_reason = ?,
        updated_at = ?
    WHERE id = ?
  `).run(reason, now, currentSub.id);

  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(currentSub.id);
}
