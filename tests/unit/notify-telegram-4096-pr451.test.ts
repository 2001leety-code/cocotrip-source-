/**
 * PR #451 — Audit Z-H13 regression slot.
 *
 * Pre-fix: api/_shared/notify.js forwarded `text` unchanged to
 * Telegram's sendMessage. Telegram hard-caps that field at 4096 chars
 * and rejects oversized payloads with "MESSAGE_TOO_LONG". Our notify()
 * returned `{ ok: false, error }` for that case — but every caller
 * fire-and-forget'd the result via `.catch(() => {})`, so the alert
 * was silently dropped. Long booking memos / operator instructions
 * silently vanished.
 *
 * Post-fix: notify() now passes text through safeTruncateForTelegram
 * which trims oversized text at the last newline boundary under the
 * 4090-char safe limit and appends a "…(truncated, full text in
 * error_log)" pointer. The pointer references the error_log
 * collection (already maintained by P67 throttledTelegramAlert) where
 * the operator can recover the full original text. Return shape gains
 * a `truncated: boolean` flag so callers can surface it if needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_shared/notify.js'),
  'utf8',
);

import {
  safeTruncateForTelegram,
} from '../../api/_shared/notify.js';

describe('PR #451 Z-H13 — safeTruncateForTelegram behavior', () => {
  it('short text (≤4096) passes through untouched', () => {
    const r = safeTruncateForTelegram('hello\nworld');
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('hello\nworld');
  });

  it('exactly 4096-char text passes through (boundary)', () => {
    const exact = 'x'.repeat(4096);
    const r = safeTruncateForTelegram(exact);
    expect(r.truncated).toBe(false);
    expect(r.text.length).toBe(4096);
  });

  it('text longer than 4096 chars is truncated with suffix', () => {
    const long = 'x'.repeat(5000);
    const r = safeTruncateForTelegram(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(4096);
    expect(r.text).toMatch(/…\(truncated/);
    expect(r.originalLength).toBe(5000);
  });

  it('prefers newline boundary when one exists in the safe window', () => {
    // 4000 chars of 'a', then \n, then 1500 chars of 'b'
    const left = 'a'.repeat(4000);
    const right = 'b'.repeat(1500);
    const r = safeTruncateForTelegram(`${left}\n${right}`);
    expect(r.truncated).toBe(true);
    // The cut should fall at the \n so we don't see any 'b' before the suffix.
    expect(r.text).not.toMatch(/b/);
    expect(r.text.endsWith('…(truncated, full text in error_log)')).toBe(true);
  });

  it('falls back to hard cut when no newline is in the safe window', () => {
    const blob = 'x'.repeat(10000); // single line, no \n
    const r = safeTruncateForTelegram(blob);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(4096);
    expect(r.text).toMatch(/…\(truncated/);
  });

  it('handles non-string input defensively', () => {
    expect(safeTruncateForTelegram(undefined as unknown as string).truncated).toBe(false);
    expect(safeTruncateForTelegram(null as unknown as string).truncated).toBe(false);
    expect(safeTruncateForTelegram(123 as unknown as string).text).toBe('123');
  });
});

describe('PR #451 Z-H13 — notify() wires the truncation', () => {
  it('imports the new safe-truncate (or defines it locally — at minimum source contains the constant)', () => {
    expect(src).toMatch(/TELEGRAM_TEXT_HARD_LIMIT\s*=\s*4096/);
    expect(src).toMatch(/TELEGRAM_TEXT_SAFE_LIMIT\s*=\s*4090/);
    expect(src).toMatch(/TRUNCATE_SUFFIX/);
  });

  it('safeTruncateForTelegram helper is exported (so callers can verify or pre-check)', () => {
    expect(src).toMatch(/export\s+function\s+safeTruncateForTelegram/);
  });

  it('notify() invokes safeTruncateForTelegram and uses the result as the body text', () => {
    expect(src).toMatch(/safeTruncateForTelegram\(\s*text\s*\)/);
    // sendMessage payload's text field uses the safeText, not the raw text.
    expect(src).toMatch(/text:\s*safeText/);
  });

  it('warn-logs when truncation actually fired', () => {
    expect(src).toMatch(/text truncated for Telegram 4096-cap/);
  });

  it('notify() return shape surfaces the truncated boolean for observability', () => {
    expect(src).toMatch(/return\s*\{\s*ok:\s*true[\s\S]*?truncated\s*\}/);
  });
});

describe('PR #451 Z-H13 — notifyLong is still available for explicit chunking', () => {
  it('notifyLong remains exported (callers that want full text in multiple messages still can)', () => {
    expect(src).toMatch(/export\s+async\s+function\s+notifyLong/);
  });
});

describe('PR #451 Z-H13 — fetch path actually receives the truncated text', async () => {
  // Smoke: monkey-patch fetch and call notify with oversized text.
  const _origFetch = global.fetch;
  const _origEnv = { ...process.env };

  afterEach(() => {
    global.fetch = _origFetch;
    process.env = _origEnv;
  });

  it('fetch body text length is <= 4096 even for oversized input', async () => {
    // Configure env so notify proceeds to fetch.
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = 'test-chat';

    let capturedBody: any = null;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }) as any;

    const { notify } = await import('../../api/_shared/notify.js');
    const huge = 'a'.repeat(10000);
    const r = await notify('error', huge);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(capturedBody).not.toBeNull();
    expect(typeof capturedBody.text).toBe('string');
    expect(capturedBody.text.length).toBeLessThanOrEqual(4096);
  });
});

// afterEach helper for the last describe; vitest auto-imports it via globals
// but we import explicitly for clarity.
import { afterEach } from 'vitest';
