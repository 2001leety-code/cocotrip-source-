/**
 * GET /api/image-proxy?url=<encoded>
 *
 * PR #454 (Audit Z-H11 — 2026-05-16). Server-side image fetch proxy so
 * the PDF generator's html2canvas pre-loader can base64-inline images
 * from CDNs that don't send CORS headers (Tripadvisor, Google Places,
 * etc.). Without this, the Phase 2 preload in
 * src/pages/PlanDetailPage/pdfGenerator.ts hits CORS errors, falls
 * back silently, and the PDF renders blank boxes where Tripadvisor /
 * Google place photos should be.
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
  'googleusercontent.com',  // Google Places photo CDN
  'maps.googleapis.com',
  'gstatic.com',            // Google static assets
  'cocotripkr.com',
  'vercel.app',             // preview / prod
  'cloudflare.com',         // some CDN'd assets
  'cdninstagram.com',       // user-provided photos
  'fbcdn.net',
];

// SSRF allow only http/https schemes.
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Max bytes — protects against operator-burning images.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 10_000;

function isAllowedUrl(target) {
  try {
    const u = new URL(target);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return false;
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
    console.warn('[image-proxy] blocked non-allowlisted URL:', target.slice(0, 200));
    return send(res, 403, 'host not on allowlist');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      // Don't forward client cookies/auth — proxy must be anonymous.
      headers: { 'User-Agent': 'CocoTripKR-PDF-ImageProxy/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timeoutId);

    if (!upstream.ok) {
      console.warn('[image-proxy] upstream non-2xx:', upstream.status, target.slice(0, 200));
      return send(res, upstream.status, `upstream ${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    // Sanity: must be an image.
    if (!contentType.startsWith('image/')) {
      console.warn('[image-proxy] non-image content-type:', contentType, target.slice(0, 200));
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
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? `timeout-${FETCH_TIMEOUT_MS}ms` : err.message;
    console.warn('[image-proxy] fetch failed:', reason, target.slice(0, 200));
    return send(res, 502, `proxy fetch failed: ${reason}`);
  }
}

// Export internals for unit tests.
export const __internals = {
  isAllowedUrl,
  ALLOWED_HOST_SUFFIXES,
  ALLOWED_PROTOCOLS,
  MAX_BYTES,
  FETCH_TIMEOUT_MS,
};
