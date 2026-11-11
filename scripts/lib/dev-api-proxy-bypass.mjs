// Local Vite dev/preview only. Never proxy coupon issuance, coupon recovery or promo-config writes to production.
// Local usage contract: onboarding-coupons and admin-promo-config return 404, not proxy through.
// Read-only GET /api/promo-config still proxies (every local page reads it).
// Returning false is Vite's documented local 404 path, before proxy.web().
const BLOCKED_API = /^\/api\/(admin-coupon-fix|admin-issue-onboarding-coupons|admin-promo-config|onboarding-coupons)(?![a-z0-9-])/i;

export function devApiProxyBypass(req) {
  const raw = String(req.url || '');
  let decoded = raw.split(/[?#]/, 1)[0];
  try {
    for (let i = 0; i < 3 && decoded.includes('%'); i++) decoded = decodeURIComponent(decoded);
    // Ambiguous/invalid path encodings fail closed rather than reaching production.
    if (decoded.includes('%')) return false;
    const pathname = new URL(decoded.replace(/\\/g, '/'), 'http://dev.invalid').pathname.replace(/\/{2,}/g, '/');
    // Any character after the name that is not a letter, digit or hyphen ("/", ".", ";", end) is the same endpoint.
    if (BLOCKED_API.test(pathname)) return false;
  } catch {
    return false;
  }
  // Preserve local serving of source modules used by the browser build.
  return /^\/api\/_shared\/[^?]+\.js(\?|$)/.test(raw) ? raw : undefined;
}
