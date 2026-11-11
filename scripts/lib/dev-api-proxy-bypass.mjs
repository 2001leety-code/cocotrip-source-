// Vite development only. Never proxy coupon recovery to the production server.
// Returning false is Vite's documented local 404 path, before proxy.web().
export function devApiProxyBypass(req) {
  const raw = String(req.url || '');
  let decoded = raw.split(/[?#]/, 1)[0];
  try {
    for (let i = 0; i < 3 && decoded.includes('%'); i++) decoded = decodeURIComponent(decoded);
    // Ambiguous/invalid path encodings fail closed rather than reaching production.
    if (decoded.includes('%')) return false;
    const pathname = new URL(decoded.replace(/\\/g, '/'), 'http://dev.invalid').pathname.replace(/\/{2,}/g, '/');
    if (/^\/api\/(admin-coupon-fix|admin-issue-onboarding-coupons)(\/|$)/i.test(pathname)) return false;
  } catch {
    return false;
  }
  // Preserve local serving of source modules used by the browser build.
  return /^\/api\/_shared\/[^?]+\.js(\?|$)/.test(raw) ? raw : undefined;
}
