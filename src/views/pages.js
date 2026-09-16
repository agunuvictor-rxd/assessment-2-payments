import { renderLayout } from './layout.js';
import { escapeHtml, embedScriptJson, formatMoney } from './utils.js';

export function plansView({ user, subscription }) {
  const isFree = subscription.plan_id === 'free';
  const isMonthly = subscription.plan_id === 'pro' && subscription.interval === 'monthly';
  const isYearly = subscription.plan_id === 'pro' && subscription.interval === 'yearly';

  const content = `
    <div class="card">
      <h1>Subscription Plans</h1>
      <p class="subtitle">Select the plan that fits your requirements. Test mode enabled.</p>

      <div class="pricing-grid">
        <!-- Free Tier -->
        <div class="pricing-card">
          <div>
            <h3>Free</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">Basic access for casual users</p>
            <div class="price-amount">$0 <span class="price-period">forever</span></div>
          </div>
          <div style="margin-top: 1.5rem;">
            ${isFree ? `
              <button class="btn btn-secondary" disabled style="width:100%;">Current Plan</button>
            ` : `
              <button class="btn btn-secondary" onclick="scheduleDowngrade()" style="width:100%;">Downgrade to Free</button>
            `}
          </div>
        </div>

        <!-- Pro Monthly -->
        <div class="pricing-card ${isMonthly ? 'featured' : ''}">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3>Pro Monthly</h3>
              ${isMonthly ? '<span class="badge badge-active">Current</span>' : ''}
            </div>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">Billed every 30 days</p>
            <div class="price-amount">$20 <span class="price-period">/ month (2,000¢)</span></div>
          </div>
          <div style="margin-top: 1.5rem;">
            ${isMonthly ? `
              <button class="btn btn-secondary" disabled style="width:100%;">Current Plan</button>
            ` : `
              <button class="btn" onclick="initiateCheckout('pro', 'monthly')" style="width:100%;">
                ${isYearly ? 'Switch to Monthly at Period End' : 'Subscribe Monthly'}
              </button>
            `}
          </div>
        </div>

        <!-- Pro Yearly -->
        <div class="pricing-card ${isYearly ? 'featured' : ''}">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3>Pro Yearly</h3>
              ${isYearly ? '<span class="badge badge-active">Current</span>' : ''}
            </div>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">Billed annually (save $40/yr)</p>
            <div class="price-amount">$200 <span class="price-period">/ year (20,000¢)</span></div>
          </div>
          <div style="margin-top: 1.5rem;">
            ${isYearly ? `
              <button class="btn btn-secondary" disabled style="width:100%;">Current Plan</button>
            ` : `
              <button class="btn" onclick="initiateCheckout('pro', 'yearly')" style="width:100%;">
                ${isMonthly ? 'Upgrade to Yearly (Prorated)' : 'Subscribe Yearly'}
              </button>
            `}
          </div>
        </div>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      async function initiateCheckout(planId, interval) {
        try {
          const res = await fetch('/api/payments/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planId, interval }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Failed to initiate checkout.');
            return;
          }
          window.location.href = data.checkoutUrl;
        } catch (err) {
          alert('Network error while initiating checkout.');
        }
      }

      async function scheduleDowngrade() {
        if (!confirm('Are you sure you want to downgrade to Free? You will retain Pro access until your current billing period ends.')) {
          return;
        }
        try {
          const res = await fetch('/api/payments/downgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Failed to downgrade.');
            return;
          }
          alert(data.message);
          window.location.href = '/billing';
        } catch (err) {
          alert('Network error.');
        }
      }
    </script>
  `;

  return renderLayout({ title: 'Subscription Plans', user, content, scripts });
}

export function checkoutView({ user, session, proration }) {
  const amountFormatted = formatMoney(session.amountCents);

  const content = `
    <div class="card" style="max-width: 540px; margin: 2rem auto;">
      <h1>Checkout Initiation</h1>
      <p class="subtitle">Complete payment with simulated test-mode provider</p>

      <div style="background: #0f172a; border: 1px solid var(--card-border); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
          <span style="color: var(--text-muted);">Plan Selected:</span>
          <strong>Pro (${session.interval === 'yearly' ? 'Yearly' : 'Monthly'})</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
          <span style="color: var(--text-muted);">Minor Units:</span>
          <code>${session.amountCents} ${escapeHtml(session.currency)} cents</code>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.75rem;">
          <span style="color: var(--text-muted);">Session ID:</span>
          <code style="font-size: 0.8rem;">${escapeHtml(session.id)}</code>
        </div>

        ${proration ? `
          <div style="border-top: 1px dashed var(--card-border); margin-top: 1rem; padding-top: 1rem; font-size: 0.85rem;">
            <p style="color: var(--primary); font-weight: 700; margin-bottom: 0.5rem;">Mid-Cycle Upgrade Proration Applied</p>
            <div style="display:flex; justify-content:space-between; margin-bottom: 0.25rem;">
              <span>New Plan Cost:</span>
              <span>$${formatMoney(proration.newPlanCostCents)} (${proration.newPlanCostCents}¢)</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 0.25rem;">
              <span>Days Remaining in Cycle:</span>
              <span>${proration.daysRemaining} of ${proration.daysInCycle} days</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom: 0.25rem; color: var(--success);">
              <span>Unused Credit Deducted:</span>
              <span>-$${formatMoney(proration.unusedCreditCents)} (${proration.unusedCreditCents}¢)</span>
            </div>
          </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; margin-top: 1rem; pt: 1rem; border-top: 1px solid var(--card-border); font-size: 1.25rem; font-weight: 700;">
          <span>Total Due Today:</span>
          <span style="color: var(--primary);">$${amountFormatted} ${session.currency}</span>
        </div>
      </div>

      <div style="margin-bottom: 1.5rem; font-size: 0.85rem; color: var(--text-muted);">
        🔒 <em>PCI DSS Compliance Notice:</em> Cardholder payment data is captured directly by the payment provider hosted elements. No raw card numbers touch our server.
      </div>

      <button id="payBtn" class="btn" style="width: 100%; font-size: 1.05rem;" onclick="processPayment()">
        Complete Payment in Test Mode ($${amountFormatted})
      </button>
    </div>
  `;

  const scripts = `
    <script>
      async function processPayment() {
        const btn = document.getElementById('payBtn');
        btn.disabled = true;
        btn.textContent = 'Processing transaction with provider...';

        try {
          // 1. Simulate customer completing payment on provider hosted form
          const simRes = await fetch('/api/payments/simulate-success', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: ${embedScriptJson(session.id)} }),
          });

          if (!simRes.ok) {
            alert('Simulated payment declined.');
            btn.disabled = false;
            btn.textContent = 'Retry Payment';
            return;
          }

          // 2. Redirect to payment return verification view
          window.location.href = '/payment/return?session_id=${session.id}';
        } catch (err) {
          alert('Payment processing error.');
          btn.disabled = false;
        }
      }
    </script>
  `;

  return renderLayout({ title: 'Checkout', user, content, scripts });
}

export function paymentReturnView({ user, sessionId }) {
  const content = `
    <div class="card" style="max-width: 540px; margin: 2rem auto; text-align: center;">
      <h1>Payment Verification</h1>
      <p id="statusMsg" class="subtitle">Contacting payment provider to verify transaction server-side...</p>

      <div id="loader" style="margin: 2rem 0; font-size: 1.5rem;">
        ⏳ Verifying transaction...
      </div>

      <div id="resultBox" style="display: none;"></div>

      <div style="margin-top: 2rem;">
        <a href="/billing" class="btn" id="billingBtn" style="display:none;">View Billing Dashboard</a>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      async function verifyPayment() {
        const statusMsg = document.getElementById('statusMsg');
        const loader = document.getElementById('loader');
        const resultBox = document.getElementById('resultBox');
        const billingBtn = document.getElementById('billingBtn');

        try {
          const res = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: ${embedScriptJson(sessionId)} }),
          });

          const data = await res.json();
          loader.style.display = 'none';
          billingBtn.style.display = 'inline-block';

          if (!res.ok) {
            statusMsg.textContent = 'Verification Failed';
            resultBox.className = 'alert alert-error';
            resultBox.textContent = data.error || 'Server could not verify payment with provider.';
            resultBox.style.display = 'block';
            return;
          }

          statusMsg.textContent = 'Payment Succeeded & Verified';
          resultBox.className = 'alert alert-success';
          resultBox.innerHTML = '<strong>Entitlement Granted!</strong> Your subscription is now active. Server-side verification succeeded and transaction has been logged.';
          resultBox.style.display = 'block';
        } catch (err) {
          loader.style.display = 'none';
          statusMsg.textContent = 'Communication Error';
          resultBox.className = 'alert alert-error';
          resultBox.textContent = 'Could not communicate with the verification server.';
          resultBox.style.display = 'block';
        }
      }

      window.addEventListener('DOMContentLoaded', verifyPayment);
    </script>
  `;

  return renderLayout({ title: 'Payment Return', user, content, scripts });
}

export function billingView({ user, subscription, paymentLogs }) {
  const isFree = subscription.plan_id === 'free';
  const periodEndFormatted = new Date(subscription.current_period_end * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const content = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem;">
        <div>
          <h1>Billing & Subscription</h1>
          <p class="subtitle" style="margin-bottom: 0;">Manage your plan, renewals, and payment history.</p>
        </div>
        <div>
          <a href="/plans" class="btn btn-secondary">Change Plan</a>
        </div>
      </div>

      ${subscription.cancel_at_period_end ? `
        <div class="alert alert-warning">
          <strong>Cancellation Scheduled:</strong> Your subscription has been canceled. You retain full access to Pro features until <strong>${periodEndFormatted}</strong>.
          ${subscription.cancellation_reason ? `<br><small>Reason given: "${escapeHtml(subscription.cancellation_reason)}"</small>` : ''}
        </div>
      ` : ''}

      ${subscription.scheduled_plan_id ? `
        <div class="alert alert-warning">
          <strong>Downgrade Scheduled:</strong> You have scheduled a downgrade to Free. Your Pro benefits remain active until the end of your billing cycle on <strong>${periodEndFormatted}</strong>.
        </div>
      ` : ''}

      <!-- Current Subscription Status Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; background: #0f172a; padding: 1.5rem; border-radius: 8px; border: 1px solid var(--card-border); margin-bottom: 2rem;">
        <div>
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">Current Plan</div>
          <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem; color: #fff;">
            ${isFree ? 'Free Tier' : `Pro (${subscription.interval === 'yearly' ? 'Yearly' : 'Monthly'})`}
          </div>
        </div>

        <div>
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">Status</div>
          <div style="margin-top: 0.25rem;">
            ${subscription.status === 'active' && !subscription.cancel_at_period_end ? `
              <span class="badge badge-active">Active</span>
            ` : subscription.cancel_at_period_end ? `
              <span class="badge badge-canceled">Canceled (Active until period end)</span>
            ` : `
              <span class="badge badge-free">${escapeHtml(subscription.status)}</span>
            `}
          </div>
        </div>

        <div>
          <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase;">
            ${subscription.cancel_at_period_end ? 'Access Ends On' : 'Next Renewal Date'}
          </div>
          <div style="font-size: 1.1rem; font-weight: 600; margin-top: 0.25rem;">
            ${isFree ? 'Never (Lifetime)' : periodEndFormatted}
          </div>
        </div>

        ${!isFree && !subscription.cancel_at_period_end ? `
          <div style="display: flex; align-items: center; justify-content: flex-end;">
            <button class="btn btn-danger" onclick="openCancelModal()" style="font-size: 0.85rem; padding: 0.5rem 1rem;">
              Cancel Subscription
            </button>
          </div>
        ` : ''}
      </div>

      <!-- Payment Audit Log -->
      <h2 style="font-size: 1.25rem; margin-bottom: 1rem;">Payment Transaction History</h2>
      ${paymentLogs.length === 0 ? `
        <p style="color: var(--text-muted); font-size: 0.9rem;">No payment transactions recorded yet.</p>
      ` : `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--card-border); color: var(--text-muted);">
                <th style="padding: 0.75rem 0.5rem;">Timestamp</th>
                <th style="padding: 0.75rem 0.5rem;">Stage</th>
                <th style="padding: 0.75rem 0.5rem;">Amount</th>
                <th style="padding: 0.75rem 0.5rem;">Status</th>
                <th style="padding: 0.75rem 0.5rem;">Provider Event ID</th>
              </tr>
            </thead>
            <tbody>
              ${paymentLogs.map(log => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                  <td style="padding: 0.75rem 0.5rem; color: var(--text-muted);">
                    ${new Date(log.created_at * 1000).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td style="padding: 0.75rem 0.5rem; font-weight: 600; text-transform: uppercase; font-size: 0.75rem;">
                    ${escapeHtml(log.stage)}
                  </td>
                  <td style="padding: 0.75rem 0.5rem;">
                    $${formatMoney(log.amount_cents)} ${escapeHtml(log.currency)}
                  </td>
                  <td style="padding: 0.75rem 0.5rem;">
                    <span class="badge ${log.status === 'succeeded' ? 'badge-active' : log.status === 'duplicate' ? 'badge-free' : 'badge-canceled'}">
                      ${escapeHtml(log.status)}
                    </span>
                  </td>
                  <td style="padding: 0.75rem 0.5rem; font-family: monospace; font-size: 0.75rem; color: var(--text-muted);">
                    ${escapeHtml(log.provider_event_id)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

    <!-- Cancellation Modal -->
    <div id="cancelModal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; padding: 1.5rem; z-index: 100;">
      <div class="card" style="max-width: 480px; width: 100%;">
        <h2>Confirm Cancellation</h2>
        <p class="subtitle" style="margin-top: 0.5rem;">
          You will maintain full Pro access until <strong>${periodEndFormatted}</strong>. After that, your account will revert to the Free tier.
        </p>

        <div style="margin-bottom: 1.25rem;">
          <label for="cancelReason" style="display:block; font-size:0.875rem; margin-bottom: 0.5rem; color: #e2e8f0;">
            Reason for cancellation (optional):
          </label>
          <input type="text" id="cancelReason" placeholder="e.g., Switching tools, too expensive..." style="width:100%; padding:0.75rem; background:#0f172a; border:1px solid var(--card-border); color:#fff; border-radius:8px;">
        </div>

        <div style="display:flex; justify-content:flex-end; gap:1rem;">
          <button class="btn btn-secondary" onclick="closeCancelModal()">Keep Subscription</button>
          <button class="btn btn-danger" id="confirmCancelBtn" onclick="submitCancellation()">Confirm Cancellation</button>
        </div>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      function openCancelModal() {
        document.getElementById('cancelModal').style.display = 'flex';
      }
      function closeCancelModal() {
        document.getElementById('cancelModal').style.display = 'none';
      }

      async function submitCancellation() {
        const btn = document.getElementById('confirmCancelBtn');
        const reason = document.getElementById('cancelReason').value.trim();
        btn.disabled = true;
        btn.textContent = 'Canceling...';

        try {
          const res = await fetch('/api/payments/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason || null }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Cancellation failed.');
            btn.disabled = false;
            return;
          }
          alert(data.message);
          window.location.reload();
        } catch (err) {
          alert('Network error.');
          btn.disabled = false;
        }
      }
    </script>
  `;

  return renderLayout({ title: 'Billing', user, content, scripts });
}

export function signinView() {
  const content = `
    <div class="card" style="max-width: 420px; margin: 3rem auto;">
      <h1>Sign in to Billing</h1>
      <p class="subtitle">Access your subscription dashboard</p>
      <form id="signinForm">
        <div style="margin-bottom: 1rem;">
          <label style="display:block; font-size: 0.85rem; margin-bottom: 0.4rem;">Email</label>
          <input type="email" id="email" required style="width:100%; padding:0.75rem; background:#0f172a; border:1px solid var(--card-border); color:#fff; border-radius:8px;">
        </div>
        <div style="margin-bottom: 1.5rem;">
          <label style="display:block; font-size: 0.85rem; margin-bottom: 0.4rem;">Password</label>
          <input type="password" id="password" required style="width:100%; padding:0.75rem; background:#0f172a; border:1px solid var(--card-border); color:#fff; border-radius:8px;">
        </div>
        <button type="submit" class="btn" style="width:100%;">Sign In</button>
      </form>
      <div style="margin-top: 1rem; text-align: center; font-size: 0.85rem;">
        Don't have an account? <a href="/signup" style="color:var(--primary);">Sign up</a>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      document.getElementById('signinForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const res = await fetch('/api/auth/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (res.ok) window.location.href = '/billing';
        else alert('Invalid credentials');
      });
    </script>
  `;

  return renderLayout({ title: 'Sign In', content, scripts });
}

export function signupView() {
  const content = `
    <div class="card" style="max-width: 420px; margin: 3rem auto;">
      <h1>Create an Account</h1>
      <p class="subtitle">Start testing payments and subscriptions</p>
      <form id="signupForm">
        <div style="margin-bottom: 1rem;">
          <label style="display:block; font-size: 0.85rem; margin-bottom: 0.4rem;">Full Name</label>
          <input type="text" id="name" required style="width:100%; padding:0.75rem; background:#0f172a; border:1px solid var(--card-border); color:#fff; border-radius:8px;">
        </div>
        <div style="margin-bottom: 1rem;">
          <label style="display:block; font-size: 0.85rem; margin-bottom: 0.4rem;">Email</label>
          <input type="email" id="email" required style="width:100%; padding:0.75rem; background:#0f172a; border:1px solid var(--card-border); color:#fff; border-radius:8px;">
        </div>
        <div style="margin-bottom: 1.5rem;">
          <label style="display:block; font-size: 0.85rem; margin-bottom: 0.4rem;">Password</label>
          <input type="password" id="password" required style="width:100%; padding:0.75rem; background:#0f172a; border:1px solid var(--card-border); color:#fff; border-radius:8px;">
        </div>
        <button type="submit" class="btn" style="width:100%;">Create Account</button>
      </form>
      <div style="margin-top: 1rem; text-align: center; font-size: 0.85rem;">
        Already have an account? <a href="/signin" style="color:var(--primary);">Sign in</a>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        if (res.ok) window.location.href = '/billing';
        else {
          const d = await res.json();
          alert(d.error || 'Signup failed');
        }
      });
    </script>
  `;

  return renderLayout({ title: 'Sign Up', content, scripts });
}
