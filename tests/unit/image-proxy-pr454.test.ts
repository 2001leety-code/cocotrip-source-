/**
 * PR #454 — Audit Z-H11 regression slot.
 *
 * Pre-fix: src/pages/PlanDetailPage/pdfGenerator.ts had Phase 2 image
 * preload that fetched every <img>.src directly. Tripadvisor / Google
 * Places / Instagram / Facebook CDNs serve images WITHOUT a permissive
 * CORS header, so:
 *
 *   fetch(src, { mode: 'cors' })
 *   // → CORS error → fall through to catch → image stays at its
 *   //   original cross-origin src → html2canvas can't read pixels →
 *   //   blank box in the PDF
 *
 * Post-fix: pdfGenerator now routes cross-origin image sources through
 * /api/image-proxy?url=… which fetches server-side (no CORS) and
 * returns the bytes with Access-Control-Allow-Origin: *. The proxy is
 * SSRF-defended by a host allowlist + http(s)-only protocol gate +
 * IP-literal rejection + 5 MB cap + 10s timeout.
 *
 * This test asserts:
 *   (a) the allowlist correctly accepts the intended hosts and rejects
 *       arbitrary / private-IP / non-http URLs
 *   (b) the pdfGenerator wire-up routes external origins to the proxy
 *       and leaves same-origin / data: URLs untouched
 *   (c) the proxy emits the headers html2canvas needs and the security
 *       hardening headers it should
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { __internals as proxyInternals } from '../../api/image-proxy.js';

const proxySrc = readFileSync(
  resolve(process.cwd(), 'api/image-proxy.js'),
  'utf8',
);
const pdfGenSrc = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
  'utf8',
);

describe('PR #454 Z-H11 — SSRF-defended allowlist', () => {
  const isAllowed = proxyInternals.isAllowedUrl;

  it('accepts the intended CDN hosts', () => {
    expect(isAllowed('https://www.tripadvisor.com/foo.jpg')).toBe(true);
    expect(isAllowed('https://media-cdn.tripadvisor.com/photo.jpg')).toBe(true);
    expect(isAllowed('https://dynamic-media-cdn.tacdn.com/x.jpg')).toBe(true);
    expect(isAllowed('https://lh3.googleusercontent.com/aaa')).toBe(true);
    expect(isAllowed('https://maps.googleapis.com/maps/api/photo')).toBe(true);
    expect(isAllowed('https://cocotripkr.com/static/foo.png')).toBe(true);
  });

  it('rejects arbitrary external hosts (SSRF base case)', () => {
    expect(isAllowed('https://evil.example.com/leak.png')).toBe(false);
    expect(isAllowed('https://attacker.tripadvisor.com.evil.com/x.png')).toBe(false);
    expect(isAllowed('https://my.aws-internal/secret')).toBe(false);
  });

  it('rejects non-http protocols', () => {
    expect(isAllowed('file:///etc/passwd')).toBe(false);
    expect(isAllowed('gopher://internal/')).toBe(false);
    expect(isAllowed('javascript:alert(1)')).toBe(false);
  });

  it('rejects IP-literal hosts (private-range bypass)', () => {
    expect(isAllowed('http://127.0.0.1/')).toBe(false);
    expect(isAllowed('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowed('http://10.0.0.1/')).toBe(false);
    expect(isAllowed('http://192.168.1.1/')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isAllowed('')).toBe(false);
    expect(isAllowed('not-a-url')).toBe(false);
    expect(isAllowed('https://')).toBe(false);
  });

  it('rejects URLs with port (IPv6-bracket bypass attempt approximation)', () => {
    // The current implementation rejects hostname containing ':' which
    // covers IPv6-literals in URLs of the form http://[::1]/. We assert
    // that behavior to prevent regression.
    expect(isAllowed('http://[::1]/')).toBe(false);
  });
});

describe('PR #454 Z-H11 — proxy response shape', () => {
  it('hardcodes 5 MB cap + 10s timeout (sane defaults)', () => {
    expect(proxyInternals.MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(proxyInternals.FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it('only allows http/https schemes', () => {
    expect(proxyInternals.ALLOWED_PROTOCOLS.has('http:')).toBe(true);
    expect(proxyInternals.ALLOWED_PROTOCOLS.has('https:')).toBe(true);
    expect(proxyInternals.ALLOWED_PROTOCOLS.has('file:')).toBe(false);
  });

  it('sets the headers html2canvas needs to read pixels', () => {
    // Access-Control-Allow-Origin: * lets html2canvas tainted-canvas-free.
    expect(proxySrc).toMatch(/'Access-Control-Allow-Origin':\s*'\*'/);
  });

  it('sets long-lived caching for stable CDN images', () => {
    expect(proxySrc).toMatch(/'Cache-Control':\s*'public,\s*max-age=86400/);
  });

  it('sets X-Content-Type-Options: nosniff (MIME confusion guard)', () => {
    expect(proxySrc).toMatch(/'X-Content-Type-Options':\s*'nosniff'/);
  });

  it('rejects non-image upstream content-type (415)', () => {
    expect(proxySrc).toMatch(/415/);
    expect(proxySrc).toMatch(/unsupported content-type/);
  });

  it('does NOT forward client cookies or auth headers (anonymous proxy)', () => {
    // The fetch call body must not include `credentials: 'include'` and
    // must not forward Cookie / Authorization. Easiest signal: the only
    // header we set is User-Agent.
    expect(proxySrc).toMatch(/headers:\s*\{\s*'User-Agent':[^}]*\}/);
    expect(proxySrc).not.toMatch(/credentials:\s*['"]include['"]/);
  });
});

describe('PR #454 Z-H11 — pdfGenerator wire-up', () => {
  it('hoists toFetchableUrl helper', () => {
    expect(pdfGenSrc).toMatch(/const\s+toFetchableUrl\s*=\s*\(\s*src:\s*string\s*\)/);
  });

  it('keeps same-origin + data: + blob: untouched', () => {
    // The helper short-circuits these in pdfGenerator
    expect(pdfGenSrc).toMatch(/data:|blob:/);
    expect(pdfGenSrc).toMatch(/u\.origin\s*===\s*sameOrigin/);
  });

  it('routes external origins through /api/image-proxy?url=', () => {
    expect(pdfGenSrc).toMatch(/\/api\/image-proxy\?url=\$\{encodeURIComponent/);
  });

  it('uses the proxied URL in fetch (not raw src)', () => {
    expect(pdfGenSrc).toMatch(/await\s+fetch\(\s*fetchUrl\s*,/);
  });

  it('warn log still references the original src + the proxied URL (debuggability)', () => {
    expect(pdfGenSrc).toMatch(/\[PDF\]\s*image preload failed[\s\S]*src,\s*'\(fetch via',\s*fetchUrl/);
  });
});
