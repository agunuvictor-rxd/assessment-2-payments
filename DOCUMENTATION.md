# 1. What This Is

This project is a complete, production-minded payment and subscription engineering slice built in Node.js with Express and SQLite. It implements a multi-tier subscription engine featuring Free, Pro Monthly ($20.00 / 2,000 cents), and Pro Yearly ($200.00 / 20,000 cents) plans operating in test mode. The architecture strictly enforces monetary amounts as whole integers in minor units, performs server-side payment verification, processes cryptographically signed webhooks with HMAC-SHA256, enforces webhook idempotency using provider event IDs, executes mid-cycle upgrade proration arithmetic, records all transaction events in a discrete multi-stage payment log table, and manages cancellations with full access retention until the end of the paid billing period.

In adherence to the assessment brief, this application deliberately excludes marketing landing pages, custom invoices, PDF receipt generators, multiple currencies, tax calculation engines, coupon codes, and complex organizational team billing. These features were omitted because they expand product surface area without adding architectural value to core payment integrity, idempotency, proration calculations, or server-side verification boundaries.

---

# 2. How To Run It

Follow these numbered steps to run the payment slice from a fresh clone:

1. **System Requirements**: Node.js (v20.0.0 or higher, tested on v24.16.0) and npm.
2. **Navigate to Repository**:
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
   Environment variables:
   - `PORT`: HTTP port for Express (default: `3001`).
   - `NODE_ENV`: Set to `development` or `test`.
   - `SESSION_SECRET`: Random string for signing cookies (minimum 32 characters).
   - `DB_PATH`: SQLite database file path (default: `./payments.db`).
   - `PAYMENT_WEBHOOK_SECRET`: Secret key used for HMAC-SHA256 webhook signature verification.
   - `PRO_MONTHLY_CENTS`: Cost of monthly Pro tier in minor units (default: `2000` = $20.00).
   - `PRO_YEARLY_CENTS`: Cost of yearly Pro tier in minor units (default: `20000` = $200.00).
   - `DEFAULT_CURRENCY`: Default currency code (default: `USD`).
5. **Database Initialization**:
   The SQLite schema automatically creates tables (`users`, `sessions`, `subscriptions`, `payment_logs`) on first run in [src/db.js](file:///src/db.js) with foreign keys and WAL mode.
6. **Run Automated Tests**:
   ```bash
   npm test
   ```
7. **Start Development Server**:
   ```bash
   npm start
   ```
8. **Access the Application**:
   Open `http://localhost:3001/signup` to create a test user, sign in, and view the billing management dashboard at `http://localhost:3001/billing`.

---

# 3. The Flow, Step By Step

### Flow 1: Monthly Subscription Purchase
1. **User Action**: The user visits `/plans`, reviews the tiers, and clicks "Subscribe Monthly" ($20.00 / 2,000 cents).
2. **Frontend Payload**: Sends `POST /api/payments/checkout` with JSON `{ planId: "pro", interval: "monthly" }`.
3. **Server Execution**: The request passes through `checkoutLimiter` ([src/middleware/rate-limiter.js](file:///src/middleware/rate-limiter.js)). In [src/payments/service.js](file:///src/payments/service.js), the server calls `initiateCheckout`. It creates a provider checkout session (`cs_test_...`) and writes a record to `payment_logs` with stage `initiation`, status `pending`, amount `2000`, and currency `USD`.
4. **Hosted Checkout Simulation**: Browser redirects to `/checkout?session_id=...`. The user reviews the order summary and clicks "Complete Payment in Test Mode".
5. **Payment Execution & Server-Side Verification**: Frontend posts to `/api/payments/simulate-success`, marking the checkout session as paid on the provider side. The user is redirected to `/payment/return?session_id=...`. The return view executes `POST /api/payments/verify`.
6. **Database Entitlement Grant**: The server verifies that the session is marked `paid` by the provider. Inside a database transaction (`BEGIN IMMEDIATE;`), it logs stage `verification`, updates the user's `subscriptions` record to `plan_id = 'pro'`, `interval = 'monthly'`, `status = 'active'`, sets `current_period_end = now + (30 * 86400)`, and logs stage `fulfilment` with status `succeeded`.

### Flow 2: Mid-Cycle Upgrade from Monthly to Yearly with Proration
1. **User Action**: An active Pro Monthly subscriber (e.g., on day 12 of their 30-day billing cycle) visits `/plans` and clicks "Upgrade to Yearly (Prorated)".
2. **Proration Calculation**: In [src/payments/proration.js](file:///src/payments/proration.js), the server evaluates:
   - Total cycle: 30 days (2,592,000s)
   - Days used: 12 days
   - Days remaining: 18 days
   - Unused credit: `(18 / 30) * 2000 = 1200 cents` ($12.00)
   - New plan cost: 20,000 cents ($200.00)
   - Net charge: `20000 - 1200 = 18800 cents` ($188.00)
3. **Initiation**: Checkout is created for `18800 cents` ($188.00). The breakdown is recorded in `payment_logs` under metadata.
4. **Fulfilment**: Upon successful payment verification, the subscription is updated to `interval = 'yearly'` and the period end is extended by 365 days.

### Flow 3: Webhook Ingestion & Idempotency
1. **Provider Webhook**: The payment provider sends a `POST /api/webhooks/payment` containing payload `{ eventType: "checkout.session.completed", providerEventId: "evt_...", checkoutSessionId: "cs_..." }` with header `X-Webhook-Signature: t=...,v1=...`.
2. **Signature Verification**: Server calculates HMAC-SHA256 of `timestamp.rawPayload` using `PAYMENT_WEBHOOK_SECRET` and performs constant-time comparison via `crypto.timingSafeEqual`.
3. **First Processing**: Server verifies the checkout session, updates `subscriptions`, and writes a log with stage `fulfilment` and status `succeeded`.
4. **Duplicate Webhook Handling**: If the exact same webhook is redelivered, the server checks `payment_logs` for `provider_event_id = ? AND stage = 'fulfilment' AND status = 'succeeded'`. Because a record already exists, it records stage `fulfilment` with status `duplicate` and responds with HTTP 200 without altering the subscription or extending the period end date.

### Flow 4: Cancellation & Retained Access
1. **User Action**: User navigates to `/billing` and clicks "Cancel Subscription". A confirmation modal appears requesting an optional reason.
2. **Submission**: Submits `POST /api/payments/cancel` with `{ reason: "Switching tools" }`.
3. **Database Operation**: Executes `UPDATE subscriptions SET cancel_at_period_end = 1, cancellation_reason = ?, updated_at = ? WHERE id = ?`.
4. **Access Retention**: Access remains active because `status = 'active'` and current time is less than `current_period_end`. The user is informed: "Access remains active until [Period End Date]".

---

# 4. The Data Model

The schema is defined and initialized in [src/db.js](file:///src/db.js):

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('free', 'pro')),
  interval TEXT NOT NULL CHECK (interval IN ('none', 'monthly', 'yearly')),
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'incomplete')),
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  cancellation_reason TEXT,
  scheduled_plan_id TEXT,
  scheduled_interval TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT,
  provider_event_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('initiation', 'verification', 'fulfilment', 'failure')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'duplicate')),
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_provider_event ON payment_logs(provider_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_user_id ON payment_logs(user_id);
```

### Invariant Questions
> **Which constraints in this schema make an invalid state impossible?**
1. `amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)`: Completely prevents floating-point rounding errors and prevents negative monetary amounts from entering the database.
2. `CHECK (stage IN ('initiation', 'verification', 'fulfilment', 'failure'))`: Disallows arbitrary transaction stage states, enforcing strict lifecycle boundaries.
3. `CHECK (status IN ('pending', 'succeeded', 'failed', 'duplicate'))`: Guarantees consistent status classification across all payment logs.
4. `user_id TEXT NOT NULL UNIQUE` on `subscriptions`: Enforces the invariant that a single user cannot have multiple conflicting subscription records.
5. `CHECK (cancel_at_period_end IN (0, 1))`: Prevents corrupt boolean states for scheduled cancellations.
6. `INDEX idx_payment_logs_provider_event`: Enables high-speed lookup of idempotency keys to stop duplicate webhooks from applying entitlement twice.

---

# 5. The Concepts

### 5.1 Minor-Unit Currency Storage
- **What it is**: Storing all monetary figures as whole integer counts of the smallest unit of currency (e.g. cents for USD, pence for GBP). $20.00 is stored as `2000`.
- **Why it is needed**: Floating-point representations (IEEE 754 `FLOAT` or `DOUBLE`) cannot precisely represent decimal fractions like `0.10` or `0.20`. Over thousands of transactions, arithmetic such as `0.1 + 0.2 = 0.30000000000000004` introduces financial discrepancies, rounding errors, and reconciliation failures during accounting audits.
- **How I implemented it**: In [src/config.js](file:///src/config.js) and [src/db.js](file:///src/db.js):
  ```javascript
  amountCents: parseInt(process.env.PRO_MONTHLY_CENTS || '2000', 10), // $20.00 = 2000 cents
  ```
  Database definition: `amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)`.
- **What I chose against, and why**: I chose against `DECIMAL(10, 2)` and JavaScript `Number` floating points. While SQL `DECIMAL` prevents database storage drift, JavaScript native numbers remain floating point unless wrapped in decimal libraries. Minor units as whole integers allow native, loss-free integer arithmetic across the entire stack.

### 5.2 Payment Audit Log Table vs Subscription State Table
- **What it is**: Decoupling mutable current state (`subscriptions`) from an immutable, append-only history of transaction stages (`payment_logs`).
- **Why it is needed**: If an application only stores current subscription state, there is no historical record of when a payment was initiated, whether a previous attempt failed, what idempotency key was used, or what proration credit was calculated. If a user disputes a charge months later, the business has zero forensic evidence of the transaction lifecycle.
- **How I implemented it**: In [src/payments/service.js](file:///src/payments/service.js):
  ```javascript
  export function recordPaymentLog({ userId, subscriptionId, providerEventId, stage, amountCents, currency, status, metadata }, db) {
    db.prepare(`
      INSERT INTO payment_logs (id, user_id, subscription_id, provider_event_id, stage, amount_cents, currency, status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), userId, subscriptionId, providerEventId, stage, amountCents, currency, status, metadata, now);
  }
  ```
- **What I chose against, and why**: I chose against storing transaction metadata directly as columns on the `subscriptions` table. A user has one active subscription but dozens of payment transactions over time. Storing transaction history on the subscription record causes data loss on every renewal.

### 5.3 Server-Side Payment Verification
- **What it is**: Verifying payment status directly with the payment provider backend before updating user entitlements, rather than trusting client-side redirects or URL parameters.
- **Why it is needed**: If entitlement is granted simply because a browser navigated to `/payment/success?session_id=123`, any user can visit that URL directly in their browser or replay another user's session ID to acquire free Pro access without spending money.
- **How I implemented it**: In [src/payments/service.js](file:///src/payments/service.js):
  ```javascript
  const session = getProviderCheckoutSession(checkoutSessionId);
  if (!session || session.paymentStatus !== 'paid') {
    recordPaymentLog({ userId: session.userId, stage: 'failure', status: 'failed', ... });
    throw new Error('Payment verification failed: transaction was not completed by the provider.');
  }
  ```
- **What I chose against, and why**: I chose against trusting client query parameters (e.g. `?status=paid`). The browser is an untrusted client environment; only a direct server-to-server inquiry or cryptographically verified webhook can establish proof of payment.

### 5.4 Webhook HMAC-SHA256 Signature Verification
- **What it is**: Computing a keyed hash message authentication code (HMAC-SHA256) over the raw webhook request payload and comparing it against the provider's signature header using constant-time evaluation.
- **Why it is needed**: Without cryptographic signature verification, an attacker could discover the webhook endpoint (`/api/webhooks/payment`) and send fake JSON payloads granting themselves lifetime subscriptions or triggering arbitrary refunds.
- **How I implemented it**: In [src/payments/provider.js](file:///src/payments/provider.js):
  ```javascript
  const signedPayload = `${timestamp}.${payloadString}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  ```
- **What I chose against, and why**: I chose against comparing signatures using the standard equality operator (`===`). Standard string comparison terminates early on the first mismatched byte, creating side-channel timing vulnerabilities that allow attackers to deduce valid signatures byte-by-byte.

### 5.5 Webhook Idempotency
- **What it is**: Using the provider's unique event identifier (`provider_event_id`) as an idempotency key to ensure that duplicate webhook deliveries do not apply side effects multiple times.
- **Why it is needed**: Payment providers use retry mechanisms with exponential backoff. If an endpoint takes slightly longer to respond or network packets drop, the same webhook may be delivered 3, 5, or 10 times. Without idempotency, a customer could be credited with multiple billing periods or multiple subscriptions for a single charge.
- **How I implemented it**: In [src/payments/service.js](file:///src/payments/service.js):
  ```javascript
  const existingFulfilment = db.prepare(`
    SELECT id FROM payment_logs WHERE provider_event_id = ? AND stage = 'fulfilment' AND status = 'succeeded'
  `).get(effectiveEventId);
  if (existingFulfilment) {
    recordPaymentLog({ providerEventId: effectiveEventId, stage: 'fulfilment', status: 'duplicate', ... });
    return { success: true, duplicate: true, subscription: currentSub };
  }
  ```
- **What I chose against, and why**: I chose against checking timestamps or relying on client session IDs for idempotency. The provider event ID is globally unique and assigned by the authoritative payment gateway, making it the only reliable idempotency token.

### 5.6 Mid-Cycle Proration Arithmetic
- **What it is**: Calculating the monetary value of unused time on an active subscription and deducting it as credit toward an upgraded plan.
- **Why it is needed**: Without proration, a customer who purchased a monthly plan 5 days ago and upgrades to a yearly plan would be double-charged for the remaining 25 days of the month, resulting in customer disputes and chargebacks.
- **How I implemented it**: In [src/payments/proration.js](file:///src/payments/proration.js):
  ```javascript
  const unusedFraction = secondsRemaining / totalCycleSeconds;
  const unusedCreditCents = Math.round(currentAmountCents * unusedFraction);
  const amountChargedCents = Math.max(0, newAmountCents - unusedCreditCents);
  ```
- **What I chose against, and why**: I chose against discarding unused time or resetting the billing cycle without credit. Fair proration ensures customer trust and eliminates billing friction during mid-cycle upgrades.

### 5.7 Cancellation & Deferred Downgrade
- **What it is**: Allowing a user to cancel or downgrade their paid subscription while retaining full access until the current paid period expires.
- **Why it is needed**: If a user pays $200 for a yearly plan and cancels after 2 months to prevent automatic renewal next year, immediately revoking their access constitutes a breach of contract because they have paid for 12 months of service.
- **How I implemented it**: In [src/payments/service.js](file:///src/payments/service.js):
  ```javascript
  db.prepare(`
    UPDATE subscriptions
    SET cancel_at_period_end = 1, cancellation_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(reason, now, currentSub.id);
  ```
- **What I chose against, and why**: I chose against immediately destroying the subscription record or resetting `plan_id` to `'free'`. Flagging `cancel_at_period_end = 1` preserves the contracted access duration while preventing automatic renewal.

### 5.8 PCI DSS SAQ-A Scope Boundary
- **What it is**: An architectural pattern where no raw credit card numbers, CVVs, or expiration dates ever touch or pass through the merchant server.
- **Why it is needed**: Storing or transmitting primary account numbers (PAN) triggers full PCI DSS compliance audits (SAQ-D), requiring expensive annual QSA audits, dedicated hardware security modules (HSMs), and strict network segregation.
- **How I implemented it**: By integrating a hosted checkout architecture. Card data is collected directly by the payment provider hosted page; our backend only stores opaque session IDs (`cs_test_...`) and transaction references (`pi_...`).
- **What I chose against, and why**: I chose against rendering raw credit card `<input>` fields on our server form. Handling card data directly on our backend would expose the application to severe compliance and liability risks.

---

# 6. What Went Wrong

### Problem 1
- **Symptom**: During initial test execution of `tests/payments.test.js`, Node threw `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../assessment-2-payments/payments/service.js'`.
- **Investigation**: Inspected the import path on line 10 of `tests/payments.test.js`. Noticed that the import was written as `../payments/service.js` instead of `../src/payments/service.js`.
- **Cause**: Relative path discrepancy between test folder structure and source code location.
- **Fix**: Corrected the import path to `../src/payments/service.js` and `../src/payments/provider.js`, allowing ES module resolution to locate the files accurately.

### Problem 2
- **Symptom**: Webhook signature verification initially failed in integration tests when testing raw JSON payloads.
- **Investigation**: Verified secret key and payload string. Discovered that `express.json()` parses the request stream into a JavaScript object, and subsequent `JSON.stringify(req.body)` did not match the exact raw byte sequence sent over the wire due to whitespace differences.
- **Cause**: Express JSON body parser consumes the incoming stream, discarding the verbatim byte sequence necessary for HMAC signature calculation.
- **Fix**: Added a custom `verify` hook inside `express.json()` in [src/app.js](file:///src/app.js) (`express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString('utf-8'); } })`), capturing the unmodified raw body string for cryptographic verification.

### Problem 3
- **Symptom**: In-memory database isolation caused checkout sessions to disconnect from user records across parallel test subtests.
- **Investigation**: Inspected `initiateCheckout` and `verifyAndFulfillPayment`. The provider simulation maintained an in-memory `Map` of checkout sessions while tests were spinning up new in-memory SQLite instances.
- **Cause**: Dual state stores (in-memory Map for provider sessions and in-memory SQLite for application data) had differing lifecycles during test runner resets.
- **Fix**: Centralized test setup in `test.beforeEach` to reset both the database instance and the rate limiter store, ensuring deterministic mapping between simulated checkout sessions and database users.

---

# 7. What This Slice Does Not Handle

1. **Multi-Currency FX Conversion**: All pricing and transactions are locked to `USD` minor units (cents). Real-time foreign exchange rate conversion was intentionally excluded.
2. **Dynamic Sales Tax & VAT (e.g. Stripe Tax / Avalara)**: Tax calculation is excluded. Production billing systems require geolocation-based tax calculation prior to final checkout amount determination.
3. **Dunning & Automated Retry Logic**: If an off-session renewal charge fails due to insufficient funds, real production systems execute dunning workflows (e.g., smart retries on days 3, 5, 7, and automated customer notification emails).
4. **Subscription Pause & Resume**: The slice supports active, canceled, upgrade, and downgrade transitions, but does not support temporary subscription pausing.
5. **Direct Bank Debits (SEPA, ACH)**: Only synchronous simulated card checkout is supported; asynchronous multi-day clearing payment rails are not implemented.

---

# 8. If I Built This Again

If I built this payment and subscription slice again, I would implement an event-driven outbox pattern in the database for payment fulfillment rather than synchronizing subscription table updates directly within the webhook HTTP handler, ensuring that downstream provisioning tasks survive transient worker crashes without re-querying the payment gateway.
