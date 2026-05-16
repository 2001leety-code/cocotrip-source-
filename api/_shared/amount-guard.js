/**
 * Numeric amount validation guard.
 *
 * PR #452 (Audit Z-H9 — 2026-05-16).
 *
 * Pre-fix: api/booking-processor.js used `parseFloat(amount || 0)` in three
 * places (KRW conversion, booking record, loyalty earn). For `amount`
 * values like `'abc'`, `null`, `undefined`, the OR-default catches null /
 * undefined / '' but NOT NaN strings, so parseFloat('abc') = NaN propagates:
 *
 *   amountKRW = Math.round(NaN * exchangeRate)  // → NaN
 *   amountUSD = parseFloat('abc' || 0).toFixed(2)  // → "NaN"
 *
 * Sheets / customer email / voucher PDF all then showed `$NaN` or `₩NaN`.
 * Worse — loyalty earn would silently no-op (amountNum=0) so the user
 * lost their points without any signal.
 *
 * This helper:
 *   - returns { value, invalid, raw } where value is a safe number (0
 *     on invalid input) and invalid flags malformed payloads
 *   - never throws — caller picks the policy (block vs proceed-with-0)
 *
 * Recommended pattern at call sites:
 *   const { value: amountUSD, invalid } = safeParseAmountUSD(amount);
 *   if (invalid) {
 *     throttledTelegramAlert({
 *       key: 'booking-amount-nan', severity: 'critical', channel: 'admin',
 *       message: `🚨 booking amount NaN: <code>${orderID}</code> raw=${String(amount).slice(0, 100)}`,
 *       context: { orderID, rawAmount: String(amount).slice(0, 100) },
 *     }).catch(() => {});
 *   }
 *   // Proceed with `value` (0 if invalid). Operator reviews + corrects via
 *   // admin endpoint. Better than blocking the booking entirely.
 */

/**
 * @param {unknown} input
 * @returns {{ value: number, invalid: boolean, raw: unknown }}
 */
export function safeParseAmountUSD(input) {
  // null / undefined / '' → treat as 0 (legitimate zero-amount fallback)
  if (input === null || input === undefined || input === '') {
    return { value: 0, invalid: false, raw: input };
  }
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n) || n < 0) {
    return { value: 0, invalid: true, raw: input };
  }
  return { value: n, invalid: false, raw: input };
}

export default safeParseAmountUSD;
