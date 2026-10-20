/**
 * Customer routes that wear the approved v3 night look (src/styles/customer-night.css).
 *
 * Allow-list on purpose: admin, /mood, DEV harnesses (/dev, /preview) and
 * /charter-legacy never match, so they keep their own surfaces. Prefix entries
 * match the exact path or a `/`-separated child only — `/charter` does not
 * match `/charter-legacy`.
 */
const CUSTOMER_NIGHT_PREFIXES = [
  '/region',
  '/map',
  '/assistant',
  '/charter',
  '/planner',
  '/tours',
  '/links',
  '/whatsapp-support',
  '/community',
  '/guide',
  '/about',
  '/terms',
  '/privacy',
  '/account-deletion',
  '/travel-terms',
  '/mypage',
  '/my-plans',
  '/s',
] as const;

export function isCustomerNightPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return CUSTOMER_NIGHT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Routes that wear Home's own chrome (header/menu/footer from home-dope.css):
 * Home and the exact Planner entry only. `/planner/share/*` and every other
 * night route keep the shared night shell.
 */
export function isHomeChromePath(pathname: string): boolean {
  return pathname === '/' || pathname === '/planner';
}
