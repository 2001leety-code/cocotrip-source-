/**
 * PR #421 — Audit CZ2 regression slot.
 *
 * Asserts api/_shared/escape.js correctly neutralises HTML/Telegram-HTML
 * special characters, AND that the email confirmation HTML actually
 * invokes the helpers (so a future refactor can't accidentally drop them
 * while keeping the helper file).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeHtml, escapeAttr, escapeTelegram } from '../../api/_shared/escape.js';

describe('PR #421 — escapeHtml helper', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>`))
      .toBe('&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;');
    expect(escapeHtml('A & B'))
      .toBe('A &amp; B');
  });

  it('coerces null/undefined/number to empty/string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(42)).toBe('42');
  });

  it('escapeAttr is identical to escapeHtml', () => {
    const payload = `"><script>x</script>`;
    expect(escapeAttr(payload)).toBe(escapeHtml(payload));
  });

  it('escapeTelegram leaves quotes alone (Telegram HTML parse mode)', () => {
    // Telegram parse_mode=HTML only respects < > & — quotes are literal.
    expect(escapeTelegram(`<b>"hi"</b>`)).toBe(`&lt;b&gt;"hi"&lt;/b&gt;`);
  });
});

describe('PR #421 — _send-email.js uses escapeHtml on user-controlled fields', () => {
  const emailSrc = readFileSync(
    resolve(process.cwd(), 'api/_send-email.js'),
    'utf8',
  );

  const FIELDS = [
    'booking.customerName',
    'booking.product',
    'booking.tourDate',
    'booking.pickupLocation',
    'booking.paxCount',
    'booking.amountUSD',
  ];

  for (const field of FIELDS) {
    it(`escapes ${field}`, () => {
      // Each user-controlled field must appear inside escapeHtml(...) at
      // least once. We don't enforce "every occurrence" — some are inside
      // text/plain blocks where escape isn't needed — but at least one
      // HTML-context occurrence must be wrapped.
      const escapedRe = new RegExp(
        `escapeHtml\\([^)]*${field.replace('.', '\\.')}`,
      );
      expect(emailSrc, `${field} must appear inside escapeHtml() at least once`)
        .toMatch(escapedRe);
    });
  }

  it('imports the helpers from the shared module', () => {
    expect(emailSrc).toMatch(/from\s+['"]\.\/_shared\/escape\.js['"]/);
    expect(emailSrc).toMatch(/escapeHtml/);
    expect(emailSrc).toMatch(/escapeAttr/);
  });

  it('walletUrl is escaped as an attribute (defensive)', () => {
    expect(emailSrc).toMatch(/escapeAttr\(walletUrl\)/);
  });
});

describe('PR #421 — escapeHtml dedup (no duplicate definitions)', () => {
  function loadIfExists(rel: string): string {
    try {
      return readFileSync(resolve(process.cwd(), rel), 'utf8');
    } catch {
      return '';
    }
  }

  it('api/pdf/generate.js imports escapeHtml instead of redefining', () => {
    const src = loadIfExists('api/pdf/generate.js');
    if (!src) return; // Skip if file moved.
    // Should not have its own function declaration.
    expect(src).not.toMatch(/^function escapeHtml\s*\(/m);
    expect(src).toMatch(/from\s+['"]\.\.\/_shared\/escape\.js['"]/);
  });

  it('api/_shared/telegram-throttle.js imports escapeHtml instead of redefining', () => {
    const src = loadIfExists('api/_shared/telegram-throttle.js');
    if (!src) return;
    expect(src).not.toMatch(/^function escapeHtml\s*\(/m);
    expect(src).toMatch(/from\s+['"]\.\/escape\.js['"]/);
  });
});
