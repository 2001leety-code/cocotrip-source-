const REPOSITORY = '2001leety-code/cocotrip-source-';
// Confirmed from this project's successful GitHub Preview deployment metadata.
const PREVIEW_HOST = /^cocotrip-source2026-[a-z0-9]+-2001leety-3613s-projects\.vercel\.app$/;
const ROUTES = ['/', '/tours', '/charter'];

function fail() {
  throw new Error('LHCI_PREVIEW_AUTH_REJECTED');
}

function previewOrigin(value) {
  if (typeof value !== 'string' || /[\\\s]/.test(value)) return fail();
  let parsed;
  try { parsed = new URL(value); } catch { return fail(); }
  if (parsed.protocol !== 'https:' || !PREVIEW_HOST.test(parsed.hostname) || parsed.port
    || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return fail();
  return parsed.origin;
}

function validatePreviewDeployment({ repository, deployment, status, pullRequests }) {
  const isVercel = (creator) => creator?.login === 'vercel[bot]' && creator?.type === 'Bot';
  if (repository?.full_name !== REPOSITORY || repository.fork !== false || repository.default_branch !== 'main'
    || !Number.isSafeInteger(deployment?.id) || deployment.id <= 0
    || !/^[0-9a-f]{40}$/.test(deployment.sha || '') || !isVercel(deployment.creator)
    || deployment.environment !== 'Preview' || deployment.production_environment !== false
    || status?.state !== 'success' || status.environment !== 'Preview' || !isVercel(status.creator)) return fail();
  const sameRepositoryHead = Array.isArray(pullRequests) && pullRequests.some((pr) =>
    pr.head?.sha === deployment.sha && pr.head.repo?.full_name === REPOSITORY && pr.head.repo.fork === false
    && pr.base?.repo?.full_name === REPOSITORY && pr.base.ref === repository.default_branch);
  if (!sameRepositoryHead) return fail();
  return { origin: previewOrigin(status.target_url), sha: deployment.sha };
}

function cookieForPreview(raw, origin) {
  if (typeof raw !== 'string' || /[\r\n]/.test(raw)) return null;
  const [pair, ...parts] = raw.split(';');
  const equals = pair.indexOf('=');
  const name = pair.slice(0, equals).trim();
  const value = pair.slice(equals + 1).trim();
  if (equals <= 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    || !value || /[;,"\\]/.test(value)
    || Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) >= 127)) return null;
  const attributes = new Map(parts.map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key.toLowerCase(), rest.join('=')];
  }));
  const host = new URL(origin).hostname;
  const domain = attributes.get('domain');
  if (!attributes.has('secure') || !attributes.has('httponly')
    || (domain && domain.replace(/^\./, '').toLowerCase() !== host)
    || (attributes.has('path') && attributes.get('path') !== '/')) return null;
  const sameSites = new Map([['lax', 'Lax'], ['strict', 'Strict'], ['none', 'None']]);
  const sameSite = sameSites.get((attributes.get('samesite') || 'lax').toLowerCase());
  if (!sameSite) return null;
  const cookie = { name, value, url: origin + '/', path: '/', httpOnly: true, secure: true, sameSite };
  // Ephemeral browser session: do not extend the server's expiration.
  if (attributes.has('max-age')) {
    const age = Number(attributes.get('max-age'));
    if (!Number.isFinite(age) || age <= 0) return null;
    cookie.expires = Math.floor(Date.now() / 1000) + age;
  } else if (attributes.has('expires')) {
    const expires = Date.parse(attributes.get('expires')) / 1000;
    if (!Number.isFinite(expires) || expires <= Date.now() / 1000) return null;
    cookie.expires = expires;
  }
  return cookie;
}

/**
 * LHCI calls this before each measured URL. Only a Node-side, redirect:manual GET
 * receives the bypass headers. No secret-bearing URL or browser request exists.
 * Vercel's cookie redirect is consumed without following it; HttpOnly/Secure,
 * exact-host cookies are installed in the same ephemeral browser Lighthouse uses.
 * https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
 */
async function authenticatePreview(browser, { url }, { env = process.env, fetch = globalThis.fetch } = {}) {
  let page;
  let response;
  try {
    const origin = previewOrigin(env.LHCI_PREVIEW_ORIGIN);
    if (!ROUTES.some((pathname) => url === origin + pathname)) return fail();
    const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (typeof secret !== 'string' || !secret.trim() || /[\r\n]/.test(secret)) return fail();
    const bootstrap = origin + '/robots.txt';
    response = await fetch(bootstrap, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' },
    });
    const location = response.headers.get('location');
    if (![302, 303, 307, 308].includes(response.status) || !location
      || new URL(location, bootstrap).href !== bootstrap) return fail();
    const cookies = response.headers.getSetCookie().map((raw) => cookieForPreview(raw, origin)).filter(Boolean);
    if (!cookies.length || new Set(cookies.map((cookie) => cookie.name)).size !== cookies.length) return fail();
    page = await browser.newPage();
    await page.setCookie(...cookies);
    const installed = await page.cookies(origin + '/');
    const host = new URL(origin).hostname;
    if (!cookies.every((expected) => installed.some((cookie) => cookie.name === expected.name
      && cookie.value === expected.value && cookie.httpOnly && cookie.secure && cookie.path === '/'
      && cookie.domain.replace(/^\./, '') === host))) return fail();
  } catch {
    // Fetch/Puppeteer errors may include credentials or redirect query strings.
    return fail();
  } finally {
    if (response?.body) await response.body.cancel().catch(() => undefined);
    if (page) await page.close().catch(() => undefined);
  }
}

module.exports = authenticatePreview;
module.exports.validatePreviewDeployment = validatePreviewDeployment;
