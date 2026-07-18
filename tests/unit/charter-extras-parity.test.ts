/**
 * charter-extras-parity — 차터 옵션·야간할증 청구(서버) ↔ 표시(프론트) 1:1 파리티 가드.
 *
 * 🔴 2026-07-18 돈버그 fix 회귀 가드: 옵션(면허가이드 ₩300,000·픽켓·카시트)·야간 20% 가
 * 위저드 표시 총액에만 있고 청구(createPaypalOrder/resolve-line-item)에서 통째로 빠지던
 * 과소청구(스크린샷 사례: 표시 ₩424,800 vs 청구 ₩124,800). 서버 정본 = api/_shared/charter-extras.js,
 * 프론트 미러 = src/lib/charterExtras.ts — 두 구현이 같은 금액을 내는지 전 조합 대조.
 */
import { describe, it, expect } from 'vitest';
import spec from '../../src/data/pricing_spec.json';
import {
  isCharterExtrasProduct,
  sanitizeCharterOptions,
  charterExtrasKrw as serverExtras,
} from '../../api/_shared/charter-extras.js';
import { charterExtrasKrw as frontExtras } from '../../src/lib/charterExtras';
import { resolveLineItemKrw } from '../../api/_shared/resolve-line-item.js';

const GUIDE = (spec as { extra_charges: { english_guide_per_day: number } }).extra_charges.english_guide_per_day; // 300,000
const PICKET = (spec as { extra_charges: { airport_picket_service: number } }).extra_charges.airport_picket_service; // 20,000
const SEAT = (spec as { extra_charges: { child_seat_per_trip: number } }).extra_charges.child_seat_per_trip; // 20,000

describe('isCharterExtrasProduct — 적용 상품군', () => {
  it('차터 결제 상품 전부 포함', () => {
    for (const pt of [
      'airport_seoul_central', 'airport_busan_metro',
      'charter_seoul_city', 'charter_seoul_suburb', 'charter_dmz', 'charter_gangwon',
      'charter_ski', 'charter_gyeongju', 'charter_busan',
      'tour_hourly', 'charter_transfer', 'charter_multiday',
      'kpop_shuttle_oneway', 'kpop_shuttle_roundtrip',
    ]) expect(isCharterExtrasProduct(pt), pt).toBe(true);
  });
  it('제외: custom_estimate(이중가산 금지)·combo·AI플래너·투어패키지', () => {
    for (const pt of ['charter_custom_estimate', 'combo_airport_seoul', 'ai_planner_full', 'tour_package_seoul', '', undefined]) {
      expect(isCharterExtrasProduct(pt as string), String(pt)).toBe(false);
    }
  });
});

describe('sanitizeCharterOptions — boolean true 만 신뢰 (위조 입력 방어)', () => {
  it("문자열 'true'·1·객체 → false (과청구 방지 방향)", () => {
    expect(sanitizeCharterOptions({ licensedGuide: 'true', airportPicket: 1, childSeat: {}, night: 'yes' }))
      .toEqual({ licensedGuide: false, airportPicket: false, childSeat: false, night: false });
  });
  it('null/undefined body → 전부 false', () => {
    expect(sanitizeCharterOptions(null)).toEqual({ licensedGuide: false, airportPicket: false, childSeat: false, night: false });
  });
});

describe('서버 charterExtrasKrw — 금액 규칙', () => {
  const CORE = 124_800; // 스크린샷 사례: staria_9 ICN→서울도심
  it('면허가이드 옵션 = +₩300,000 (스크린샷 재현: 124,800 코어 → 424,800 총액)', () => {
    const r = serverExtras(spec, CORE, { vehicle: 'staria_9', options: { licensedGuide: true } });
    expect(r.addonsKRW).toBe(GUIDE);
    expect(CORE + r.totalKRW).toBe(424_800);
  });
  it('sprinter → 가이드 법적 필수 자동 가산 + licensedGuide 무시(이중가산 방지)', () => {
    const r = serverExtras(spec, CORE, { vehicle: 'sprinter', options: { licensedGuide: true } });
    expect(r.addons.map((a: { key: string }) => a.key)).toEqual(['guide_required']);
    expect(r.addonsKRW).toBe(300_000);
  });
  it('야간 = (코어+옵션합)×20% 반올림', () => {
    const r = serverExtras(spec, CORE, { vehicle: 'staria_9', options: { childSeat: true, night: true } });
    expect(r.surchargeKRW).toBe(Math.round((CORE + SEAT) * 0.2));
  });
  it('코어 0/음수/NaN → 전부 0 (안전)', () => {
    for (const bad of [0, -1, NaN, null, undefined]) {
      const r = serverExtras(spec, bad as number, { vehicle: 'staria', options: { licensedGuide: true } });
      expect(r.totalKRW).toBe(0);
    }
  });
});

describe('🔴 파리티 — 서버(청구) == 프론트(표시) 전 조합', () => {
  const CORES = [72_800, 124_800, 249_600, 330_000, 593_000];
  const VEHICLES = ['staria', 'staria_9', 'sprinter'];
  const OPTION_SETS = [
    {},
    { licensedGuide: true },
    { airportPicket: true, childSeat: true },
    { night: true },
    { licensedGuide: true, airportPicket: true, childSeat: true, night: true },
  ];
  it('addonsKRW·surchargeKRW·totalKRW 전 조합 일치', () => {
    for (const core of CORES) {
      for (const vehicle of VEHICLES) {
        for (const options of OPTION_SETS) {
          const s = serverExtras(spec, core, { vehicle, options });
          const f = frontExtras(core, vehicle, options as Parameters<typeof frontExtras>[2]);
          const label = `core=${core} vehicle=${vehicle} opts=${JSON.stringify(options)}`;
          expect(f.addonsKRW, label).toBe(s.addonsKRW);
          expect(f.surchargeKRW, label).toBe(s.surchargeKRW);
          expect(f.totalKRW, label).toBe(s.totalKRW);
          expect(f.addons.map((a) => a.key), label).toEqual(s.addons.map((a: { key: string }) => a.key));
        }
      }
    }
  });
});

describe('cart 경로(resolve-line-item) — 옵션 가산 회귀 가드', () => {
  it('airport 상품 + 면허가이드 옵션 → 코어 + ₩300,000', () => {
    const base = resolveLineItemKrw(spec, { productType: 'airport_seoul_central', passengers: 2, vehicle: 'staria_9' });
    const withGuide = resolveLineItemKrw(spec, {
      productType: 'airport_seoul_central', passengers: 2, vehicle: 'staria_9',
      options: { licensedGuide: true },
    });
    expect(base).toBeGreaterThan(0);
    expect(withGuide).toBe((base as number) + GUIDE);
  });
  it('옵션 없는 booking → 기존 금액 그대로 (하위호환)', () => {
    const a = resolveLineItemKrw(spec, { productType: 'airport_seoul_central', passengers: 2, vehicle: 'staria_9' });
    const b = resolveLineItemKrw(spec, { productType: 'airport_seoul_central', passengers: 2, vehicle: 'staria_9', options: {} });
    expect(b).toBe(a);
  });
  it('픽켓+카시트+야간 조합도 서버 extras 공식과 일치', () => {
    const core = resolveLineItemKrw(spec, { productType: 'charter_seoul_city', passengers: 4, vehicle: 'staria' }) as number;
    const total = resolveLineItemKrw(spec, {
      productType: 'charter_seoul_city', passengers: 4, vehicle: 'staria',
      options: { airportPicket: true, childSeat: true, night: true },
    }) as number;
    const expected = core + PICKET + SEAT + Math.round((core + PICKET + SEAT) * 0.2);
    expect(total).toBe(expected);
  });
});
