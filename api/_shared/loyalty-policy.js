/**
 * Loyalty tier policy shared by earn and refund reversal paths.
 *
 * Keep this as the single server-side source of truth. A refund must
 * recalculate the tier with the exact same thresholds used when earning.
 */
export const LOYALTY_TIERS = [
  { name: 'Platinum', minSpent: 1000, minBookings: 15, earnRate: 0.03 },
  { name: 'Gold',     minSpent: 500,  minBookings: 7,  earnRate: 0.02 },
  { name: 'Silver',   minSpent: 200,  minBookings: 3,  earnRate: 0.015 },
  { name: 'Bronze',   minSpent: 0,    minBookings: 0,  earnRate: 0.01 },
];

export function calculateLoyaltyTier(totalSpentUSD, bookingCount) {
  const spent = Math.max(0, Number(totalSpentUSD) || 0);
  const count = Math.max(0, Number(bookingCount) || 0);
  for (const tier of LOYALTY_TIERS) {
    if (spent >= tier.minSpent || count >= tier.minBookings) return tier;
  }
  return LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
}
