/**
 * 차터 transfer 가격 backend SSOT + 프론트 일치 가드.
 * 2026-06-05 통일: 옛 km×1500 폐기 → 4-tier(톨 포함) ‖ 매트릭스 priceKRW × 차종 × 편도5%/왕복(×2)10%.
 * 운영자 확정: ICN→강남(priceKRW 145,600) 편도 ₩138,320 / 왕복 ₩262,080. (VAT 는 curatedKRW 에 내장.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  calcTransferQuote as feQuote,
  fourTierStariaKRW as feFourTier,
  curatedStariaKRW as feCurated,
} from '../../src/lib/transferQuote';
import {
  calcTransferQuote as beQuote,
  fourTierStariaKRW as beFourTier,
  curatedStariaKRW as beCurated,
  resolveTransferCheckoutKrw,
} from '../../api/_shared/charter-transfer-price.js';

const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));

describe('calcTransferQuote — 운영자 확정값 (ICN→강남 curatedKRW 145,600)', () => {
  it('편도 staria → 138,320 (145,600 −5%)', () => {
    const q = beQuote({ curatedKRW: 145_600, tripType: 'oneway', vehicle: 'staria' })!;
    expect(q.vehicleBase).toBe(145_600);
    expect(q.tripBase).toBe(145_600);
    expect(q.couponPct).toBe(5);
    expect(q.coupon).toBe(7_280);
    expect(q.total).toBe(138_320);
  });
  it('왕복 staria → 262,080 (145,600 ×2 −10%)', () => {
    const q = beQuote({ curatedKRW: 145_600, tripType: 'roundtrip', vehicle: 'staria' })!;
    expect(q.tripBase).toBe(291_200);
    expect(q.couponPct).toBe(10);
    expect(q.coupon).toBe(29_120);
    expect(q.total).toBe(262_080);
  });
  it('스프린터 ×2 (편도) → 276,640', () => {
    const q = beQuote({ curatedKRW: 145_600, tripType: 'oneway', vehicle: 'sprinter' })!;
    expect(q.vehicleBase).toBe(291_200);
    expect(q.total).toBe(276_640);
  });
  it('bus/vip / 0원 → null', () => {
    expect(beQuote({ curatedKRW: 145_600, tripType: 'oneway', vehicle: 'bus' })).toBeNull();
    expect(beQuote({ curatedKRW: 0, tripType: 'oneway', vehicle: 'staria' })).toBeNull();
  });
});

describe('fourTierStariaKRW — 4-tier + 톨 (VAT 내장)', () => {
  it('tier1 ≤30km flat 77,000 (토클 0)', () => {
    expect(beFourTier(SPEC, 25)).toBe(77_000);
    expect(beFourTier(SPEC, 30)).toBe(77_000);
  });
  it('tier2 65km → 140,000 + 톨 6,500 = 146,500', () => {
    expect(beFourTier(SPEC, 65)).toBe(146_500); // 77,000 + 35×1,800 + 65×100
  });
  it('tier3 120km → 229,000 + 톨 12,000 = 241,000', () => {
    expect(beFourTier(SPEC, 120)).toBe(241_000); // 77,000 + 70×1,800 + 20×1,300 + 120×100
  });
  it('tier4 450km → 590,500 + 톨 67,500 = 658,000', () => {
    expect(beFourTier(SPEC, 450)).toBe(658_000); // ...+ 150×850 + 450×150
  });
});

describe('curatedStariaKRW — priceKRW 우선 ‖ 4-tier 폴백', () => {
  it('큐레이션 zone (priceKRW) 우선: ICN→강남 = 145,600', () => {
    expect(beCurated(SPEC, 'ICN', 'SEL_GANGNAM')).toBe(145_600);
  });
  it('priceKRW 없는 경로 → 4-tier: GMP→SEL_METRO(25km) = 77,000', () => {
    expect(beCurated(SPEC, 'GMP', 'SEL_METRO')).toBe(77_000);
  });
  it('matrix 미존재 → null (협의)', () => {
    expect(beCurated(SPEC, 'ICN', 'VOID_CITY')).toBeNull();
  });
});

describe('transfer 프론트 == 백엔드 (byte-identical 풀파이프라인)', () => {
  // 4-tier 산식 일치
  for (const km of [25, 65, 120, 210, 450]) {
    it(`fourTier ${km}km`, () => {
      expect(feFourTier(km)).toBe(beFourTier(SPEC, km));
    });
  }
  // curated + quote 일치 (실 경로)
  const routes: [string, string][] = [
    ['ICN', 'SEL_GANGNAM'], ['GMP', 'SEL_METRO'], ['SEL_METRO', 'BUSAN'], ['ICN', 'BUSAN'], ['CJU', 'JEJU_METRO'],
  ];
  for (const [o, d] of routes) {
    for (const vehicle of ['staria', 'sprinter']) {
      for (const tripType of ['oneway', 'roundtrip'] as const) {
        it(`${o}→${d} ${vehicle} ${tripType}`, () => {
          const c = feCurated(o, d);
          expect(c).toBe(beCurated(SPEC, o, d));
          if (c == null) return;
          expect(feQuote({ curatedKRW: c, tripType, vehicle })).toEqual(
            beQuote({ curatedKRW: c, tripType, vehicle }),
          );
        });
      }
    }
  }
});

describe('resolveTransferCheckoutKrw — 결제 게이트', () => {
  const body = { originKey: 'ICN', destKey: 'SEL_GANGNAM', tripType: 'oneway', vehicle: 'staria' };
  it('플래그 OFF → null', () => {
    expect(resolveTransferCheckoutKrw(SPEC, body, false)).toBeNull();
  });
  it('플래그 ON + 큐레이션 경로 → 138,320 (편도)', () => {
    expect(resolveTransferCheckoutKrw(SPEC, body, true)).toBe(138_320);
  });
  it('matrix 미존재 → null', () => {
    expect(resolveTransferCheckoutKrw(SPEC, { ...body, destKey: 'VOID' }, true)).toBeNull();
  });
  it('client km/priceKRW 변조 무시 (backend matrix 권위)', () => {
    const honest = resolveTransferCheckoutKrw(SPEC, body, true);
    const tampered = resolveTransferCheckoutKrw(SPEC, { ...body, km: 99999, priceKRW: 1 } as never, true);
    expect(tampered).toBe(honest);
  });
});
