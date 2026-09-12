# LinkedIn Post — Metis Bootcamp Assessment 2: Payment & Subscription Slice

💳 **Metis Academic Co-Pilot — Assessment 2: Idempotent Payments & Subscription State Machine**

Why floating-point math and non-idempotent webhooks will destroy your billing engine.

For the second assessment of the **Metis Academic Co-Pilot** platform, I built a production-minded **Payment & Subscription Slice** focused on pay-as-you-go token accounting, subscription state transitions, and strict webhook idempotency.

### Key Engineering Invariants:
1. **Idempotency Guard (`stripeRefId` / Event Deduplication)**: Webhook endpoints track processed event IDs (`evt_...`) in a `webhook_events` table. If Stripe re-delivers a payment notification, the server responds `200 OK` without double-crediting student balances.
2. **Zero Floating-Point Financial Math**: All transaction values and proration calculations are processed as integer minor units (cents). $20.00 is strictly stored as `2000` cents.
3. **Deterministic Subscription State Machine**: Manages transitions between `active`, `past_due`, and `canceled` states with explicit retry limits and end-of-period access retention.

#SoftwareEngineering #FinTech #NodeJS #Metis #Webhooks #Idempotency #BackendDevelopment #DatabaseDesign
