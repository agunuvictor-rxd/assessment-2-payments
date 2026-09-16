/**
 * Proration Calculator for Mid-Cycle Subscription Upgrades.
 * Strictly operates in whole minor units (cents) to eliminate floating-point drift.
 */
export function calculateProration({
  currentAmountCents,
  periodStart,
  periodEnd,
  effectiveAt = Math.floor(Date.now() / 1000),
  newAmountCents,
}) {
  const totalCycleSeconds = periodEnd - periodStart;
  if (totalCycleSeconds <= 0) {
    throw new Error('Invalid subscription period: periodEnd must be strictly greater than periodStart');
  }

  const secondsUsed = Math.max(0, Math.min(totalCycleSeconds, effectiveAt - periodStart));
  const secondsRemaining = Math.max(0, totalCycleSeconds - secondsUsed);

  // Approximate integer day counts for human display and audit logs
  const daysInCycle = Math.round(totalCycleSeconds / 86400);
  const daysUsed = Math.floor(secondsUsed / 86400);
  const daysRemaining = Math.ceil(secondsRemaining / 86400);

  // Exact integer minor-unit unused credit.
  // Integer math avoids floating-point drift and always floors to favor the merchant,
  // consistent with the documented arithmetic (e.g. Math.floor(15 * (2000 / 30)) = 1000).
  const unusedCreditCents = Math.floor((currentAmountCents * secondsRemaining) / totalCycleSeconds);

  const amountChargedCents = Math.max(0, newAmountCents - unusedCreditCents);

  return {
    daysInCycle,
    daysUsed,
    daysRemaining,
    unusedCreditCents,
    newPlanCostCents: newAmountCents,
    amountChargedCents,
    arithmeticSummary: {
      originalPlanCostCents: currentAmountCents,
      unusedCreditCents,
      newPlanCostCents: newAmountCents,
      netChargeCents: amountChargedCents,
      formula: `Net Charge = New Plan Cost (${newAmountCents}) - Unused Credit (${unusedCreditCents}) = ${amountChargedCents} cents`,
    },
  };
}
