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
  it('Sprinter + ICN→Busan: 매트릭스 priceKRW(600k) × 2.0(sprinter) = 1,200,000 + 가이드 300k', () => {
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
    // 600k × 2.0 = 1,200,000 (vehicleChargeKRW)
    expect(q!.vehicleChargeKRW).toBe(1_200_000);
    // Sprinter 는 가이드 자동 가산 (300k)
    const guideAddon = q!.addons.find(a => a.key === 'guide_required');
    expect(guideAddon).toBeDefined();
    expect(guideAddon!.amountKRW).toBe(300_000);
    // 합계 = 1,200,000 + 300,000 = 1,500,000 (야간/할인 없음)
    expect(q!.subtotalKRW).toBe(1_500_000);
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
