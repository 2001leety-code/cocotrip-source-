/**
 * PR #452 — Audit Z-H9 regression slot.
 *
 * Pre-fix: api/booking-processor.js used `parseFloat(amount || 0)` in
 * three places:
 *   1. amountKRW = Math.round(parseFloat(amount || 0) * exchangeRate)
 *   2. amountUSD: parseFloat(amount || 0).toFixed(2)
 *   3. amountNum = parseFloat(amount) || 0     (loyalty earn)
 *
 * For amount values like 'abc' the OR-default catches null/undefined/''
 * but NOT NaN strings — parseFloat('abc') = NaN propagates:
 *   amountKRW = Math.round(NaN * rate) = NaN
 *   amountUSD = 'NaN'
 *   amountNum (= NaN || 0) = 0 → loyalty earn silently no-ops
 *
 * Sheets / customer confirm email / voucher PDF all then showed $NaN
 * or $0; the user lost loyalty points with no signal.
 *
 * Post-fix: api/_shared/amount-guard.js exposes safeParseAmountUSD()
 * which:
 *   - returns { value, invalid, raw }
 *   - value is a safe number (0 on invalid)
 *   - invalid is true when the input can't represent a non-negative
 *     finite number
 *   - never throws (caller picks the policy)
 *
 * booking-processor calls the guard once at entry; on `invalid` it
 * fires throttledTelegramAlert (severity=critical, key='booking-
 * amount-nan') with the orderID, bookingRef, and raw input so the
 * operator can run /api/admin-update-booking. Booking is NOT blocked
 * (same posture as PR #444 / P68 — money or downstream state is
 * preserved; operator recovers).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { safeParseAmountUSD } from '../../api/_shared/amount-guard.js';

const procSrc = readFileSync(
  resolve(process.cwd(), 'api/booking-processor.js'),
  'utf8',
);
const helperSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/amount-guard.js'),
  'utf8',
);

describe('PR #452 Z-H9 — safeParseAmountUSD behavior', () => {
  it('returns {value: 0, invalid: false} for null/undefined/empty (legitimate zero)', () => {
    for (const input of [null, undefined, '']) {
      const r = safeParseAmountUSD(input as any);
      expect(r.value).toBe(0);
      expect(r.invalid).toBe(false);
    }
  });

  it('parses valid number strings', () => {
    const r = safeParseAmountUSD('123.45');
    expect(r.value).toBe(123.45);
    expect(r.invalid).toBe(false);
  });

  it('parses valid numeric inputs', () => {
    const r = safeParseAmountUSD(99.99);
    expect(r.value).toBe(99.99);
    expect(r.invalid).toBe(false);
  });

  it('flags NaN-producing strings as invalid + returns 0', () => {
    for (const input of ['abc', 'xyz', 'NaN', '12.34.56']) {
      const r = safeParseAmountUSD(input);
      expect(r.invalid, `expected ${JSON.stringify(input)} invalid`).toBe(true);
      expect(r.value).toBe(0);
      expect(r.raw).toBe(input);
    }
  });

  it('flags Infinity / negative numbers as invalid', () => {
    expect(safeParseAmountUSD(Infinity).invalid).toBe(true);
    expect(safeParseAmountUSD(-1).invalid).toBe(true);
    expect(safeParseAmountUSD('-5').invalid).toBe(true);
  });

  it('does NOT throw on object / array / symbol inputs', () => {
    expect(() => safeParseAmountUSD({} as any)).not.toThrow();
    expect(() => safeParseAmountUSD([] as any)).not.toThrow();
    expect(safeParseAmountUSD({} as any).invalid).toBe(true);
  });
});

describe('PR #452 Z-H9 — booking-processor wires the guard', () => {
  it('imports safeParseAmountUSD from the shared helper', () => {
    expect(procSrc).toMatch(
      /import\s*\{[^}]*safeParseAmountUSD[^}]*\}\s*from\s*['"]\.\/_shared\/amount-guard\.js['"]/,
    );
  });

  it('replaces parseFloat(amount || 0) at the entry path', () => {
    expect(procSrc).toMatch(/safeParseAmountUSD\(\s*amount\s*\)/);
    // The KRW conversion + booking record + loyalty earn must use the safe value.
    expect(procSrc).toMatch(/amountUSDSafe/);
    // amountKRW computed from amountUSDSafe (NOT from raw amount).
    expect(procSrc).toMatch(/Math\.round\(\s*amountUSDSafe\s*\*\s*exchangeRate\s*\)/);
    // booking record's amountUSD field uses the safe value.
    expect(procSrc).toMatch(/amountUSD:\s*amountUSDSafe\.toFixed\(2\)/);
  });

  // 🔴 2026-07-29 갱신: 적립 금액의 출처가 요청값에서 **검증된 결제 기록**으로 바뀌었다.
  //   이전 규칙(amountNum = amountUSDSafe)은 "요청 금액을 안전 파싱해서 쓴다" 였는데,
  //   그 요청 자체를 외부에서 위조할 수 있었다(booking-processor 무인증 P0).
  //   이제 booking-processor 는 bookings/{orderID} 의 검증된 amountUSD 만 쓴다 — 더 강한 규칙.
  it('적립 금액은 요청이 아니라 검증된 결제 기록에서 온다', () => {
    expect(procSrc).toMatch(/const\s+amountNum\s*=\s*ledger\.ok\s*\?\s*ledger\.amountUSD/);
    // 요청 금액을 직접 파싱해 적립하던 형태는 되살아나면 안 된다.
    expect(procSrc).not.toMatch(/const\s+amountNum\s*=\s*parseFloat\(\s*amount\s*\)\s*\|\|\s*0/);
    expect(procSrc).not.toMatch(/const\s+amountNum\s*=\s*amountUSDSafe/);
  });

  it('amountUSDSafe 는 여전히 시트·이메일·바우처 표시에 쓰인다 (NaN 가드 유지)', () => {
    expect(procSrc).toMatch(/amountUSDSafe/);
  });

  it('fires throttledTelegramAlert on invalid amount (operator visibility)', () => {
    expect(procSrc).toMatch(/key:\s*['"]booking-amount-nan['"]/);
    expect(procSrc).toMatch(/severity:\s*['"]critical['"]/);
    // Alert message must include the raw amount + recovery hint
    const alertIdx = procSrc.indexOf("'booking-amount-nan'");
    expect(alertIdx).toBeGreaterThan(-1);
    const block = procSrc.slice(alertIdx - 400, alertIdx + 1500);
    expect(block).toMatch(/Raw amount/);
    expect(block).toMatch(/admin-update-booking/);
  });

  it('regression guard: no more parseFloat(amount || 0) at the entry path', () => {
    // The original two callsites used `parseFloat(amount || 0)`. After
    // the fix both should be replaced — search globally.
    expect(procSrc).not.toMatch(/parseFloat\(\s*amount\s*\|\|\s*0\s*\)/);
  });
});

describe('PR #452 Z-H9 — helper file shape', () => {
  it('exports safeParseAmountUSD', () => {
    expect(helperSrc).toMatch(/export\s+function\s+safeParseAmountUSD/);
  });

  it('uses Number.isFinite to gate validity (the real fix vs OR-default)', () => {
    expect(helperSrc).toMatch(/Number\.isFinite/);
  });

  it('rejects negatives explicitly', () => {
    expect(helperSrc).toMatch(/n\s*<\s*0/);
  });
});
