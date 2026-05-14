/**
 * PR #424 — Audit CZ5 regression slot.
 *
 * Before this PR, api/_generate-voucher.js used PDFKit + Helvetica + a
 * `safeText()` function that stripped every non-Latin character to `?`.
 * Korean / Japanese / Chinese tourists got vouchers with `???` instead of
 * their name, pickup address, etc.
 *
 * Static check (no live Chromium spin-up): assert the module pivots to
 * the Puppeteer + @sparticuz/chromium pipeline and that the lossy
 * Latin-only `safeText()` filter is gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_generate-voucher.js'),
  'utf8',
);

describe('PR #424 — voucher CJK rendering', () => {
  it('no longer strips non-Latin characters with safeText()', () => {
    // `safeText` was the bug — it converted Hangul/Kanji/Hanzi to `?`.
    expect(src).not.toMatch(/function\s+safeText\s*\(/);
    expect(src).not.toMatch(/\[\^\\x20-\\x7E.*\]/);
  });

  it('uses puppeteer-core + @sparticuz/chromium (CJK-capable system fonts)', () => {
    expect(src).toMatch(/from\s+['"]puppeteer-core['"]/);
    expect(src).toMatch(/from\s+['"]@sparticuz\/chromium['"]/);
  });

  it('font stack includes Korean/CJK fallbacks for the HTML template', () => {
    // Sanity check that we set a CJK-friendly font-family — system Chromium
    // ships Noto CJK as the canonical fallback.
    expect(src).toMatch(/Noto Sans (KR|CJK KR)/);
  });

  it('reuses the PR #421 escape helpers so user input is safe', () => {
    expect(src).toMatch(/from\s+['"]\.\/_shared\/escape\.js['"]/);
    expect(src).toMatch(/escapeHtml/);
  });

  it('keeps the public function signature so booking-processor / voucher.js still work', () => {
    expect(src).toMatch(/export\s+async\s+function\s+generateVoucherPDF\s*\(\s*booking\s*\)/);
    expect(src).toMatch(/export\s+default\s*\{\s*generateVoucherPDF\s*\}/);
  });

  it('voucher.js bumps maxDuration to accommodate Puppeteer cold-start', () => {
    const voucherSrc = readFileSync(
      resolve(process.cwd(), 'api/voucher.js'),
      'utf8',
    );
    expect(voucherSrc).toMatch(/maxDuration\s*:\s*(2[5-9]|[3-9]\d|\d{3,})/);
  });
});
