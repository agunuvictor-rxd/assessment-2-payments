import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { getDatabase, closeDatabase } from '../src/db.js';
import { rateLimiterStore } from '../src/middleware/rate-limiter.js';
import { calculateProration } from '../src/payments/proration.js';
import {
  initiateCheckout,
  verifyAndFulfillPayment,
  scheduleDowngrade,
  cancelSubscription,
  getOrCreateSubscription,
} from '../src/payments/service.js';
import {
  simulateProviderPaymentSuccess,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../src/payments/provider.js';
import { config } from '../src/config.js';


test.beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = ':memory:';
  closeDatabase();
  rateLimiterStore.reset();
  getDatabase(':memory:');
});

test.after(() => {
  closeDatabase();
});

test('Money Invariant: all pricing and database amounts are integers in minor units (cents)', () => {
  assert.equal(typeof config.pricing.proMonthly.amountCents, 'number');
  assert.equal(Number.isInteger(config.pricing.proMonthly.amountCents), true);
  assert.equal(config.pricing.proMonthly.amountCents, 2000, 'Pro Monthly must be exactly 2000 cents ($20.00)');

  assert.equal(typeof config.pricing.proYearly.amountCents, 'number');
  assert.equal(Number.isInteger(config.pricing.proYearly.amountCents), true);
  assert.equal(config.pricing.proYearly.amountCents, 20000, 'Pro Yearly must be exactly 20000 cents ($200.00)');
  assert.equal(config.currency, 'USD');
});

test('Proration Arithmetic: accurately calculates mid-cycle upgrade credit and net charge', () => {
  // Scenario: 30-day cycle ($20.00 = 2000 cents), upgrade on day 12 (18 days remaining) to Yearly ($200.00 = 20000 cents)
  const now = 1000000;
  const periodStart = now - (12 * 86400); // 12 days ago
  const periodEnd = periodStart + (30 * 86400); // 18 days in future

  const proration = calculateProration({
    currentAmountCents: 2000,
    periodStart,
    periodEnd,
    effectiveAt: now,
    newAmountCents: 20000,
  });

  assert.equal(proration.daysInCycle, 30, 'Total cycle days should be 30');
  assert.equal(proration.daysUsed, 12, 'Days used should be 12');
  assert.equal(proration.daysRemaining, 18, 'Days remaining should be 18');

  // Unused credit: (18 / 30) * 2000 = 1200 cents ($12.00)
  assert.equal(proration.unusedCreditCents, 1200, 'Unused credit must be 1200 cents');
  assert.equal(proration.newPlanCostCents, 20000, 'New plan cost is 20000 cents');

  // Net charge: 20000 - 1200 = 18800 cents ($188.00)
  assert.equal(proration.amountChargedCents, 18800, 'Net amount charged must be 18800 cents ($188.00)');
  assert.equal(Number.isInteger(proration.amountChargedCents), true);
});

test('Server-Side Verification: rejects unverified checkout session without payment completion', () => {
  const db = getDatabase(':memory:');
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES ('u1', 'Test User', 'test@example.com', 'hash', 1000)
  `).run();

  const checkout = initiateCheckout({ userId: 'u1', planId: 'pro', interval: 'monthly' }, db);

  // Attempting to verify without payment completion must fail
  assert.throws(
    () => {
      verifyAndFulfillPayment({ checkoutSessionId: checkout.sessionId }, db);
    },
    (err) => err.message.includes('Payment verification failed'),
    'Must not grant entitlement when checkout session status is unpaid'
  );

  const sub = getOrCreateSubscription('u1', db);
  assert.equal(sub.plan_id, 'free', 'User must remain on Free plan when verification fails');
});

test('Webhook Idempotency: duplicate webhooks do not apply effects or extend period twice', () => {
  const db = getDatabase(':memory:');
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES ('u2', 'Webhook User', 'webhook@example.com', 'hash', ?)
  `).run(now);

  const checkout = initiateCheckout({ userId: 'u2', planId: 'pro', interval: 'monthly' }, db);
  simulateProviderPaymentSuccess(checkout.sessionId);

  const providerEventId = 'evt_test_idempotency_12345';

  // 1. First webhook processing
  const firstRun = verifyAndFulfillPayment({
    checkoutSessionId: checkout.sessionId,
    providerEventId,
  }, db);

  assert.equal(firstRun.success, true);
  assert.equal(firstRun.duplicate, false);
  assert.equal(firstRun.subscription.plan_id, 'pro');
  const firstPeriodEnd = firstRun.subscription.current_period_end;

  // 2. Second duplicate webhook with SAME providerEventId
  const secondRun = verifyAndFulfillPayment({
    checkoutSessionId: checkout.sessionId,
    providerEventId,
  }, db);

  assert.equal(secondRun.success, true);
  assert.equal(secondRun.duplicate, true, 'Second run must be marked as duplicate');
  assert.equal(secondRun.subscription.current_period_end, firstPeriodEnd, 'Period end date must NOT change on duplicate');

  // Verify payment log records duplicate status
  const logs = db.prepare(`
    SELECT stage, status FROM payment_logs
    WHERE provider_event_id = ? AND stage = 'fulfilment'
  `).all(providerEventId);

  assert.equal(logs.length, 2);
  assert.equal(logs[0].status, 'succeeded');
  assert.equal(logs[1].status, 'duplicate');
});

test('Webhook Signature: rejects invalid signatures and accepts valid HMAC signatures', () => {
  const payload = JSON.stringify({
    eventType: 'checkout.session.completed',
    providerEventId: 'evt_sig_test_1',
    checkoutSessionId: 'cs_test_sig',
  });

  const validSignature = signWebhookPayload(payload, config.webhookSecret);
  assert.equal(verifyWebhookSignature(validSignature, payload, config.webhookSecret), true);

  // Alter payload (tampering test)
  const tamperedPayload = payload + ' ';
  assert.equal(verifyWebhookSignature(validSignature, tamperedPayload, config.webhookSecret), false);

  // Invalid secret test
  assert.equal(verifyWebhookSignature(validSignature, payload, 'wrong_secret_key_abcdef1234567890'), false);

  // Missing or garbage header
  assert.equal(verifyWebhookSignature('garbage_header', payload, config.webhookSecret), false);
});

test('Cancellation & Downgrade: retain access until paid period ends and store reason', () => {
  const db = getDatabase(':memory:');
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES ('u3', 'Cancel User', 'cancel@example.com', 'hash', ?)
  `).run(now);

  const checkout = initiateCheckout({ userId: 'u3', planId: 'pro', interval: 'monthly' }, db);
  simulateProviderPaymentSuccess(checkout.sessionId);
  verifyAndFulfillPayment({ checkoutSessionId: checkout.sessionId }, db);

  const activeSub = getOrCreateSubscription('u3', db);
  assert.equal(activeSub.plan_id, 'pro');
  assert.equal(activeSub.status, 'active');
  const originalEnd = activeSub.current_period_end;

  // Cancel subscription with reason
  const canceledSub = cancelSubscription({
    userId: 'u3',
    reason: 'Tooling budget reallocated',
  }, db);

  assert.equal(canceledSub.cancel_at_period_end, 1);
  assert.equal(canceledSub.cancellation_reason, 'Tooling budget reallocated');
  assert.equal(canceledSub.current_period_end, originalEnd, 'Access retained until original period end');
  assert.equal(canceledSub.plan_id, 'pro', 'Plan remains Pro until period ends');

  // Schedule Downgrade test
  const downgradedSub = scheduleDowngrade({ userId: 'u3', targetPlanId: 'free' }, db);
  assert.equal(downgradedSub.scheduled_plan_id, 'free');
  assert.equal(downgradedSub.plan_id, 'pro', 'Access remains Pro until period ends');
});

test('Payment Logs: records all 4 discrete stages (Initiation, Verification, Fulfilment, Failure)', () => {
  const db = getDatabase(':memory:');
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES ('u4', 'Log User', 'log@example.com', 'hash', ?)
  `).run(now);

  // 1. Initiation
  const checkout = initiateCheckout({ userId: 'u4', planId: 'pro', interval: 'monthly' }, db);

  // 2. Failure attempt
  assert.throws(() => {
    verifyAndFulfillPayment({ checkoutSessionId: checkout.sessionId }, db);
  });

  // 3. Complete payment and succeed
  simulateProviderPaymentSuccess(checkout.sessionId);
  verifyAndFulfillPayment({ checkoutSessionId: checkout.sessionId }, db);

  const stages = db.prepare(`
    SELECT stage, status FROM payment_logs WHERE user_id = 'u4' ORDER BY created_at ASC
  `).all();

  const stageNames = stages.map(s => s.stage);
  assert.ok(stageNames.includes('initiation'), 'Must contain initiation stage');
  assert.ok(stageNames.includes('failure'), 'Must contain failure stage');
  assert.ok(stageNames.includes('verification'), 'Must contain verification stage');
  assert.ok(stageNames.includes('fulfilment'), 'Must contain fulfilment stage');
});

test('Rate Limiter: checkout initiation is rate-limited upon quota breach', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // Create and sign in user
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rate User', email: 'rate@example.com', password: 'Password123!' }),
    });
    const cookie = signupRes.headers.get('set-cookie')?.split(';')[0];

    let lastStatus = 200;
    let retryAfter = null;

    // Checkout quota is 5 attempts per 15 min
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${baseUrl}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ planId: 'pro', interval: 'monthly' }),
      });
      lastStatus = res.status;
      retryAfter = res.headers.get('Retry-After');
    }

    assert.equal(lastStatus, 429, 'Excessive checkout initiation must return HTTP 429');
    assert.ok(retryAfter, 'Must return Retry-After header');
  } finally {
    server.close();
  }
});
