/**
 * resolve-line-item 단위 테스트 — 장바구니 라인별 결제 SSOT 재계산 (PR2c).
 * (1) resolveKrwAmount 정본 복제 correctness (SPEC 기준) (2) dispatch (3) 합산/거부
 * (4) ⚠️ source-parity 가드 — createPaypalOrder.js 와 상수 divergence 방지 (복제 채택 trade-off).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveKrwAmount, resolveLineItemKrw, computeCartTotalKrw,
  CHARTER_MAP, AI_PLANNER_FULL_KRW, COMBO_DISCOUNT_PERCENT_FALLBACK,
} from '../../api/_shared/resolve-line-item.js';

const SPEC = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_pricing_spec.json'), 'utf8'));
const createOrderSrc = readFileSync(resolve(process.cwd(), 'api/createPaypalOrder.js'), 'utf8');
const createCartSrc = readFileSync(resolve(process.cwd(), 'api/createCartOrder.js'), 'utf8');

describe('resolveKrwAmount — 정본 복제 correctness', () => {
  it('ai_planner_full = 13300 (fixed)', () => {
    expect(resolveKrwAmount(SPEC, 'ai_planner_full', 1, 1)).toBe(13300);
  });
  it('kpop_shuttle = pax × price', () => {
    expect(resolveKrwAmount(SPEC, 'kpop_shuttle_oneway', 3, 1)).toBe(3 * SPEC.kpop_shuttle.price_one_way);
  });
  it('charter × durationDays (P100) + hyphen 정규화', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 1)).toBe(daily);
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 3)).toBe(daily * 3);
    expect(resolveKrwAmount(SPEC, 'charter-seoul-city', 1, 2)).toBe(daily * 2);
  });
  it('days cap 1~30 + undefined/0 = 1', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, undefined)).toBe(daily);
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 99)).toBe(daily * 30);
    expect(resolveKrwAmount(SPEC, 'charter_seoul_city', 1, 0)).toBe(daily);
  });
  it('airport_ = SPEC 값', () => {
    const v = SPEC.airport_transfer_prices['seoul-central'].priceKRW;
    expect(resolveKrwAmount(SPEC, 'airport_seoul_central', 1, 1)).toBe(v);
  });
  it('combo = (airport+tour)×(1-할인) 정확', () => {
    const airport = SPEC.airport_transfer_prices['seoul-central'].priceKRW;
    const tour = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    const cp = SPEC.combo_packages || {};
    const pkg = (cp.packages && cp.packages.combo_airport_seoul) || {};
    let disc;
    if (typeof pkg.discount_percent === 'number') disc = pkg.discount_percent;
    else if (typeof cp.discount_percent === 'number') disc = cp.discount_percent;
    else disc = 10;
    const expected = Math.round((airport + tour) * (1 - disc / 100));
    expect(resolveKrwAmount(SPEC, 'combo_airport_seoul', 1, 1)).toBe(expected);
  });
  it('unknown/missing SPEC = null', () => {
    expect(resolveKrwAmount(SPEC, 'nonsense_product', 1, 1)).toBe(null);
    expect(resolveKrwAmount(null, 'ai_planner_full', 1, 1)).toBe(null);
  });
});

describe('resolveLineItemKrw — dispatch (개별 flag 존중)', () => {
  it('일반 productType → resolveKrwAmount', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    expect(resolveLineItemKrw(SPEC, { productType: 'charter_seoul_city', durationDays: 2 }, {})).toBe(daily * 2);
  });
  it('charter_transfer flag OFF → null (cart 가 개별 flag 우회 안 함)', () => {
    expect(resolveLineItemKrw(SPEC, { productType: 'charter_transfer', originKey: 'x', destKey: 'y' }, { transferEnabled: false })).toBe(null);
  });
  it('null booking/productType → null', () => {
    expect(resolveLineItemKrw(SPEC, null, {})).toBe(null);
    expect(resolveLineItemKrw(SPEC, {}, {})).toBe(null);
  });
});

describe('computeCartTotalKrw — 합산 + 거부 (P311)', () => {
  const tourItem = (days: number) => ({ booking: { productType: 'charter_seoul_city', durationDays: days } });
  it('합산 = 라인 합', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    const r = computeCartTotalKrw(SPEC, [tourItem(1), tourItem(2)], {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalKRW).toBe(daily + daily * 2);
      expect(r.lines).toHaveLength(2);
    }
  });
  it('빈 cart = EMPTY_CART', () => {
    expect(computeCartTotalKrw(SPEC, [], {})).toMatchObject({ ok: false, code: 'EMPTY_CART' });
  });
  it('AI 플래너 포함 = MIXED_DIGITAL_PHYSICAL 전체 거부', () => {
    expect(computeCartTotalKrw(SPEC, [tourItem(1), { booking: { productType: 'ai_planner_full' } }], {}))
      .toMatchObject({ ok: false, code: 'MIXED_DIGITAL_PHYSICAL' });
  });
  it('null 라인 = INVALID_LINE 전체 거부 (부분 결제 금지)', () => {
    expect(computeCartTotalKrw(SPEC, [tourItem(1), { booking: { productType: 'nonsense' } }], {}))
      .toMatchObject({ ok: false, code: 'INVALID_LINE' });
  });
  it('client priceKRW 무시 (booking 키만 신뢰)', () => {
    const daily = SPEC.daily_tour_prices['seoul-city'].priceKRW;
    const r = computeCartTotalKrw(SPEC, [{ booking: { productType: 'charter_seoul_city', durationDays: 1 }, priceKRW: 999999999 }], {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totalKRW).toBe(daily); // 위조된 priceKRW 무시
  });
});

describe('source-parity 가드 — createPaypalOrder.js 와 상수 동기 (복제 divergence 방지)', () => {
  it('AI_PLANNER_FULL_KRW 동일 (13300)', () => {
    expect(AI_PLANNER_FULL_KRW).toBe(13_300);
    expect(createOrderSrc).toMatch(/AI_PLANNER_FULL_KRW\s*=\s*13_?300/);
  });
  it('CHARTER_MAP 키·값 동일', () => {
    for (const key of Object.keys(CHARTER_MAP)) {
      expect(createOrderSrc).toContain(`${key}:`);
    }
    expect(createOrderSrc).toMatch(/charter_seoul_city:\s*'seoul-city'/);
    expect(createOrderSrc).toMatch(/charter_busan:\s*'busan-day'/);
  });
  it('COMBO_DISCOUNT_PERCENT_FALLBACK 동일 (10)', () => {
    expect(COMBO_DISCOUNT_PERCENT_FALLBACK).toBe(10);
    expect(createOrderSrc).toMatch(/COMBO_DISCOUNT_PERCENT_FALLBACK\s*=\s*10/);
  });
});

describe('createCartOrder 핸들러 — 안전 wiring 가드', () => {
  it('FEATURE_CART flag-gated (OFF=404 CART_DISABLED)', () => {
    expect(createCartSrc).toMatch(/featureEnabled\(process\.env\.FEATURE_CART\)/);
    expect(createCartSrc).toMatch(/CART_DISABLED/);
  });
  it('computeCartTotalKrw 로 SSOT 재계산 (client priceKRW 무시)', () => {
    expect(createCartSrc).toMatch(/computeCartTotalKrw\(SPEC,\s*items/);
  });
  it('고정 USD 1400 (charter_usd_fix_rate)', () => {
    expect(createCartSrc).toMatch(/charter_usd_fix_rate\s*\|\|\s*1400/);
  });
  it('cart_orders 스냅샷 저장 (capture SSOT) + 실패 시 명시 에러', () => {
    expect(createCartSrc).toMatch(/cart_orders/);
    expect(createCartSrc).toMatch(/SNAPSHOT_FAILED/);
  });
});
