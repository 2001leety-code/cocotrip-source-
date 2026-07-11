/**
 * PR-C 무료→유료 전환 집계 (api/_shared/funnel-conversion.js) — 회귀 가드.
 * 규칙: 이메일 연결·무료 플랜 "이후" 결제만·7/30일 윈도우·CONFIRMED만·
 *       채널=attribution.first.utm_source(없으면 direct)·이메일당 1회 카운트.
 */
import { describe, it, expect } from 'vitest';
import { computeFreeToPaidConversion } from '../../api/_shared/funnel-conversion.js';

const DAY = 24 * 3600 * 1000;
const T0 = Date.parse('2026-07-01T00:00:00Z');
const free = (email: string, ms = T0) => ({ email, createdAtMs: ms });
const booking = (email: string, daysAfter: number, over: Record<string, unknown> = {}) => ({
  userEmail: email, createdAtMs: T0 + daysAfter * DAY, productType: 'charter', ...over,
});

describe('computeFreeToPaidConversion', () => {
  it('7일 내 결제 = 7d+30d 둘 다, 20일 뒤 결제 = 30d 만', () => {
    const r = computeFreeToPaidConversion(
      [free('a@x.com'), free('b@x.com'), free('c@x.com')],
      [booking('a@x.com', 3), booking('b@x.com', 20)],
    );
    expect(r.freeUserBase).toBe(3);
    expect(r.converted7d).toBe(1);
    expect(r.converted30d).toBe(2);
    expect(r.rate7d).toBe(33);
    expect(r.rate30d).toBe(67);
  });

  it('무료 플랜 이전 결제·31일 초과·CONFIRMED 아님 = 미집계', () => {
    const r = computeFreeToPaidConversion(
      [free('a@x.com')],
      [
        booking('a@x.com', -1),                              // 무료 이전
        booking('a@x.com', 35),                              // 윈도우 밖
        booking('a@x.com', 2, { status: 'CANCELLED' }),      // 미확정
      ],
    );
    expect(r.converted30d).toBe(0);
  });

  it('같은 이메일 다중 결제 = 1회 카운트, payerEmail 폴백·대소문자 무시', () => {
    const r = computeFreeToPaidConversion(
      [free('a@x.com')],
      [
        { payerEmail: 'A@X.COM', createdAtMs: T0 + 2 * DAY, productType: 'tour' },
        booking('a@x.com', 5),
      ],
    );
    expect(r.converted30d).toBe(1);
  });

  it('채널 = attribution.first.utm_source, 없으면 direct — 상품별 분류', () => {
    const r = computeFreeToPaidConversion(
      [free('a@x.com'), free('b@x.com')],
      [
        booking('a@x.com', 2, { attribution: { first: { utm_source: 'google' } }, productType: 'charter' }),
        booking('b@x.com', 3, { productType: 'tour-package' }),
      ],
    );
    expect(r.byChannel).toEqual({ google: 1, direct: 1 });
    expect(r.byProduct).toEqual({ charter: 1, 'tour-package': 1 });
  });

  it('빈 입력·이메일 없는 레코드 = 0, throw 없음', () => {
    expect(() => computeFreeToPaidConversion([], [])).not.toThrow();
    const r = computeFreeToPaidConversion([{ createdAtMs: T0 }], [booking('a@x.com', 1)]);
    expect(r.freeUserBase).toBe(0);
    expect(r.converted30d).toBe(0);
  });
});
