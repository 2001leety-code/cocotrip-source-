/**
 * GET /api/image-proxy?url=<encoded>
 *
 * PR #454 (Audit Z-H11 — 2026-05-16). Server-side image fetch proxy so
 * the PDF generator's html2canvas pre-loader can base64-inline images
 * from approved CDNs that don't send CORS headers (for example,
 * Tripadvisor). Without this, the Phase 2 preload in
 * src/pages/PlanDetailPage/pdfGenerator.ts hits CORS errors, falls
 * back silently, and the PDF renders blank boxes where approved external
 * images should be.
 *
 * SSRF defense: hard allowlist of trusted image hosts. Any other host
 * → 403. Localhost / 169.254.x / private IPs are blocked by virtue of
 * not being on the allowlist.
 *
 * Caching: 24h Cache-Control header. CDN images are stable; the same
 * Tripadvisor photo URL returns the same bytes for months.
 */

import { Buffer } from 'buffer';

export const config = { runtime: 'nodejs' };
export const maxDuration = 15;

// SSRF allowlist — exact hosts + suffix matches.
const ALLOWED_HOST_SUFFIXES = [
  'tripadvisor.com',
  'tacdn.com',              // Tripadvisor's image CDN
  'googleusercontent.com',  // Google-hosted static/user image CDN
  'gstatic.com',            // Google static assets
  'cocotripkr.com',
  'cloudflare.com',         // some CDN'd assets
  'cdninstagram.com',       // user-provided photos
  'fbcdn.net',
];

// SSRF allow only http/https schemes.
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Max bytes — protects against operator-burning images.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_PROXY_PATHS = new Set(['/api/place-photo', '/api/image-proxy']);

function normalizedPathname(url) {
  let pathname = url.pathname;
  try {
    // 라우터가 percent-encoded 경로를 풀어 처리하는 경우까지 같은 정책을 적용한다.
    for (let pass = 0; pass < 3; pass += 1) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch {
    return null;
  }
  return (pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/').toLowerCase();
}

function isAllowedUrl(target) {
  try {
    const u = new URL(target);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return false;
    const pathname = normalizedPathname(u);
    if (!pathname || BLOCKED_PROXY_PATHS.has(pathname)) return false;
    const host = u.hostname.toLowerCase();
    // Reject IP-literal hosts to avoid private-range bypass.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return false;
    return ALLOWED_HOST_SUFFIXES.some((suffix) =>
      host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/** Query/fragment에는 API key나 토큰이 있을 수 있으므로 로그에는 origin+path만 남긴다. */
function redactUrlForLog(target) {
  try {
    const u = new URL(target);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

class ProxyPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProxyPolicyError';
    this.code = code;
  }
}

/**
 * fetch의 자동 redirect를 끄고 매 hop의 목적지를 다시 검사한다.
 * 허용된 Vercel/CDN URL이 Google Places 같은 차단 호스트로 넘기는 우회를 막는다.
 */
async function fetchWithValidatedRedirects(initialUrl, options) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedUrl(currentUrl)) throw new ProxyPolicyError('REDIRECT_HOST_BLOCKED');

    const response = await fetch(currentUrl, { ...options, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    if (!location) throw new ProxyPolicyError('REDIRECT_LOCATION_MISSING');
    if (redirectCount >= MAX_REDIRECTS) throw new ProxyPolicyError('TOO_MANY_REDIRECTS');

    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new ProxyPolicyError('REDIRECT_LOCATION_INVALID');
    }
  }

  throw new ProxyPolicyError('TOO_MANY_REDIRECTS');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  return res.end(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, 'GET only');
  }

  const target = String(req.query?.url || new URL(req.url, 'http://localhost').searchParams.get('url') || '');
  if (!target) return send(res, 400, 'url query required');

  if (!isAllowedUrl(target)) {
    console.warn('[image-proxy] blocked non-allowlisted URL:', redactUrlForLog(target));
    return send(res, 403, 'host not on allowlist');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const { response: upstream, finalUrl } = await fetchWithValidatedRedirects(target, {
      signal: controller.signal,
      // Don't forward client cookies/auth — proxy must be anonymous.
      headers: { 'User-Agent': 'CocoTripKR-PDF-ImageProxy/1.0' },
    });

    if (!upstream.ok) {
      console.warn('[image-proxy] upstream non-2xx:', upstream.status, redactUrlForLog(finalUrl));
      return send(res, upstream.status, `upstream ${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    // Sanity: must be an image.
    if (!contentType.startsWith('image/')) {
      console.warn('[image-proxy] non-image content-type:', contentType, redactUrlForLog(finalUrl));
      return send(res, 415, `unsupported content-type: ${contentType}`);
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return send(res, 413, `image too large: ${arrayBuffer.byteLength} bytes`);
    }

    return send(res, 200, Buffer.from(arrayBuffer), {
      'Content-Type': contentType,
      // 24h CDN-side + browser cache. Image bytes for a given URL are
      // effectively immutable for the kind of CDN hosts we proxy.
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      // Hairnet against MIME confusion attacks.
      'X-Content-Type-Options': 'nosniff',
      // Allow same-origin html2canvas to read the pixels.
      'Access-Control-Allow-Origin': '*',
    });
  } catch (err) {
    if (err instanceof ProxyPolicyError) {
      console.warn('[image-proxy] redirect blocked:', err.code, redactUrlForLog(target));
      return send(res, 403, 'redirect target not allowed');
    }
    const reason = err?.name === 'AbortError' ? `timeout-${FETCH_TIMEOUT_MS}ms` : String(err?.name || 'FetchError');
    console.warn('[image-proxy] fetch failed:', reason, redactUrlForLog(target));
    return send(res, 502, `proxy fetch failed: ${reason}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Export internals for unit tests.
export const __internals = {
  isAllowedUrl,
  ALLOWED_HOST_SUFFIXES,
  ALLOWED_PROTOCOLS,
  MAX_BYTES,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  REDIRECT_STATUSES,
  BLOCKED_PROXY_PATHS,
  normalizedPathname,
  redactUrlForLog,
  fetchWithValidatedRedirects,
};
