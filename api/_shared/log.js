// Lightweight logging facade for api/* routes.
//
// Why: 231 console.* calls across 50 files mix verbose diagnostics with
// production-relevant warnings. logger.debug() lets us silence chatty traces
// in prod (NODE_ENV='production') while keeping info/warn/error visible.
//
// Migration policy:
// - Progress traces, ENV checks, timing measurements → logger.debug
// - User-impacting events ("AVOID list applied", "PayPal mode") → logger.info
// - Recoverable issues (best-effort fallback fired) → logger.warn
// - Failures users care about (PayPal auth fail, Firestore write reject) → logger.error
//
// The 4 levels map to console.* so existing log scrapers keep working. Only
// debug is environment-gated; everything else mirrors current behavior.

const isProduction = process.env.NODE_ENV === 'production';

export const logger = {
  /** Verbose diagnostics — silenced in prod */
  debug: (...args) => {
    if (!isProduction) console.log(...args);
  },
  /** User-impacting events worth keeping in prod */
  info: (...args) => console.log(...args),
  /** Recoverable issues; investigate when frequent */
  warn: (...args) => console.warn(...args),
  /** Failures requiring action */
  error: (...args) => console.error(...args),
};
