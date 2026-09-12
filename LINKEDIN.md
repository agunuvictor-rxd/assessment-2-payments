# LinkedIn Post — Assessment 2: Payment and Subscription Slice

**Why you should never store prices as floating-point numbers (and how we engineered mid-cycle subscription proration)**

If you store $19.99 in your database as `19.99` using a standard JavaScript float or database `FLOAT`, your accounting team will eventually find missing pennies. In IEEE 754 floating-point arithmetic, `0.1 + 0.2` equals `0.30000000000000004`. Over tens of thousands of subscription renewals and proration calculations, these tiny rounding discrepancies compound into reconciliation nightmares.

For the second milestone of our Product Engineering Bootcamp, I built a production-minded Payment and Subscription Slice with Node.js, Express, and SQLite.

One foundational rule we enforced from day one: **all money is stored strictly as integers in minor units (cents) alongside the ISO currency code**. A $20.00 monthly subscription is represented in the database as `2000` cents USD.

This made our mid-cycle upgrade proration math airtight. Consider an actual upgrade scenario we tested:
- A user is on Pro Monthly ($20.00 = 2,000 cents) with a 30-day billing cycle (2,592,000 seconds).
- On day 12, they decide to upgrade to Pro Yearly ($200.00 = 20,000 cents).
- 18 days remain in their current cycle.
- Unused credit is calculated to the second: `(18 / 30) * 2000 = 1200 cents` ($12.00).
- The net charge for the upgrade is computed directly: `20000 - 1200 = 18800 cents` ($188.00).

Because every step of the calculation uses whole minor units, there is zero floating-point drift.

We combined this with cryptographic HMAC-SHA256 webhook verification using constant-time comparison (`crypto.timingSafeEqual`) and database-enforced webhook idempotency. If the payment gateway sends the same payment completion event twice due to network retries, our system recognizes the existing `provider_event_id` in our multi-stage `payment_logs` table and avoids extending the user's billing period twice.

Check out the complete implementation, database schemas, and reproducible test evidence:
https://github.com/developer/assessment-2-payments

#SoftwareEngineering #Fintech #NodeJS #WebDevelopment #DatabaseDesign #PaymentArchitecture
