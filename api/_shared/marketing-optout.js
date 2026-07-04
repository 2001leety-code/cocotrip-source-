/**
 * Marketing opt-out (수신거부) infrastructure.
 *
 * 2026-06-30: #1021 started persisting `bookings/{orderID}.marketingConsent`
 * (+ marketingConsentAt). Korean law (정보통신망법 §50) requires an
 * unsubscribe / opt-out mechanism the moment any marketing email is sent —
 * consent alone is not enough; the recipient must be able to withdraw it via
 * a one-click link in every message. This module is the **legal precondition**
 * built BEFORE any sending is enabled.
 *
 * ⚠️ SCOPE — opt-out infrastructure ONLY. There is intentionally NO email
 * sending code here (no ESP integration, no sendMarketingEmail). Turning
 * sending ON is a separate operator / 법무 / ESP decision. This module only:
 *   - stores opt-out records (recordOptOut)
 *   - answers "is this email opted out?" (isMarketingOptedOut) — defined now,
 *     so a future sender can call it; not yet wired to any sender.
 *   - mints / verifies the per-email HMAC token (unsubscribe link forgery
 *     guard)
 *   - builds the unsubscribe URL a future mail footer will embed
 *
 * Firestore collection: `marketing_optout/{emailLower}`
 *   { email: string (lowercased), optedOutAt: ISO string, source: string }
 *
 * HMAC secret: process.env.MARKETING_UNSUBSCRIBE_SECRET
 *   - A DEDICATED secret (not reused from payment/cron/internal-API auth) so
 *     that an unsubscribe-link leak can never grant any other privilege, and
 *     so the secret can be rotated independently.
 *   - 🌐 Operator action: set MARKETING_UNSUBSCRIBE_SECRET in **Vercel env**
 *     (Production + Preview + Development — see CLAUDE.md §I). A long random
 *     value, e.g. `openssl rand -hex 32`. Until it is set, token generation /
 *     verification fail closed (no token issued, every token rejected) — which
 *     is safe because sending is OFF anyway.
 */

import crypto from 'crypto';

export const OPTOUT_COLLECTION = 'marketing_optout';

/**
 * Normalize an email for use as a stable Firestore doc id / lookup key.
 * Lowercased + trimmed. Returns '' for non-string / empty input.
 * @param {unknown} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/** Constant-time string compare (mirrors api/_shared/cron-auth.js). */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getSecret() {
  return (process.env.MARKETING_UNSUBSCRIBE_SECRET || '').trim();
}

/**
 * Mint the unsubscribe token for an email = HMAC-SHA256(emailLower) hex.
 * Returns '' if the email is empty or the secret is unset (fail closed —
 * caller should treat '' as "no link can be issued yet").
 * @param {string} email
 * @returns {string} hex token, or '' when unavailable
 */
export function generateUnsubscribeToken(email) {
  const emailLower = normalizeEmail(email);
  const secret = getSecret();
  if (!emailLower || !secret) return '';
  return crypto.createHmac('sha256', secret).update(emailLower).digest('hex');
}

/**
 * Verify a presented unsubscribe token against an email. Constant-time.
 * Returns false if the secret is unset (fail closed) or anything mismatches.
 * @param {string} email
 * @param {string} token
 * @returns {boolean}
 */
export function verifyUnsubscribeToken(email, token) {
  const expected = generateUnsubscribeToken(email);
  if (!expected || typeof token !== 'string' || !token) return false;
  return timingSafeEqualStr(expected, token.trim().toLowerCase());
}

/**
 * Build the unsubscribe URL a future marketing-mail footer will embed.
 * `${siteUrl}/api/marketing-unsubscribe?email=...&token=HMAC(email)`
 * Returns '' if no token can be minted (empty email / secret unset).
 *
 * @param {string} email
 * @param {object} [opts]
 * @param {string} [opts.siteUrl] - override base URL. Defaults to
 *   `https://${VERCEL_URL}` when set, else https://cocotripkr.com.
 * @returns {string}
 */
export function buildUnsubscribeUrl(email, opts = {}) {
  const emailLower = normalizeEmail(email);
  const token = generateUnsubscribeToken(emailLower);
  if (!emailLower || !token) return '';
  const siteUrl =
    opts.siteUrl ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com');
  const qs = `email=${encodeURIComponent(emailLower)}&token=${encodeURIComponent(token)}`;
  return `${siteUrl}/api/marketing-unsubscribe?${qs}`;
}

/**
 * Record an opt-out in Firestore (idempotent — merge on emailLower doc id).
 *
 * @param {object} db - firestore-admin instance (initAdminDb()).
 * @param {string} email
 * @param {object} [opts]
 * @param {string} [opts.source='unsubscribe_link'] - where the opt-out came
 *   from (e.g. 'unsubscribe_link', 'admin', 'reply_stop').
 * @returns {Promise<{ok: true, email: string} | {ok: false, error: string}>}
 */
export async function recordOptOut(db, email, opts = {}) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return { ok: false, error: 'invalid email' };
  if (!db) return { ok: false, error: 'firestore unavailable' };
  const source = typeof opts.source === 'string' && opts.source ? opts.source : 'unsubscribe_link';
  try {
    await db.collection(OPTOUT_COLLECTION).doc(emailLower).set(
      {
        email: emailLower,
        optedOutAt: new Date().toISOString(),
        source,
      },
      { merge: true },
    );
    return { ok: true, email: emailLower };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Has this email opted out of marketing? Used by a FUTURE sender to exclude
 * recipients — even when `bookings/{orderID}.marketingConsent === true`,
 * an opt-out record here must win (consent withdrawn).
 *
 * Fail-safe: on Firestore error returns `true` (treat as opted-out) so a
 * lookup failure can never cause us to mail someone who may have opted out.
 *
 * @param {object} db - firestore-admin instance.
 * @param {string} email
 * @returns {Promise<boolean>} true = opted out (do NOT send)
 */
export async function isMarketingOptedOut(db, email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return true; // no/invalid email → never send
  if (!db) return true; // can't verify → fail closed
  try {
    const snap = await db.collection(OPTOUT_COLLECTION).doc(emailLower).get();
    return snap.exists;
  } catch {
    return true; // lookup failed → fail closed (do not send)
  }
}

export default {
  OPTOUT_COLLECTION,
  normalizeEmail,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  recordOptOut,
  isMarketingOptedOut,
};
