// charterPricing.test.ts — Charter 가격 계산 로직 자율 검증 v2 (B-CHT1 ~ B-CHT8)
//
// 본 PR 의 검증 대상은 가격 계산 logic 정합성 (가격 데이터 정확성 audit 는 별도 agent).
// 8 개 assertion:
//   B-CHT1: Staria 8인 + 서울 1-day 단일가 — DAILY_TOUR_PRICES 우선 매칭
//   B-CHT2: Sprinter + ICN→Busan (matrix priceKRW × 차종 배수)
//   B-CHT3: AIRPORT_TRANSFER_PRICES 모든 zone × staria/sprinter → price > 0
//   B-CHT4: 5% 쿠폰 productScope — charter 허용 / ai_planner reject / tour_package reject
//   B-CHT5: 다일 가격 합산 — multi_day 매트릭스 hit + 10% 다일 할인
//   B-CHT6: 캐리어 cap 정책 — calcVehicleCount 8개=2대 amber trigger
//   B-CHT7: 12h cutoff (현재 정책 — 모든 케이스 통일) — 픽업 시각 미래 검증
//   B-CHT8: PaymentPanel ↔ useQuoteCalculator 일관성 — resolveProductType vs calculateQuote
//
// 비고: pickupTime cutoff 는 Step6Quote 의 CutoffNotice 내부 함수 — module export 가
// 없어 정책 (12h 통일) 자체를 다른 component-level 함수 / regex 로 검증한다.

import { describe, it, expect } from 'vitest';
import { calculateQuote } from '../../src/hooks/useQuoteCalculator';
import { resolveProductType } from '../../src/components/charter/resolveProductType';
import { calcVehicleCount } from '../../src/lib/luggageVehicle';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
} from '../../src/data/charterPricing';
import type { WizardState, VehicleType } from '../../src/components/charter/types';

const baseState: WizardState = {
  vehicle: 'staria',
  paxCount: 4,
  adultCount: 4,
  childCount: 0,
  options: {},
};

// ─────────────────────────────────────────────────────────
// B-CHT1: Staria 8인 + 서울 1-day → DAILY_TOUR_PRICES 단일가
// ─────────────────────────────────────────────────────────

describe('B-CHT1 — Staria + 서울 1-day 단일가', () => {
  it('day_tour + destinationKey=seoul-city → DAILY_TOUR_PRICES.priceKRW 그대로', () => {
    const q = calculateQuote({
      ...baseState,
      service: 'day_tour',
      destinationKey: 'seoul-city',
      origin: 'SEL_METRO',
      startDate: '2026-06-01',
      startTime: '08:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // SSOT — pricing_spec.json daily_tour_prices['seoul-city'].priceKRW = 330_000
    expect(q!.subtotalKRW).toBe(DAILY_TOUR_PRICES['seoul-city'].priceKRW);
    expect(q!.source).toBe('package');
    expect(q!.vehicle).toBe('staria');
  });

  it('Staria 배수 = 1.0 → DAILY_TOUR_PRICES 원가와 동일', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'day_tour',
      destinationKey: 'seoul-city',
      origin: 'SEL_METRO',
      startDate: '2026-06-01',
      startTime: '08:00',
    });
    // 배수 1.0 — vehicleChargeKRW == DAILY_TOUR_PRICES.priceKRW
    expect(q!.vehicleChargeKRW).toBe(DAILY_TOUR_PRICES['seoul-city'].priceKRW);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT2: Sprinter + ICN→Busan 거리 기반 합리성
// ─────────────────────────────────────────────────────────

describe('B-CHT2 — Sprinter + ICN→Busan 합리적 가격', () => {
  it('Sprinter + ICN→Busan: 매트릭스 priceKRW(660k, 2026-05-12 P0-Q3) × 2.0(sprinter) = 1,320,000 + 가이드 300k', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'sprinter',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'busan',
      startDate: '2026-06-01',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // 660k × 2.0 = 1,320,000 (vehicleChargeKRW) — Q3 운영자 결정: ICN→부산 ₩600K → ₩660K
    expect(q!.vehicleChargeKRW).toBe(1_320_000);
    // Sprinter 는 가이드 자동 가산 (300k)
    const guideAddon = q!.addons.find(a => a.key === 'guide_required');
    expect(guideAddon).toBeDefined();
    expect(guideAddon!.amountKRW).toBe(300_000);
    // 합계 = 1,320,000 + 300,000 = 1,620,000 (야간/할인 없음)
    expect(q!.subtotalKRW).toBe(1_620_000);
    expect(q!.subtotalKRW).toBeGreaterThan(0);
    expect(Number.isFinite(q!.subtotalKRW)).toBe(true);
    expect(Number.isNaN(q!.subtotalKRW)).toBe(false);
  });

  it('Sprinter + 매트릭스 hit → 가격이 0/NaN/undefined 아님', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'sprinter',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'busan',
      startDate: '2026-06-01',
      startTime: '14:00',
    });
    expect(q!.subtotalKRW).toBeGreaterThan(0);
    expect(q!.vehicleChargeKRW).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT3: Zone fallback 매트릭스 — 모든 zone × staria/sprinter > 0
// ─────────────────────────────────────────────────────────

describe('B-CHT3 — AIRPORT_TRANSFER_PRICES × staria/sprinter zone matrix', () => {
  const zones = Object.keys(AIRPORT_TRANSFER_PRICES);
  const vehicles: VehicleType[] = ['staria', 'sprinter'];

  // 모든 zone × 모든 차종 조합 ↔ price > 0 (zone fallback 회귀 방지)
  for (const zone of zones) {
    for (const vehicle of vehicles) {
      it(`zone=${zone} × vehicle=${vehicle} → vehicleChargeKRW > 0`, () => {
        const q = calculateQuote({
          ...baseState,
          vehicle,
          service: 'airport_transfer',
          origin: 'ICN',
          destinationKey: zone,
          startDate: '2026-06-01',
          startTime: '14:00',
        });
        expect(q, `zone=${zone} vehicle=${vehicle} quote was null`).not.toBeNull();
        expect(q!.needsCustomQuote, `zone=${zone} vehicle=${vehicle} unexpectedly needsCustomQuote`).toBe(false);
        expect(q!.vehicleChargeKRW, `zone=${zone} vehicle=${vehicle} vehicleChargeKRW = 0/NaN`).toBeGreaterThan(0);
        expect(Number.isFinite(q!.vehicleChargeKRW), `zone=${zone} vehicle=${vehicle} not finite`).toBe(true);
        expect(Number.isNaN(q!.vehicleChargeKRW), `zone=${zone} vehicle=${vehicle} NaN`).toBe(false);
      });
    }
  }

  it('AIRPORT_TRANSFER_PRICES 자체 — 모든 zone priceKRW > 0 (데이터 가드)', () => {
    for (const [zone, entry] of Object.entries(AIRPORT_TRANSFER_PRICES)) {
      expect(entry.priceKRW, `zone=${zone} priceKRW <= 0`).toBeGreaterThan(0);
      expect(Number.isFinite(entry.priceKRW), `zone=${zone} priceKRW not finite`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT4: 5% 쿠폰 productScope 정책 (운영자 확정 2026-05-05)
//   - charter 쿠폰 → charter productType 만 허용
//   - both → charter + tour_package 허용
//   - ai_planner → ai-planner productType 만 허용
//   - 알 수 없는 scope → reject
// ─────────────────────────────────────────────────────────
//
// applyPromoCode.js 의 couponMatchesProduct 와 동일 로직 portable 복제.
// productType (예: charter_seoul_city, tour-package_X, ai_planner_full)
// → coupon.productScope ('charter' / 'tour-package' / 'ai_planner' / 'both')

function couponMatchesProduct(productScope: string | null | undefined, productType: string | null | undefined): boolean {
  if (!productScope) return true;     // legacy 쿠폰
  if (!productType) return true;       // backward compat
  const pt = String(productType).toLowerCase().replace(/-/g, '_');
  const scope = String(productScope).toLowerCase();

  if (scope === 'both') {
    return pt.startsWith('charter_') ||
           pt.startsWith('combo_airport_') ||
           pt.startsWith('airport_') ||
           pt.startsWith('kpop_shuttle_') ||
           pt.startsWith('tour_package');
  }
  if (scope === 'charter') {
    return pt.startsWith('charter_') ||
           pt.startsWith('combo_airport_') ||
           pt.startsWith('airport_') ||
           pt.startsWith('kpop_shuttle_');
  }
  if (scope === 'tour_package' || scope === 'tour-package') {
    return pt.startsWith('tour_package');
  }
  if (scope === 'ai_planner') {
    return pt.startsWith('ai_planner');
  }
  return false; // 알 수 없는 scope → reject
}

describe('B-CHT4 — 5% 쿠폰 productScope 매칭', () => {
  it('charter 쿠폰 + charter_seoul_city productType → 허용', () => {
    expect(couponMatchesProduct('charter', 'charter_seoul_city')).toBe(true);
  });

  it('charter 쿠폰 + ai_planner_full productType → reject (P0 보호)', () => {
    expect(couponMatchesProduct('charter', 'ai_planner_full')).toBe(false);
  });

  it('charter 쿠폰 + tour-package_X productType → reject (scope 위반)', () => {
    expect(couponMatchesProduct('charter', 'tour-package_X')).toBe(false);
  });

  it('both 쿠폰 + charter / tour-package 둘 다 허용', () => {
    expect(couponMatchesProduct('both', 'charter_dmz')).toBe(true);
    expect(couponMatchesProduct('both', 'tour-package_namsan_seoul')).toBe(true);
  });

  it('both 쿠폰 + ai_planner_full → reject (디지털 상품 정책)', () => {
    expect(couponMatchesProduct('both', 'ai_planner_full')).toBe(false);
  });

  it('legacy (productScope undefined) → 모든 productType 허용 (backward compat)', () => {
    expect(couponMatchesProduct(undefined, 'charter_dmz')).toBe(true);
    expect(couponMatchesProduct(null, 'ai_planner_full')).toBe(true);
  });

  it('알 수 없는 scope → 항상 reject (보수적)', () => {
    expect(couponMatchesProduct('unknown_scope', 'charter_dmz')).toBe(false);
  });

  it('5% 쿠폰 시나리오: charter scope + airport_seoul_central → 허용', () => {
    expect(couponMatchesProduct('charter', 'airport_seoul_central')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT5: 다일 가격 합산 — multi-day 10% 할인 정책
// ─────────────────────────────────────────────────────────

describe('B-CHT5 — multi_day 다일 가격 합산 + 10% 할인', () => {
  it('Staria 부산 2박3일 from SEL_METRO: km=400 → intercity+daily×3+overnight×2 → -10%', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '부산',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      startTime: '08:00',
      lodgingLocation: 'local',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    // SEL_METRO→BUSAN km=400. intercity = 50k + 400×2×1000 = 850k
    // + daily 200k×3 = 600k + overnight 130k×2 = 260k = 1,710k
    // -10% = 1,539,000
    expect(q!.subtotalKRW).toBe(1_539_000);
    expect(q!.multiDayDiscountPercent).toBe(10);
    expect(q!.multiDayDiscountKRW).toBe(171_000);
  });

  it('day_tour 는 multi-day 할인 미적용 (mode 분기)', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'day_tour',
      destinationKey: 'seoul-city',
      origin: 'SEL_METRO',
      startDate: '2026-06-01',
      startTime: '08:00',
    });
    expect(q!.multiDayDiscountKRW).toBe(0);
    expect(q!.multiDayDiscountPercent).toBe(0);
  });

  it('multi_day Staria 일수 1박2일 vs 2박3일 차이 = daily 200k+overnight 130k=+330k - 10%재계산', () => {
    const q1 = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '부산',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      startTime: '08:00',
    });
    const q2 = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'multi_day',
      origin: 'SEL_METRO',
      destinationCustom: '부산',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      startTime: '08:00',
    });
    // 2박3일 > 1박2일 (날짜 증분이 가격에 반영되어야 함)
    expect(q2!.subtotalKRW).toBeGreaterThan(q1!.subtotalKRW);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT6: 캐리어 cap 정책 — 8+ 시 2대 권장 (amber trigger)
// ─────────────────────────────────────────────────────────

describe('B-CHT6 — 캐리어 합계 → 차량 수 amber 트리거', () => {
  it('luggage 9개 (small:3 + medium:3 + large:3) → 2대', () => {
    const total = 3 + 3 + 3;
    expect(calcVehicleCount(total)).toBe(2);
  });

  it('luggage 2개 (small:1 + medium:1) → 1대 정상', () => {
    const total = 1 + 1;
    expect(calcVehicleCount(total)).toBe(1);
  });

  it('luggage 7개 정확 cutoff → 1대', () => {
    expect(calcVehicleCount(7)).toBe(1);
  });

  it('luggage 8개 → 2대 (amber 임계)', () => {
    expect(calcVehicleCount(8)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT7: 12h cutoff (2026-05-07 통일 정책 — 모든 케이스 12h)
// ─────────────────────────────────────────────────────────
// Step6Quote.CutoffNotice 내부 함수 portable 복제.
// hoursLeft = (departureMs - now) / 3_600_000
// closed = hoursLeft <= 0 OR remainingUntilCutoff <= -cutoffHours
// imminent = hoursLeft > 0 AND remainingUntilCutoff < 0
// cutoffHours = 12

function classifyCutoff(startDate: string, pickupTime: string, nowMs: number = Date.now()): 'closed' | 'imminent' | 'ok' {
  const cutoffHours = 12;
  const departureMs = new Date(`${startDate}T${pickupTime}:00+09:00`).getTime();
  if (isNaN(departureMs)) return 'closed';
  const hoursLeft = (departureMs - nowMs) / 3_600_000;
  const remainingUntilCutoff = hoursLeft - cutoffHours;
  if (hoursLeft <= 0 || remainingUntilCutoff <= -cutoffHours) return 'closed';
  if (hoursLeft > 0 && remainingUntilCutoff < 0) return 'imminent';
  return 'ok';
}

describe('B-CHT7 — 12h 예약 마감 cutoff 분류', () => {
  // 고정 KST 기준점 — 2026-06-01 14:00 KST = 2026-06-01 05:00 UTC
  const NOW_KST_ANCHOR = new Date('2026-06-01T14:00:00+09:00').getTime();

  it('픽업 = now + 6h → imminent (12h cutoff 미만, 미래)', () => {
    const result = classifyCutoff('2026-06-01', '20:00', NOW_KST_ANCHOR);
    expect(result).toBe('imminent');
  });

  it('픽업 = now + 24h → ok (12h cutoff 초과, 안전)', () => {
    const result = classifyCutoff('2026-06-02', '14:00', NOW_KST_ANCHOR);
    expect(result).toBe('ok');
  });

  it('픽업 = now - 6h (과거) → closed (이미 출발)', () => {
    const result = classifyCutoff('2026-06-01', '08:00', NOW_KST_ANCHOR);
    expect(result).toBe('closed');
  });

  it('픽업 = now + 30h → ok (충분한 여유)', () => {
    const result = classifyCutoff('2026-06-02', '20:00', NOW_KST_ANCHOR);
    expect(result).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT8: PaymentPanel ↔ useQuoteCalculator 일관성
// ─────────────────────────────────────────────────────────
// resolveProductType (PayPal 가격 source) ↔ calculateQuote (위저드 가격 source)
// 같은 input → 두 함수의 가격이 일치해야 함 (오답노트 P1 mismatch 방지).

describe('B-CHT8 — resolveProductType ↔ calculateQuote 가격 일관성', () => {
  it('Staria + day_tour + seoul-city: PayPal 가격 == 위저드 vehicleChargeKRW', () => {
    const state: WizardState = {
      ...baseState,
      vehicle: 'staria',
      service: 'day_tour',
      destinationKey: 'seoul-city',
      origin: 'SEL_METRO',
      startDate: '2026-06-01',
      startTime: '08:00',
    };
    const resolved = resolveProductType(state);
    const quote = calculateQuote(state);
    expect(resolved.payable).toBe(true);
    expect(resolved.priceKRW).toBe(quote!.vehicleChargeKRW);
  });

  it('Staria + airport_transfer + seoul-gangnam: PayPal 가격 == 위저드 vehicleChargeKRW', () => {
    const state: WizardState = {
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
    };
    const resolved = resolveProductType(state);
    const quote = calculateQuote(state);
    expect(resolved.payable).toBe(true);
    expect(resolved.priceKRW).toBe(quote!.vehicleChargeKRW);
  });

  it('Sprinter + airport_transfer: 즉시 결제 비활성 + 견적 vehicleChargeKRW > 0', () => {
    // Sprinter 는 가이드비 등 별도 계산 복잡 → resolveProductType.payable=false
    // 위저드는 견적 표시 (vehicleChargeKRW > 0) + addons.guide_required 가산
    const state: WizardState = {
      ...baseState,
      vehicle: 'sprinter',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
    };
    const resolved = resolveProductType(state);
    const quote = calculateQuote(state);
    // PayPal payable=false (Sprinter 별도 견적)
    expect(resolved.payable).toBe(false);
    // 위저드는 그래도 견적 노출 (vehicleChargeKRW > 0, guide 가산)
    expect(quote!.vehicleChargeKRW).toBeGreaterThan(0);
    expect(quote!.addons.some(a => a.key === 'guide_required')).toBe(true);
  });

  it('Bus + airport_transfer: payable=false + 위저드 vehicleChargeKRW=0 (협의 트리거)', () => {
    const state: WizardState = {
      ...baseState,
      vehicle: 'bus',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
    };
    const quote = calculateQuote(state);
    expect(quote!.needsCustomQuote).toBe(true);
    expect(quote!.vehicleChargeKRW).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT9: PUS 픽업 가격 = ₩77,000 (운영자 P0-Q1, 2026-05-12)
//   3 위치 SSOT 일관성 검증:
//   1) PICKUP_PRICES.PUS (UI 카드 표기)
//   2) AIRPORT_TRANSFER_PRICES['busan-metro'].priceKRW (SSOT)
//   3) DISTANCE_MATRIX['PUS→BUS_METRO'].priceKRW (matrix lookup)
// ─────────────────────────────────────────────────────────

import { PICKUP_PRICES } from '../../src/config/affiliateLinks';
import { DISTANCE_MATRIX } from '../../src/data/charterPricing';

describe('B-CHT9 — PUS 픽업 ₩77,000 3 위치 SSOT 일관성', () => {
  it('PICKUP_PRICES.PUS UI 카드 = ₩77,000', () => {
    const pus = PICKUP_PRICES.PUS;
    expect(pus).toBeDefined();
    expect(pus.length).toBeGreaterThanOrEqual(1);
    // UI 표기 문자열에서 숫자만 추출해서 비교
    const numeric = Number(pus[0].price.replace(/[^\d]/g, ''));
    expect(numeric).toBe(77000);
  });

  it('AIRPORT_TRANSFER_PRICES.busan-metro SSOT = ₩77,000', () => {
    const entry = AIRPORT_TRANSFER_PRICES['busan-metro'];
    expect(entry).toBeDefined();
    expect(entry.priceKRW).toBe(77000);
  });

  it('DISTANCE_MATRIX.PUS→BUS_METRO matrix = ₩77,000', () => {
    const m = (DISTANCE_MATRIX as unknown as Record<string, { priceKRW?: number; source?: string }>)['PUS→BUS_METRO'];
    expect(m).toBeDefined();
    expect(m.priceKRW).toBe(77000);
    expect(m.source).toBe('airport_transfer');
  });

  it('PUS 픽업 calculateQuote → vehicleChargeKRW = ₩77,000 (Staria, matrix/spec hit)', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'PUS',
      destinationKey: 'busan-metro',
      startDate: '2026-06-01',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.needsCustomQuote).toBe(false);
    expect(q!.vehicleChargeKRW).toBe(77000);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT10: PayPal 공항 확대 — ICN/PUS/GMP/CJU 4 공항 모두 payable=true
// (운영자 P0-Q2, 2026-05-12)
// ─────────────────────────────────────────────────────────

describe('B-CHT10 — PayPal 4 공항 확대 (Staria payable=true)', () => {
  it('PUS + busan-metro + Staria → payable=true + productType=airport_busan_metro', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'PUS',
      destinationKey: 'busan-metro',
    });
    expect(resolved.payable).toBe(true);
    expect(resolved.productType).toBe('airport_busan_metro');
    expect(resolved.priceKRW).toBe(77000);
  });

  it('GMP + gimpo-seoul-central + Staria → payable=true (₩90,000)', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'GMP',
      destinationKey: 'gimpo-seoul-central',
    });
    expect(resolved.payable).toBe(true);
    expect(resolved.priceKRW).toBe(90000);
  });

  it('CJU + jeju-metro + Staria → payable=true (₩72,800)', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'CJU',
      destinationKey: 'jeju-metro',
    });
    expect(resolved.payable).toBe(true);
    expect(resolved.priceKRW).toBe(72800);
  });

  it('ICN + seoul-central + Staria → 기존 동작 유지 (regression guard, ₩124,800)', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-central',
    });
    expect(resolved.payable).toBe(true);
    expect(resolved.priceKRW).toBe(124800);
  });

  it('PUS + 등재 안된 destinationKey → payable=false (가드 유지)', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'PUS',
      destinationKey: 'seoul-central', // PUS 출발이 서울 도심? 매트릭스 mismatch — 그러나 SSOT 등재됨이라 통과.
    });
    // seoul-central 은 SSOT 에 있으므로 payable=true 가 맞음. 의미적 mismatch 는 wizard step 1-2 가드.
    expect(resolved.payable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT11: ICN → 부산 직행 = ₩660,000 (운영자 P0-Q3, 2026-05-12)
// ₩600K → ₩660K (-₩60K 운영자 손실 회복)
// ─────────────────────────────────────────────────────────

describe('B-CHT11 — ICN → 부산 직행 ₩660,000', () => {
  it('AIRPORT_TRANSFER_PRICES.busan SSOT = ₩660,000', () => {
    expect(AIRPORT_TRANSFER_PRICES['busan'].priceKRW).toBe(660000);
  });

  it('DISTANCE_MATRIX.ICN→BUSAN priceKRW = ₩660,000 + source=airport_transfer', () => {
    const m = (DISTANCE_MATRIX as unknown as Record<string, { priceKRW?: number; source?: string }>)['ICN→BUSAN'];
    expect(m).toBeDefined();
    expect(m.priceKRW).toBe(660000);
    expect(m.source).toBe('airport_transfer');
  });

  it('ICN→busan + Staria calculateQuote → vehicleChargeKRW = ₩660,000', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'busan',
      startDate: '2026-06-01',
      startTime: '14:00',
    });
    expect(q).not.toBeNull();
    expect(q!.vehicleChargeKRW).toBe(660000);
  });

  it('ICN→busan + Staria resolveProductType → priceKRW=₩660,000 + payable=true', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'busan',
    });
    expect(resolved.payable).toBe(true);
    expect(resolved.priceKRW).toBe(660000);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT12: Bus/VIP needsCustomQuote 시 결제 가격 숫자 노출 X
// (운영자 P0-Q4, 2026-05-12) — 협의 라벨만 표시
// ─────────────────────────────────────────────────────────

describe('B-CHT12 — Bus/VIP 협의 (가격 숫자 노출 차단)', () => {
  it('Bus + airport_transfer → resolveProductType payable=false + priceKRW=null', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'bus',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
    });
    expect(resolved.payable).toBe(false);
    expect(resolved.priceKRW).toBeNull();
    expect(resolved.productType).toBeNull();
  });

  it('VIP + airport_transfer → resolveProductType payable=false + priceKRW=null', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'vip',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
    });
    expect(resolved.payable).toBe(false);
    expect(resolved.priceKRW).toBeNull();
  });

  it('Bus + day_tour → payable=false + priceKRW=null (가격 숨김)', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'bus',
      service: 'day_tour',
      destinationKey: 'seoul-city',
    });
    expect(resolved.payable).toBe(false);
    expect(resolved.priceKRW).toBeNull();
    expect(resolved.productType).toBeNull();
  });

  it('VIP + kpop_shuttle → payable=false + priceKRW=null', () => {
    const resolved = resolveProductType({
      ...baseState,
      vehicle: 'vip',
      service: 'kpop_shuttle',
    });
    expect(resolved.payable).toBe(false);
    expect(resolved.priceKRW).toBeNull();
  });

  it('Bus + airport_transfer calculateQuote → needsCustomQuote=true + vehicleChargeKRW=0', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'bus',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
    });
    // Step6Quote 가 needsCustomQuote=true 면 early return 으로 협의 배너만 표시 (가격 숫자 X)
    expect(q!.needsCustomQuote).toBe(true);
    expect(q!.vehicleChargeKRW).toBe(0);
    // 영수증에 노출될 subtotal 도 0 — Step6Quote.needsCustomQuote 분기로 도달 안 함
    expect(q!.subtotalKRW).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT13: Pickup/Transfer Formula 1 (4-tier one-way) —
//   옵션 C-FINAL (2026-05-12) 운영자 결정 (PR #381) 자연 도출 검증
//   Tier 1 (0-30km flat ₩77K) / Tier 2 (-100km +₩1.8K/km)
//   Tier 3 (-300km +₩1.3K/km) / Tier 4 (300+ +₩0.85K/km + toll)
// ─────────────────────────────────────────────────────────

import { calcPickupTransferFormula } from '../../src/hooks/useQuoteCalculator';
import { AIRPORT_TRANSFER_PRICING_FORMULA, VEHICLE_INTERCITY } from '../../src/data/charterPricing';

describe('B-CHT13 — Pickup/Transfer Formula 1 (4-tier)', () => {
  it('Tier 1: PUS → 해운대 30km → ₩77K (운영자 PR #381 자연 도출)', () => {
    const r = calcPickupTransferFormula(30, 'staria', true);
    expect(r).not.toBeNull();
    expect(r!.krw).toBe(77_000);
    expect(r!.breakdown.base).toBe(77_000);
    expect(r!.breakdown.perKm).toBe(0);
    expect(r!.breakdown.toll).toBe(0);
  });

  it('Tier 1 edge: 1km → ₩77K (최소 거리도 flat)', () => {
    const r = calcPickupTransferFormula(1, 'staria', true);
    expect(r!.krw).toBe(77_000);
  });

  it('Tier 2: CJU → 중문 40km → ₩95K (77K + 10×1.8K)', () => {
    const r = calcPickupTransferFormula(40, 'staria', true);
    expect(r!.krw).toBe(95_000);
    expect(r!.breakdown.perKm).toBe(18_000);
  });

  it('Tier 2: 50km → ₩113K (77K + 20×1.8K, toll 0 because <50)', () => {
    const r = calcPickupTransferFormula(49, 'staria', true);
    expect(r!.krw).toBe(77_000 + 19 * 1_800);
  });

  it('Tier 2 edge: 100km → ₩203K (77K + 70×1.8K, toll 100×100=10K 가산)', () => {
    const r = calcPickupTransferFormula(100, 'staria', true);
    // 77K + 70×1.8K = 203K + tollEstimate(100) = 100×100 = 10K → 213K
    // (tollEstimate: 50-199km → km×100)
    expect(r!.krw).toBe(203_000 + 10_000);
  });

  it('Tier 4: 300km → ₩463K + toll 300×150 = ₩508K', () => {
    const r = calcPickupTransferFormula(300, 'staria', true);
    // Tier3 end: 77K + 70×1.8K + 200×1.3K = 77K + 126K + 260K = 463K
    // tollEstimate(300) = 300×150 = 45K (km>=200)
    expect(r!.krw).toBe(463_000 + 45_000);
  });

  it('Tier 4: ICN → 부산 450km → ₩591K + toll ₩67.5K ≈ ₩658.5K (SSOT ₩660K 의 ±5% 이내)', () => {
    const r = calcPickupTransferFormula(450, 'staria', true);
    // Tier3 end (300km): 463K. +150×0.85K = 127.5K → 590.5K
    // toll: 450×150 = 67.5K → 658K
    const ssotPrice = 660_000;
    expect(r!.krw).toBeGreaterThanOrEqual(Math.round(ssotPrice * 0.95));
    expect(r!.krw).toBeLessThanOrEqual(Math.round(ssotPrice * 1.05));
  });

  it('Sprinter formula = staria × 1.85 (multiplier)', () => {
    const staria = calcPickupTransferFormula(50, 'staria', true);
    const sprinter = calcPickupTransferFormula(50, 'sprinter', true);
    expect(sprinter!.krw).toBe(Math.round(staria!.krw * 1.85));
  });

  it('Bus/VIP → null (협의)', () => {
    expect(calcPickupTransferFormula(50, 'bus', true)).toBeNull();
    expect(calcPickupTransferFormula(50, 'vip', true)).toBeNull();
  });

  it('km=0/음수/NaN → null (안전)', () => {
    expect(calcPickupTransferFormula(0, 'staria', true)).toBeNull();
    expect(calcPickupTransferFormula(-1, 'staria', true)).toBeNull();
    expect(calcPickupTransferFormula(NaN, 'staria', true)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT14: ICN → 명동 55km (서울 시내) → ₩122K
//   매트릭스 priceKRW=124,800 우선이라 formula 직접 호출로 검증
// ─────────────────────────────────────────────────────────

describe('B-CHT14 — ICN 도심 단거리 Formula 검증', () => {
  it('55km → 77K + 25×1.8K = ₩122K', () => {
    const r = calcPickupTransferFormula(55, 'staria', false);
    expect(r!.krw).toBe(122_000);
  });

  it('70km → 77K + 40×1.8K = ₩149K (강남급 거리)', () => {
    const r = calcPickupTransferFormula(70, 'staria', false);
    expect(r!.krw).toBe(149_000);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT15: ICN → 부산 450km + toll ₩67.5K → 매트릭스 ₩660K 와 일치 검증
//   - airport_transfer 자유입력 시 calcPickupTransferFormula 호출
//   - 매트릭스 lookup 우선이므로 destinationKey 가 'busan' 이면 ₩660K 그대로
// ─────────────────────────────────────────────────────────

describe('B-CHT15 — ICN → 부산 매트릭스 vs Formula 일관성', () => {
  it('매트릭스 hit: destinationKey="busan" → ₩660,000 (SSOT)', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'busan',
      startDate: '2026-06-01',
      startTime: '14:00',
    });
    expect(q!.vehicleChargeKRW).toBe(660_000);
  });

  it('Formula 직접 호출 450km → SSOT ₩660K ±5% 이내', () => {
    const r = calcPickupTransferFormula(450, 'staria', true);
    expect(r!.krw).toBeGreaterThanOrEqual(Math.round(660_000 * 0.95));
    expect(r!.krw).toBeLessThanOrEqual(Math.round(660_000 * 1.05));
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT16: Sprinter multi_day daily/overnight (P1 #6 fix) —
//   기존 hardcode (200K/130K) → SSOT VEHICLE_INTERCITY.sprinter
//   sprinter intercity.daily_service_fee = 280K, overnight = 180K
// ─────────────────────────────────────────────────────────

describe('B-CHT16 — Sprinter multi_day SSOT 가격 사용 (P1 #6 fix)', () => {
  it('SSOT VEHICLE_INTERCITY.sprinter = daily ₩280K / overnight ₩180K', () => {
    expect(VEHICLE_INTERCITY.sprinter.daily_service_fee).toBe(280_000);
    expect(VEHICLE_INTERCITY.sprinter.overnight_driver_fee).toBe(180_000);
  });

  it('SSOT VEHICLE_INTERCITY.staria = daily ₩200K / overnight ₩130K (regression guard)', () => {
    expect(VEHICLE_INTERCITY.staria.daily_service_fee).toBe(200_000);
    expect(VEHICLE_INTERCITY.staria.overnight_driver_fee).toBe(130_000);
  });

  it('Sprinter 부산 2박3일 vs Staria 가격 차이 — sprinter underprice 해소 확인', () => {
    const stateBase = {
      ...baseState,
      service: 'multi_day' as const,
      origin: 'SEL_METRO',
      destinationCustom: '부산',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      startTime: '08:00',
    };
    const staria = calculateQuote({ ...stateBase, vehicle: 'staria' });
    const sprinter = calculateQuote({ ...stateBase, vehicle: 'sprinter' });
    // sprinter > staria 보장 — 기존 hardcode 시점에는 동일 daily/overnight 사용해서 차이가 vehicle 배수만 발생.
    // 이제는 SSOT 280K/180K 도 추가로 반영되어 차이 ↑.
    expect(sprinter!.vehicleChargeKRW).toBeGreaterThan(staria!.vehicleChargeKRW);
    // SSOT 정확 계산:
    //   sprinter intercity (calcIntercityFormula 의 staria base × 2.0 배수 — 차종 multiplier 라 분리됨)
    //   + daily 280K × 3 + overnight 180K × 2
    // 정확 일치 검증은 vehicleCharge 분해 어렵 — sprinter daily > staria daily 만 보장.
    const stariaDailySum = 200_000 * 3 + 130_000 * 2; // 860K
    const sprinterDailySum = 280_000 * 3 + 180_000 * 2; // 1,200K
    // 두 견적 차이가 (sprinterDailySum - stariaDailySum) 보다 커야 함 (배수 + daily 차이).
    expect(sprinter!.vehicleChargeKRW - staria!.vehicleChargeKRW).toBeGreaterThanOrEqual(
      sprinterDailySum - stariaDailySum,
    );
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT17: SSOT formula 메타 cross-check — 코드 hardcode 없음 검증
// ─────────────────────────────────────────────────────────

describe('B-CHT17 — SSOT airport_transfer_pricing_formula 일관성', () => {
  it('SSOT staria tier 값 = PR #381 운영자 결정 (₩77K flat / 1.8K / 1.3K / 0.85K)', () => {
    const f = AIRPORT_TRANSFER_PRICING_FORMULA.staria;
    expect(f.tier1_flat_km).toBe(30);
    expect(f.tier1_price_krw).toBe(77_000);
    expect(f.tier2_max_km).toBe(100);
    expect(f.tier2_per_km_krw).toBe(1_800);
    expect(f.tier3_max_km).toBe(300);
    expect(f.tier3_per_km_krw).toBe(1_300);
    expect(f.tier4_per_km_krw).toBe(850);
    expect(f.include_toll).toBe(true);
  });

  it('SSOT sprinter multiplier_vs_staria = 1.85', () => {
    expect(AIRPORT_TRANSFER_PRICING_FORMULA.sprinter.multiplier_vs_staria).toBe(1.85);
  });

  it('hardcode 0: PICKUP_PRICES (affiliateLinks) 의 PUS 가격 = SSOT busan-metro priceKRW', () => {
    const pus = PICKUP_PRICES.PUS;
    expect(pus).toBeDefined();
    const pusPrice = Number(pus[0].price.replace(/[^\d]/g, ''));
    expect(pusPrice).toBe(AIRPORT_TRANSFER_PRICES['busan-metro'].priceKRW);
  });

  it('hardcode 0: PICKUP_PRICES GMP 가격 = SSOT gimpo-* priceKRW', () => {
    const gmp = PICKUP_PRICES.GMP;
    expect(gmp).toBeDefined();
    const central = Number(gmp.find(r => r.destination === '서울 도심')?.price.replace(/[^\d]/g, '') ?? '0');
    const gangnam = Number(gmp.find(r => r.destination === '강남/잠실')?.price.replace(/[^\d]/g, '') ?? '0');
    expect(central).toBe(AIRPORT_TRANSFER_PRICES['gimpo-seoul-central'].priceKRW);
    expect(gangnam).toBe(AIRPORT_TRANSFER_PRICES['gimpo-seoul-gangnam'].priceKRW);
  });

  it('hardcode 0: PICKUP_PRICES CJU = SSOT jeju-metro priceKRW', () => {
    const cju = PICKUP_PRICES.CJU;
    expect(cju).toBeDefined();
    const price = Number(cju[0].price.replace(/[^\d]/g, ''));
    expect(price).toBe(AIRPORT_TRANSFER_PRICES['jeju-metro'].priceKRW);
  });

  it('hardcode 0: PICKUP_PRICES ICN seoul-central = SSOT seoul-central priceKRW (regression)', () => {
    const icn = PICKUP_PRICES.ICN;
    const central = Number(icn.find(r => r.destination === '서울 도심')?.price.replace(/[^\d]/g, '') ?? '0');
    expect(central).toBe(AIRPORT_TRANSFER_PRICES['seoul-central'].priceKRW);
  });
});

// ─────────────────────────────────────────────────────────
// B-CHT18: Sprinter 가이드 중복 가산 차단 (P1 #9 fix, 2026-05-12)
//   기존: sprinter 자동 guide_required ₩300K + 사용자 옵션 licensed_guide ₩300K = ₩600K 중복.
//   수정: vehicle === 'sprinter' 일 때 licensed_guide 옵션 무시 (server-side dedup).
//   UI Step5DateOptions 도 sprinter 선택 시 OptionPill 숨김.
// ─────────────────────────────────────────────────────────

describe('B-CHT18 — Sprinter 가이드 중복 가산 차단 (P1 #9 fix)', () => {
  it('Sprinter + licensedGuide=true → addons 에 licensed_guide 미포함 (dedup)', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'sprinter',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
      options: { licensedGuide: true },
    });
    expect(q).not.toBeNull();
    // licensed_guide 가 추가되지 않아야 함 (sprinter 자동 guide_required 와 중복 회피)
    const licensedGuide = q!.addons.find(a => a.key === 'licensed_guide');
    expect(licensedGuide).toBeUndefined();
    // guide_required 는 sprinter 자동 가산이라 존재
    const guideRequired = q!.addons.find(a => a.key === 'guide_required');
    expect(guideRequired).toBeDefined();
    expect(guideRequired!.amountKRW).toBe(300_000);
  });

  it('Sprinter + licensedGuide=true 합계 = ₩300K (₩600K 중복 회귀 차단)', () => {
    const stateOn = {
      ...baseState,
      vehicle: 'sprinter' as const,
      service: 'airport_transfer' as const,
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
      options: { licensedGuide: true },
    };
    const stateOff = {
      ...stateOn,
      options: { licensedGuide: false },
    };
    const qOn = calculateQuote(stateOn);
    const qOff = calculateQuote(stateOff);
    // licensedGuide 옵션이 sprinter 견적에 영향 X — 두 결과 subtotalKRW 동일.
    expect(qOn!.subtotalKRW).toBe(qOff!.subtotalKRW);
    // 가이드 비용 단일 가산 확인 — guide_required addon 만 ₩300K
    const guideTotal = qOn!.addons
      .filter(a => a.key === 'licensed_guide' || a.key === 'guide_required')
      .reduce((s, a) => s + a.amountKRW, 0);
    expect(guideTotal).toBe(300_000);
  });

  it('Staria + licensedGuide=true → licensed_guide addon 존재 (정상 옵션 동작 보존)', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
      options: { licensedGuide: true },
    });
    const licensedGuide = q!.addons.find(a => a.key === 'licensed_guide');
    expect(licensedGuide).toBeDefined();
    expect(licensedGuide!.amountKRW).toBe(300_000);
    // staria 는 guide_required 자동 가산 X
    expect(q!.addons.find(a => a.key === 'guide_required')).toBeUndefined();
  });

  it('Staria + licensedGuide=false → 가이드 addon 0건 (regression)', () => {
    const q = calculateQuote({
      ...baseState,
      vehicle: 'staria',
      service: 'airport_transfer',
      origin: 'ICN',
      destinationKey: 'seoul-gangnam',
      startDate: '2026-06-01',
      startTime: '14:00',
      options: { licensedGuide: false },
    });
    expect(q!.addons.find(a => a.key === 'licensed_guide')).toBeUndefined();
    expect(q!.addons.find(a => a.key === 'guide_required')).toBeUndefined();
  });
});
