# Metis Academic Co-Pilot — Assessment 2: Payment and Subscription Slice Documentation

## 1. What This Is

This project is the production-minded **Payment and Subscription Engineering Slice** for **Metis**, the web-based academic co-pilot for undergraduate students. Metis replaces flat monthly subscriptions with a pay-as-you-go token economy: a free tier for manual organization plus token bundles purchased on demand for AI features powered by Kinase.

Built with Node.js, Express, and SQLite, this payment slice implements a multi-tier subscription and token management engine featuring Free, Pro Monthly ($20.00 / 2,000 cents), and Pro Yearly ($200.00 / 20,000 cents) tiers. It enforces monetary calculations in minor units (integer cents), processes cryptographically signed webhooks (HMAC-SHA256), guarantees webhook idempotency using unique transaction reference IDs (`stripeRefId` / `evt_...`), executes proration math for mid-cycle plan changes, and maintains a strict subscription state machine (`active`, `past_due`, `canceled`).

In strict compliance with `metis-prd-v2.md` and `Agents 0.md`, all monetary and token amounts are handled server-side with zero decimal float operations, and duplicate webhook events are rejected before token balance updates occur.

---

## 2. How To Run It

Follow these numbered steps to run the payment slice from a fresh clone:

1. **System Requirements**: Node.js (v20.0.0 or higher) and npm.
2. **Navigate to Directory**:
   ```bash
   cd assessment-2-payments
   ```
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Environment Configuration**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Key environment variables:
   - `PORT`: HTTP port for Express (default: `3001`).
   - `NODE_ENV`: Set to `development` or `test`.
   - `SESSION_SECRET`: Random string for signing cookies.
   - `DB_PATH`: SQLite database path (default: `./payments.db`).
   - `PAYMENT_WEBHOOK_SECRET`: Secret key used for HMAC-SHA256 webhook signature verification.
   - `PRO_MONTHLY_CENTS`: Cost of monthly tier in minor units (default: `2000` = $20.00).
   - `PRO_YEARLY_CENTS`: Cost of yearly tier in minor units (default: `20000` = $200.00).
5. **Database Initialization**:
   SQLite schema automatically creates tables (`users`, `sessions`, `subscriptions`, `payment_logs`, `webhook_events`) on first run in `src/db.js` with WAL mode.
6. **Run Automated Tests**:
   ```bash
   npm test
   ```
7. **Start Development Server**:
   ```bash
   npm start
   ```
8. **Access the Application**:
   Open browser at `http://localhost:3001/signup` to register, sign in, and view the billing management dashboard at `http://localhost:3001/billing`.

---

## 3. The Flow, Step By Step

### Flow 1: Token Bundle & Subscription Checkout
1. **Student Selection**: The student selects a plan or token bundle at `/plans` and clicks "Checkout".
2. **Checkout Session Creation**: Frontend posts to `/api/payments/checkout`. Server initializes a checkout session and logs transaction stage `initiation` with status `pending`.
3. **Hosted Payment Execution**: Student completes payment in test mode. Provider dispatches a signed webhook.

### Flow 2: Idempotent Webhook Processing & Entitlement Grant
1. **Webhook Signature Check**: Webhook handler computes HMAC-SHA256 signature using `PAYMENT_WEBHOOK_SECRET` and rejects invalid signatures (`401 Unauthorized`).
2. **Idempotency Check**: Server checks `webhook_events` for `evt_...` (or `stripeRefId`). If previously processed, returns `200 OK` immediately to prevent double-crediting.
3. **Subscription State Update**: State machine transitions status:
   - `payment_succeeded` $\rightarrow$ set `status = 'active'`, extend `current_period_end`.
   - `payment_failed` $\rightarrow$ increment retry count; if retries exceed 3, set `status = 'past_due'`.

---

## 4. The Data Model

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid')),
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

CREATE TABLE payment_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_payment_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
```

---

## 5. The Concepts

1. **Integer Minor Units**: All financial values are calculated in cents (e.g. $20.00 = `2000` cents) to avoid floating-point rounding errors.
2. **Idempotent Billing Ingestion**: Guarantees that duplicate network deliveries of webhook events cannot credit token balances or extend subscriptions twice.
3. **Subscription State Machine**: Enforces strict state transitions (`active`, `past_due`, `canceled`) with deterministic failure handling and retry limits.

---

## 6. What Went Wrong

1. **Duplicate Event Re-Processing**: Initial tests without idempotency tracking credited subscriptions twice on webhook re-transmissions. Resolved by introducing `webhook_events` tracking table with UNIQUE constraints on event identifiers.
2. **Floating Point Arithmetic**: Early calculations using floating-point numbers produced minute fraction errors in proration math. Replaced entirely with integer math.

---

## 7. What This Slice Does Not Handle

- **Multi-Currency Conversion**: Currency is locked to `USD` minor units for MVP.
- **Physical Invoicing / Tax Engines**: Complex VAT/Tax calculations are handled via third-party providers in production.

---

## 8. If I Built This Again

1. **Ledger-Based Double-Entry Accounting**: Implement a formal double-entry transaction ledger table for auditability.
2. **Asynchronous Stripe Webhook Workers**: Offload webhook payload execution to a BullMQ worker queue for instant HTTP responses.
