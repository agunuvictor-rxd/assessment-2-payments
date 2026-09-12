import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-session-payment-slice-key-32chars',
  get dbPath() {
    return process.env.DB_PATH || './payments.db';
  },

  // Payment Provider Configuration
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_test_secret_key_for_signature_verification_32ch',
  apiKey: process.env.PAYMENT_API_KEY || 'test_sk_payment_provider_api_key_sample',

  // Currency & Pricing in Minor Units (Cents)
  currency: process.env.DEFAULT_CURRENCY || 'USD',
  pricing: {
    free: {
      id: 'free',
      name: 'Free',
      amountCents: 0,
      interval: 'none',
      periodDays: 0,
    },
    proMonthly: {
      id: 'pro',
      name: 'Pro Monthly',
      amountCents: parseInt(process.env.PRO_MONTHLY_CENTS || '2000', 10), // $20.00
      interval: 'monthly',
      periodDays: 30,
    },
    proYearly: {
      id: 'pro',
      name: 'Pro Yearly',
      amountCents: parseInt(process.env.PRO_YEARLY_CENTS || '20000', 10), // $200.00
      interval: 'yearly',
      periodDays: 365,
    },
  },
};
