/**
 * Generic per-IP rate limit for anonymous endpoints.
 *
 * Extracted from submit-plan-complaint.js (PR #429 / Audit WC10) so that
 * other anonymous-or-loosely-authed endpoints can share the same pattern
 * without each reinventing the IP-extraction / hashing / transactional
 * bucket dance. PR #432 (Audit W-H13) is the first new consumer —
 * /api/manual-payment-request had no rate limit and the same Telegram-
 * spam blast radius as plan complaints.
 *
 * Design choices:
 *   - IP is sha256-hashed before persistence (no plaintext IPs at rest).
 *   - Rolling-window counter inside a runTransaction so two concurrent
 *     requests can't both pass when count is at cap.
 *   - Fail-OPEN when Firestore is unavailable or the transaction throws
 *     — abuse mitigation must not break real users during a Firestore
 *     outage.
 *   - 429 + Retry-After header on cap hit.
 */
import { createHash } from 'node:crypto';

/**
 * Reads the originating client IP from common proxy headers.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  const xff = req.headers?.['x-forwarded-for'] || req.headers?.['X-Forwarded-For'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  const realIp = req.headers?.['x-real-ip'] || req.headers?.['X-Real-IP'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Returns a 32-char hex prefix of sha256(`coco:${ip}`). Plenty unique for
 * hourly buckets, satisfies Firestore doc id constraints.
 */
export function hashIp(ip) {
  return createHash('sha256').update(`coco:${ip}`).digest('hex').slice(0, 32);
}

/**
 * @param {object} args
 * @param {FirebaseFirestore.Firestore | null} args.db          Admin SDK Firestore; if null we fail-OPEN.
 * @param {string} args.ip                                       From getClientIp(req).
 * @param {string} args.collection                               Firestore collection name (e.g. 'complaint_rate_limits').
 * @param {number} [args.windowMs=3600000]                       Rolling window. Defaults to 1h.
 * @param {number} [args.maxRequests=5]                          Cap within the window.
 * @param {string} [args.errorLabel='requests']                  Human description in the 429 message.
 * @returns {Promise<{ok: true, degraded?: boolean} | {ok: false, status: 429, retryAfterSec: number, error: string}>}
 */
export async function checkIpRateLimit({
  db,
  ip,
  collection,
  windowMs = 60 * 60 * 1000,
  maxRequests = 5,
  errorLabel = 'requests',
}) {
  if (!db || !collection) {
    return { ok: true, degraded: true };
  }
  const ref = db.collection(collection).doc(hashIp(ip));
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let count = 0;
      let windowStart = now;
      if (snap.exists) {
        const data = snap.data() || {};
        const startedAt = Number(data.windowStartedAtMs || 0);
        if (startedAt && now - startedAt < windowMs) {
          count = Number(data.count || 0);
          windowStart = startedAt;
        }
        // expired → fresh bucket below
      }
      if (count >= maxRequests) {
        const retryAfterMs = windowStart + windowMs - now;
        return {
          ok: false,
          status: 429,
          retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          error: `Too many ${errorLabel} from this IP (limit: ${maxRequests}/hour)`,
        };
      }
      tx.set(ref, {
        count: count + 1,
        windowStartedAtMs: windowStart,
        lastSeenAtMs: now,
      });
      return { ok: true };
    });
  } catch (e) {
    // Transaction error → degrade to allow (same as no-db).
    // The caller should still log; we just don't block them.
    return { ok: true, degraded: true, error: e.message };
  }
}

export default checkIpRateLimit;
