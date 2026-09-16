import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { checkoutLimiter } from '../middleware/rate-limiter.js';
import {
  initiateCheckout,
  verifyAndFulfillPayment,
  scheduleDowngrade,
  cancelSubscription,
  getOrCreateSubscription,
} from '../payments/service.js';
import {
  simulateProviderPaymentSuccess,
  verifyWebhookSignature,
  getProviderCheckoutSession,
} from '../payments/provider.js';
import { getDatabase } from '../db.js';
import {
  checkoutSchema,
  simulateSuccessSchema,
  verifySchema,
  cancelSchema,
  webhookSchema,
  formatZodError,
} from '../validation.js';

export const paymentsRouter = Router();

/**
 * 1. Checkout Initiation
 * Rate-limited server-side initiation with proration calculation.
 */
paymentsRouter.post('/checkout', requireAuth, checkoutLimiter, (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
  }
  const { planId, interval } = parsed.data;

  try {
    const result = initiateCheckout({
      userId: req.user.id,
      planId,
      interval,
    });

    return res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      amountCents: result.amountCents,
      currency: result.currency,
      proration: result.proration,
      checkoutUrl: `/checkout?session_id=${result.sessionId}`,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 2. Simulate Payment Completion (Test Mode)
 * Advances provider checkout session status to 'paid'.
 */
paymentsRouter.post('/simulate-success', requireAuth, (req, res) => {
  const parsed = simulateSuccessSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
  }
  const { sessionId } = parsed.data;
  try {
    const session = simulateProviderPaymentSuccess(sessionId, { userId: req.user.id });
    return res.status(200).json({ success: true, session });
  } catch (err) {
    const status = err.message.startsWith('Unauthorized') ? 403 : 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * 3. Server-Side Payment Verification & Entitlement
 * Called when return view mounts or after payment.
 * Verifies with provider server-side before updating subscription table.
 */
paymentsRouter.post('/verify', requireAuth, (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
  }
  const { sessionId } = parsed.data;

  try {
    const result = verifyAndFulfillPayment({
      checkoutSessionId: sessionId,
      userId: req.user.id,
    });
    return res.status(200).json({
      success: true,
      duplicate: result.duplicate,
      subscription: result.subscription,
    });
  } catch (err) {
    const status = err.message.startsWith('Unauthorized') ? 403 : 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * 4. Webhook Ingestion (HMAC Signature Verified & Idempotent)
 */
paymentsRouter.post('/webhook', (req, res) => {
  const signatureHeader = req.headers['x-webhook-signature'];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  // 1. Verify webhook signature
  const isValid = verifyWebhookSignature(signatureHeader, rawBody);
  if (!isValid) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or expired webhook signature.',
    });
  }

  const payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);
  const { eventType, providerEventId, checkoutSessionId } = payload;

  if (eventType === 'checkout.session.completed') {
    const parsed = webhookSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
    }
    const { providerEventId, checkoutSessionId } = parsed.data;

    try {
      const result = verifyAndFulfillPayment({ checkoutSessionId, providerEventId });
      return res.status(200).json({
        received: true,
        duplicate: result.duplicate,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(200).json({ received: true, ignored: true });
});

/**
 * 5. Downgrade Subscription
 * Retains current access until end of current billing period.
 */
paymentsRouter.post('/downgrade', requireAuth, (req, res) => {
  try {
    const sub = scheduleDowngrade({ userId: req.user.id, targetPlanId: 'free' });
    return res.status(200).json({
      success: true,
      message: 'Downgrade scheduled. Access remains active until period end.',
      subscription: sub,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * 6. Cancel Subscription
 * Retains current access until end of current billing period. Stores cancellation reason.
 */
paymentsRouter.post('/cancel', requireAuth, (req, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: formatZodError(parsed.error) });
  }
  const { reason = null } = parsed.data;
  try {
    const sub = cancelSubscription({ userId: req.user.id, reason });
    return res.status(200).json({
      success: true,
      message: 'Subscription canceled. Access remains active until period end.',
      subscription: sub,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
