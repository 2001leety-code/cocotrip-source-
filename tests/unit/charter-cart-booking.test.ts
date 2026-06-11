import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — ESM .js (backend SSOT)
import { resolveLineItemKrw, computeCartTotalKrw } from '../../api/_shared/resolve-line-item.js';
import { buildCharterCartItem } from '../../src/components/charter/charterCartItem';
import type { WizardState } from '../../src/components/charter/types';
import type { ResolvedPayment } from '../../src/components/charter/resolveProductType';

// 2026-06-11 차터 장바구니 담기 — 프론트 매핑(buildCharterCartItem)이 backend resolve-line-item.js 가
// 읽는 키를 빠짐없이 제공하는지 = P311(표시가==청구가) parity 가드. 표시 priceKRW 는 일부러 1 로 둬도
// backend 가 booking 키로 재계산 → 가격>0 이어야 함(변조 차단 데모).
const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));
// ⚠️ SPEC 에 "comment" 등 문서용 키가 섞여 있어 실제 데이터 키만 선별.
const firstMatrixKey = Object.keys(SPEC.distance_matrix || {}).find((k) => k.includes('→')) || 'a→b';
const [mOrigin, mDest] = firstMatrixKey.split('→');
const firstAirportKey = Object.keys(SPEC.airport_transfer_prices || {}).find(
  (k) => SPEC.airport_transfer_prices[k] && typeof SPEC.airport_transfer_prices[k] === 'object' && SPEC.airport_transfer_prices[k].priceKRW > 0,
);

const st = (o: Partial<WizardState>): WizardState => ({ vehicle: 'staria', paxCount: 2, startDate: '2026-07-01', ...o } as WizardState);
const rp = (o: Partial<ResolvedPayment>): ResolvedPayment => ({ productType: null, priceKRW: null, passengers: 2, payable: false, ...o } as ResolvedPayment);

describe('buildCharterCartItem — 필드 매핑', () => {
  it('charter_transfer: originKey/destKey/tripType/vehicle (backend transfer 분기 키)', () => {
    const item = buildCharterCartItem(
      st({ service: 'transfer', origin: mOrigin, destinationKey: mDest, tripType: 'oneway' }),
      rp({ productType: 'charter_transfer', priceKRW: 1, payable: true, originKey: mOrigin, destKey: mDest, tripType: 'oneway' }),
    )!;
    expect(item).not.toBeNull();
    expect(item.booking.originKey).toBe(mOrigin);
    expect(item.booking.destKey).toBe(mDest);
    expect(item.booking.tripType).toBe('oneway');
    expect(item.booking.vehicle).toBe('staria');
  });
  it('charter_multiday: +durationDays', () => {
    const item = buildCharterCartItem(
      st({ service: 'multi_day', origin: mOrigin, destinationKey: mDest, startDate: '2026-07-01', endDate: '2026-07-03' }),
      rp({ productType: 'charter_multiday', priceKRW: 1, payable: true, originKey: mOrigin, destKey: mDest, durationDays: 3 }),
    )!;
    expect(item.booking.durationDays).toBe(3);
    expect(item.booking.originKey).toBe(mOrigin);
  });
  it('day_tour(미설정 durationDays) → 1 기본', () => {
    const item = buildCharterCartItem(st({ service: 'day_tour' }), rp({ productType: 'charter_seoul_city', priceKRW: 1, payable: true }))!;
    expect(item.booking.durationDays).toBe(1);
  });
});

describe('백엔드 parity — booking 으로 resolveLineItemKrw 가격>0 (P311 SSOT 재계산)', () => {
  it('airport_*: productType/passengers 로 가격>0 (표시가 1 무시)', () => {
    const pt = `airport_${String(firstAirportKey).replace(/-/g, '_')}`;
    const item = buildCharterCartItem(st({ service: 'airport_transfer', destinationKey: firstAirportKey }), rp({ productType: pt, priceKRW: 1, payable: true }))!;
    expect(resolveLineItemKrw(SPEC, item.booking)).toBeGreaterThan(0);
  });
  it('kpop_shuttle_roundtrip: passengers 로 가격>0', () => {
    const item = buildCharterCartItem(st({ service: 'kpop_shuttle' }), rp({ productType: 'kpop_shuttle_roundtrip', priceKRW: 1, payable: true, passengers: 2 }))!;
    const krw = resolveLineItemKrw(SPEC, item.booking);
    expect(krw).toBeGreaterThan(0);
    expect(krw).toBe(2 * SPEC.kpop_shuttle.price_round_trip); // passengers × 단가 (변조 차단 확정)
  });
  it('computeCartTotalKrw: airport+kpop 합산 ok', () => {
    const pt = `airport_${String(firstAirportKey).replace(/-/g, '_')}`;
    const a = buildCharterCartItem(st({ service: 'airport_transfer', destinationKey: firstAirportKey }), rp({ productType: pt, priceKRW: 1, payable: true }))!;
    const b = buildCharterCartItem(st({ service: 'kpop_shuttle' }), rp({ productType: 'kpop_shuttle_roundtrip', priceKRW: 1, payable: true, passengers: 2 }))!;
    const r = computeCartTotalKrw(SPEC, [
      { id: a.id, booking: a.booking, displayName: a.displayName, addedAt: 1 },
      { id: b.id, booking: b.booking, displayName: b.displayName, addedAt: 2 },
    ], {});
    expect(r.ok).toBe(true);
    expect(r.totalKRW).toBeGreaterThan(0);
  });
});

describe('cart 부적합 → null (담기 버튼 미노출)', () => {
  it('비결제(payable=false) → null', () => {
    expect(buildCharterCartItem(st({}), rp({ payable: false, reason: '협의' }))).toBeNull();
  });
  it('charter_custom_estimate(견적문의) → null (backend INVALID_LINE 회피)', () => {
    expect(buildCharterCartItem(st({}), rp({ productType: 'charter_custom_estimate', priceKRW: 100000, payable: true }))).toBeNull();
  });
  it('ai_planner_full → null (정책)', () => {
    expect(buildCharterCartItem(st({}), rp({ productType: 'ai_planner_full', priceKRW: 13300, payable: true }))).toBeNull();
  });
  it('priceKRW<=0 → null', () => {
    expect(buildCharterCartItem(st({}), rp({ productType: 'charter_transfer', priceKRW: 0, payable: true }))).toBeNull();
  });
});
