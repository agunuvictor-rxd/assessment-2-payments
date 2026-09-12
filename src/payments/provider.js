import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * In-memory simulated checkout store for provider test mode.
 * In a live deployment, this would be managed by Stripe/Paddle/Adyen.
 * PCI DSS Scope: SAQ-A (no raw card data touches this server; the provider handles all card inputs).
 */
const checkoutSessions = new Map();

export function createProviderCheckoutSession({ userId, planId, interval, amountCents, currency = config.currency }) {
  const sessionId = 'cs_test_' + crypto.randomBytes(16).toString('hex');
  const session = {
    id: sessionId,
    userId,
    planId,
    interval,
    amountCents,
    currency,
    status: 'open',
    paymentStatus: 'unpaid',
    createdAt: Math.floor(Date.now() / 1000),
  };

  checkoutSessions.set(sessionId, session);
  return session;
}

export function getProviderCheckoutSession(sessionId) {
  return checkoutSessions.get(sessionId) || null;
}

/**
 * Simulates cardholder completing checkout on provider's hosted page.
 */
export function simulateProviderPaymentSuccess(sessionId) {
  const session = checkoutSessions.get(sessionId);
  if (!session) throw new Error('Checkout session not found');

  session.status = 'complete';
  session.paymentStatus = 'paid';
  session.providerEventId = 'evt_' + crypto.randomBytes(16).toString('hex');
  session.paymentIntentId = 'pi_' + crypto.randomBytes(16).toString('hex');

  return session;
}

/**
 * Generates an HMAC-SHA256 signature for webhook payloads.
 * Format: t=<timestamp>,v1=<signature>
 */
export function signWebhookPayload(payloadString, secret = config.webhookSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payloadString}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verifies webhook signature using constant-time comparison (timingSafeEqual).
 * Rejects expired signatures (> 5 minutes drift) and malformed headers.
 */
export function verifyWebhookSignature(signatureHeader, payloadString, secret = config.webhookSecret) {
  if (!signatureHeader || !payloadString) {
    return false;
  }

  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parseInt(parts.t, 10);
  const receivedSig = parts.v1;

  if (!timestamp || !receivedSig) {
    return false;
  }

  // Reject replay attacks (> 300 seconds old)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${payloadString}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch (err) {
    return false;
  }
}
