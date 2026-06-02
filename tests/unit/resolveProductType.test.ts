/**
 * resolveProductType — 위저드 state → PayPal productType + 가격 매핑 회귀 가드 (2026-06-02, 차터 결제 wiring).
 *
 * 핵심:
 *  1) 플래그 OFF(기본) → 현행 byte-identical (multi_day = WhatsApp, payable=false). prod 무영향 보장.
 *  2) VITE_FEATURE_MULTIDAY_CHECKOUT ON + 매트릭스 + staria/sprinter + 1박+ → charter_multiday,
 *     priceKRW == 백엔드 calcMultiDayCharterKrw (표시가 == 청구가, P311).
 *  3) originKey/destKey/durationDays 가 PayPalBookingButton 으로 forward 되도록 반환에 포함.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveProductType } from '../../src/components/charter/resolveProductType';
import type { WizardState } from '../../src/components/charter/types';
import { calcMultiDayCharterKrw as beMultiday, lookupMatrixKm } from '../../api/_shared/charter-multiday-price.js';
import { calcTourQuote as beTourQuote } from '../../api/_shared/tour-price.js';
import { calcTransferQuote as beTransferQuote } from '../../api/_shared/charter-transfer-price.js';
import { calcMultiDayQuote } from '../../src/lib/multidayQuote';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

const base = (over: Partial<WizardState> = {}): WizardState => ({
  paxCount: 2, adultCount: 2, childCount: 0, vehicle: 'staria', options: {}, ...over,
});

// 멀티데이 (ICN→BUSAN, 3일)
const multidayState = (over: Partial<WizardState> = {}): WizardState => base({
  service: 'multi_day', origin: 'ICN', destinationKey: 'BUSAN',
  startDate: '2026-07-01', endDate: '2026-07-03', ...over,
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('resolveProductType — 플래그 OFF (기본): 현행 byte-identical', () => {
  it('multi_day → payable=false, productType=null (WhatsApp 견적 유지)', () => {
    const r = resolveProductType(multidayState());
    expect(r.payable).toBe(false);
    expect(r.productType).toBeNull();
    expect(r.priceKRW).toBeNull();
  });

  it('airport_transfer → 기존 airport_* 그대로 (멀티데이 wiring 무영향)', () => {
    const r = resolveProductType(base({ service: 'airport_transfer', destinationKey: 'seoul-central', vehicle: 'staria' }));
    // SSOT 에 seoul-central 미등재면 payable=false 일 수 있으나, productType 형식은 airport_ 접두 or null
    expect(r.productType === null || r.productType?.startsWith('airport_')).toBe(true);
  });

  it('day_tour 패키지 → 기존 charter_* 그대로', () => {
    const r = resolveProductType(base({ service: 'day_tour', destinationKey: 'dmz', vehicle: 'staria' }));
    expect(r.productType).toBe('charter_dmz');
    expect(r.payable).toBe(true);
  });
});

describe('resolveProductType — VITE_FEATURE_MULTIDAY_CHECKOUT ON', () => {
  it('multi_day + 매트릭스(ICN→BUSAN) + staria + 3일 → charter_multiday, 가격 == 백엔드', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    const r = resolveProductType(multidayState());
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    expect(r.productType).toBe('charter_multiday');
    expect(r.payable).toBe(true);
    expect(r.priceKRW).toBe(beMultiday(SPEC, { vehicle: 'staria', km, durationDays: 3 }));
    // forward 필드 (PaymentPanel → PayPalBookingButton → backend 재계산)
    expect(r.originKey).toBe('ICN');
    expect(r.destKey).toBe('BUSAN');
    expect(r.durationDays).toBe(3);
  });

  it('sprinter 도 결제 가능 (가격 == 백엔드)', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    const r = resolveProductType(multidayState({ vehicle: 'sprinter' }));
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    expect(r.productType).toBe('charter_multiday');
    expect(r.priceKRW).toBe(beMultiday(SPEC, { vehicle: 'sprinter', km, durationDays: 3 }));
  });

  it('bus/vip → 결제 불가 (inquiry-only, fall-through)', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    expect(resolveProductType(multidayState({ vehicle: 'bus' })).productType).toBeNull();
    expect(resolveProductType(multidayState({ vehicle: 'vip' })).payable).toBe(false);
  });

  it('당일(1일, endDate 없음) → charter_multiday 아님 (1박+ 만 멀티데이)', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    const r = resolveProductType(multidayState({ endDate: undefined }));
    expect(r.productType).toBeNull();
    expect(r.payable).toBe(false);
  });

  it('비매트릭스 목적지 → 결제 불가 (custom = WhatsApp 협의)', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    const r = resolveProductType(multidayState({ destinationKey: undefined, destinationCustom: '아무데나없는곳XYZ' }));
    expect(r.productType).toBeNull();
    expect(r.payable).toBe(false);
  });

  it('CUSTOM 출발 → 결제 불가 (originKey 미정)', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    const r = resolveProductType(multidayState({ origin: 'CUSTOM' }));
    expect(r.payable).toBe(false);
  });

  it('표시가 == 청구가 + 3일 10% 할인 반영 (운영자 정책 2026-06-02, P311)', () => {
    vi.stubEnv('VITE_FEATURE_MULTIDAY_CHECKOUT', 'true');
    const r = resolveProductType(multidayState()); // 3일 (2026-07-01~07-03)
    const km = lookupMatrixKm(SPEC, 'ICN', 'BUSAN')!;
    const q = calcMultiDayQuote({ vehicle: 'staria', km, durationDays: 3 })!;
    expect(q.discountPct).toBe(10);
    expect(r.priceKRW).toBe(q.total);                                                  // 프론트 영수증 == resolveProductType
    expect(r.priceKRW).toBe(beMultiday(SPEC, { vehicle: 'staria', km, durationDays: 3 })); // == 백엔드 청구가
    expect(r.priceKRW).toBe(Math.round(q.base * 0.9));                                 // 10% 할인 실제 반영
  });
});

describe('resolveProductType — 투어 시간제 (VITE_FEATURE_TOUR_HOURLY)', () => {
  // 매트릭스 해석 가능한 day_tour 목적지 (SEL_METRO→GANGNEUNG, 강릉 당일투어)
  const tourState = (over: Partial<WizardState> = {}): WizardState => base({
    service: 'day_tour', origin: 'SEL_METRO', destinationKey: 'GANGNEUNG', ...over,
  });

  it('플래그 OFF: 비패키지 day_tour → 패키지 미선택 (payable=false, 현행 byte-identical)', () => {
    const r = resolveProductType(tourState());
    expect(r.payable).toBe(false);
    expect(r.productType).toBeNull();
  });

  it('플래그 ON + 매트릭스 목적지(SEL_METRO→GANGNEUNG) + staria → tour_hourly, 가격 == 백엔드', () => {
    vi.stubEnv('VITE_FEATURE_TOUR_HOURLY', 'true');
    const km = lookupMatrixKm(SPEC, 'SEL_METRO', 'GANGNEUNG')!;
    expect(km).toBeGreaterThan(0);
    const r = resolveProductType(tourState());
    expect(r.productType).toBe('tour_hourly');
    expect(r.payable).toBe(true);
    expect(r.priceKRW).toBe(beTourQuote({ km, vehicle: 'staria' })!.total);
    expect(r.originKey).toBe('SEL_METRO');
    expect(r.destKey).toBe('GANGNEUNG');
  });

  it('플래그 ON + 패키지(dmz) → 기존 charter_dmz 유지 (tour_hourly 아님)', () => {
    vi.stubEnv('VITE_FEATURE_TOUR_HOURLY', 'true');
    const r = resolveProductType(tourState({ destinationKey: 'dmz' }));
    expect(r.productType).toBe('charter_dmz');
  });

  it('플래그 ON + bus → 결제 불가 (협의)', () => {
    vi.stubEnv('VITE_FEATURE_TOUR_HOURLY', 'true');
    expect(resolveProductType(tourState({ vehicle: 'bus' })).payable).toBe(false);
  });

  it('플래그 ON + 비매트릭스 custom 목적지 → 결제 불가 (WhatsApp)', () => {
    vi.stubEnv('VITE_FEATURE_TOUR_HOURLY', 'true');
    const r = resolveProductType(tourState({ destinationKey: undefined, destinationCustom: '없는동네ZZZ' }));
    expect(r.payable).toBe(false);
  });
});

describe('resolveProductType — 도시간 transfer (VITE_FEATURE_TRANSFER_CHECKOUT)', () => {
  const transferState = (over: Partial<WizardState> = {}): WizardState => base({
    service: 'transfer', origin: 'SEL_METRO', destinationKey: 'BUSAN', ...over,
  });

  it('플래그 OFF: transfer → 협의 (payable=false, 현행 무영향)', () => {
    const r = resolveProductType(transferState());
    expect(r.payable).toBe(false);
    expect(r.productType).toBeNull();
  });

  it('플래그 ON + 매트릭스(SEL_METRO→BUSAN) + staria + 편도 → charter_transfer, 가격 == 백엔드', () => {
    vi.stubEnv('VITE_FEATURE_TRANSFER_CHECKOUT', 'true');
    const km = lookupMatrixKm(SPEC, 'SEL_METRO', 'BUSAN')!;
    expect(km).toBeGreaterThan(0);
    const r = resolveProductType(transferState({ tripType: 'oneway' }));
    expect(r.productType).toBe('charter_transfer');
    expect(r.payable).toBe(true);
    expect(r.priceKRW).toBe(beTransferQuote({ km, tripType: 'oneway', vehicle: 'staria' })!.total);
    expect(r.tripType).toBe('oneway');
    expect(r.originKey).toBe('SEL_METRO');
    expect(r.destKey).toBe('BUSAN');
  });

  it('플래그 ON + 왕복 → 가격 == 백엔드 (km×2 + 쿠폰 10%)', () => {
    vi.stubEnv('VITE_FEATURE_TRANSFER_CHECKOUT', 'true');
    const km = lookupMatrixKm(SPEC, 'SEL_METRO', 'BUSAN')!;
    const r = resolveProductType(transferState({ tripType: 'roundtrip' }));
    expect(r.priceKRW).toBe(beTransferQuote({ km, tripType: 'roundtrip', vehicle: 'staria' })!.total);
    expect(r.tripType).toBe('roundtrip');
  });

  it('tripType 미설정 → oneway 기본', () => {
    vi.stubEnv('VITE_FEATURE_TRANSFER_CHECKOUT', 'true');
    expect(resolveProductType(transferState({ tripType: undefined })).tripType).toBe('oneway');
  });

  it('플래그 ON + bus → 결제 불가 (협의)', () => {
    vi.stubEnv('VITE_FEATURE_TRANSFER_CHECKOUT', 'true');
    expect(resolveProductType(transferState({ vehicle: 'bus' })).payable).toBe(false);
  });

  it('플래그 ON + 비매트릭스 목적지 → 결제 불가 (WhatsApp)', () => {
    vi.stubEnv('VITE_FEATURE_TRANSFER_CHECKOUT', 'true');
    const r = resolveProductType(transferState({ destinationKey: undefined, destinationCustom: '없는곳ZZZ' }));
    expect(r.payable).toBe(false);
  });
});
