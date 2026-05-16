/**
 * CORS helpers.
 *
 * PR #437 (Audit W-H11 — 2026-05-16): admin-* endpoints previously
 * returned `Access-Control-Allow-Origin: *`. With wildcard:
 *   - Any site can fire a no-credentials POST from a victim's browser
 *     (even though our Authorization: Bearer token-auth means the
 *     attacker can't read the token, they can still trigger admin
 *     side-effects if the victim's admin session is open in same browser
 *     AND the admin endpoint also accepts unauthenticated probe behavior
 *     for diagnostic purposes — defense in depth fails here).
 *   - Browsers can't share credentials with wildcard origin → if we ever
 *     migrate to cookie-auth, this silently breaks.
 *
 * Fix: `buildAdminCors(req)` returns headers that echo the request Origin
 * only if it matches the allowlist:
 *   - https://cocotripkr.com
 *   - https://www.cocotripkr.com
 *   - https://cocotrip-source*.vercel.app  (Vercel preview deployments)
 *   - http://localhost:5173                (Vite dev server)
 *   - http://localhost:3000                (alt dev)
 * Otherwise Access-Control-Allow-Origin is omitted → browser blocks.
 *
 * Always sets:
 *   Access-Control-Allow-Methods (POST + GET + OPTIONS by default)
 *   Access-Control-Allow-Headers (Content-Type + Authorization)
 *   Vary: Origin                  (important — CDN caches per-origin response)
 *
 * Override per-endpoint:
 *   buildAdminCors(req, { methods: 'POST, GET, DELETE, OPTIONS' })
 *
 * Note: public endpoints (createPaypalOrder, applyPromoCode, ai-planner-*)
 * intentionally keep wildcard CORS — they're meant to be callable from
 * embedded widgets / partner sites. Only admin-* + cron + webhook need
 * this lockdown.
 */

const STATIC_ALLOWED_ORIGINS = Object.freeze([
  'https://cocotripkr.com',
  'https://www.cocotripkr.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5174', // playwright preview
]);

// Vercel preview hosts: cocotrip-source*.vercel.app
const VERCEL_PREVIEW_RE = /^https:\/\/cocotrip-source[-\w.]*\.vercel\.app$/;

/**
 * @param {string} origin
 * @returns {boolean}
 */
export function isAdminCorsOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return false;
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
  if (VERCEL_PREVIEW_RE.test(origin)) return true;
  return false;
}

/**
 * Build CORS headers for an admin endpoint based on request Origin.
 * Always include Vary: Origin so caching tier doesn't pin one origin's
 * response to other origins.
 *
 * @param {import('http').IncomingMessage} req
 * @param {object} [opts]
 * @param {string} [opts.methods='POST, GET, OPTIONS']
 * @param {string} [opts.headers='Content-Type, Authorization']
 * @returns {Record<string, string>}
 */
export function buildAdminCors(req, opts = {}) {
  const methods = opts.methods || 'POST, GET, OPTIONS';
  const headers = opts.headers || 'Content-Type, Authorization';

  const origin = req?.headers?.origin || req?.headers?.Origin || '';
  const out = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': headers,
    'Vary': 'Origin',
  };
  if (isAdminCorsOriginAllowed(origin)) {
    out['Access-Control-Allow-Origin'] = origin;
  }
  // else: omit Allow-Origin → browser blocks the response.
  return out;
}

/**
 * Convenience: adminCors + Content-Type: application/json in one object.
 * Most admin endpoints respond with JSON, so this saves spreading at every
 * writeHead callsite.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{methods?: string, headers?: string}} [opts]
 * @returns {Record<string, string>}
 */
export function buildAdminJsonCors(req, opts = {}) {
  return { ...buildAdminCors(req, opts), 'Content-Type': 'application/json' };
}

export default buildAdminCors;
