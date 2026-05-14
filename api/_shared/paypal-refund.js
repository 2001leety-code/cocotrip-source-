/**
 * PayPal capture refund helper.
 *
 * Shared between user-initiated cancelBooking and admin-initiated
 * mark-refunded (PR #425, Audit CY5). Pre-PR-#425 the admin path skipped
 * the PayPal API entirely — it set Firestore status='REFUNDED' and sent
 * the customer an email saying "refunded", but the money stayed in the
 * merchant account. Customers chased their money for days.
 *
 * Caller passes a captureID + optional `refundUSD` (defaults to full
 * capture refund). Returns the PayPal refund payload on success, or
 * `{ ok: false, code, error, status }` on failure so the caller can
 * keep a meaningful HTTP status / log line.
 */
import { getPaypalAccessToken } from './paypal.js';

/**
 * @param {object} args
 * @param {string} args.captureID — PayPal v2 capture id (booking.captureID).
 * @param {string} [args.refundUSD] — numeric string. Omit for full refund.
 * @param {string} [args.note] — PayPal note_to_payer (shown on PayPal receipt).
 * @param {boolean} [args.isSandbox=false]
 * @returns {Promise<{ok: true, refund: object} | {ok: false, code: string, error: string, status: number}>}
 */
export async function refundPaypalCapture({ captureID, refundUSD, note, isSandbox = false }) {
  if (!captureID) {
    return { ok: false, code: 'NO_CAPTURE_ID', error: 'captureID required', status: 400 };
  }
  let token;
  let baseUrl;
  try {
    ({ accessToken: token, baseUrl } = await getPaypalAccessToken(isSandbox));
  } catch (e) {
    return { ok: false, code: 'PAYPAL_AUTH_FAILED', error: e.message, status: 502 };
  }

  const body = refundUSD
    ? {
        amount: { value: String(refundUSD), currency_code: 'USD' },
        note_to_payer: note || `CocoTrip partial refund: $${refundUSD}`,
      }
    : {
        note_to_payer: note || 'CocoTrip full refund',
      };

  let refundData;
  try {
    const res = await fetch(`${baseUrl}/v2/payments/captures/${captureID}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    refundData = await res.json().catch(() => ({}));
    if (refundData.status === 'COMPLETED' || refundData.status === 'PENDING') {
      return { ok: true, refund: refundData };
    }
    return {
      ok: false,
      code: 'PAYPAL_REFUND_FAILED',
      error: `PayPal refund ${refundData.status || 'unknown'}: ${refundData.message || refundData.name || ''}`,
      status: 502,
    };
  } catch (e) {
    return { ok: false, code: 'PAYPAL_NETWORK_ERROR', error: e.message, status: 502 };
  }
}

export default refundPaypalCapture;
