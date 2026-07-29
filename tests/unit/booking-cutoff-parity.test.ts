// 회귀 잠금 (2026-07-28) — 예약 마감 정책.
//
// 운영자 확정: 전세차량(배차만 하면 되는 상품) = 출발 1시간 전 마감 /
//              투어(코스·기사·가이드가 붙는 상품) = 출발 8시간 전 마감.
//
// 이 파일이 잠그는 것:
//  1. 서버 SSOT(api/_shared/booking-cutoff.js)와 프론트 미러(src/lib/bookingCutoff.ts)가
//     **같은 상품 분류·같은 시간**을 낸다 (charter-extras 패리티 테스트와 같은 취지).
//  2. 투어 카탈로그도 결제 시 charter_* 코드로 들어오므로(getTourProductType) 화면이 아니라
//     productType 으로 갈려야 한다.
//  3. 하이픈/언더바 혼용에도 분류가 흔들리지 않는다 (`ai-planner-full` 사고 계열).
//  4. 모르는 코드는 **더 엄격한 8h** 로 떨어진다 (못 채울 예약을 받지 않는 방향).
import { describe, it, expect } from 'vitest';
import {
  getCutoffHours as serverGetCutoffHours,
  isCharterVehicleProduct as serverIsVehicle,
  isPastCutoff as serverIsPastCutoff,
  CHARTER_VEHICLE_CUTOFF_HOURS as SERVER_VEHICLE_H,
  TOUR_CUTOFF_HOURS as SERVER_TOUR_H,
} from '../../api/_shared/booking-cutoff.js';
import {
  getCutoffHours,
  isCharterVehicleProduct,
  isPastCutoff,
  earliestPickupTimeToday,
  todayKstISO,
  CHARTER_VEHICLE_CUTOFF_HOURS,
  TOUR_CUTOFF_HOURS,
} from '@/lib/bookingCutoff';

/** 실제로 결제에 쓰이는 productType 들 (resolveProductType / getTourProductType 실측). */
const VEHICLE_PRODUCTS = [
  'airport_seoul_central', 'airport_gangnam', 'airport-seoul-central',
  'charter_transfer', 'charter_multiday', 'tour_hourly',
  'charter_custom_estimate', 'kpop_shuttle_oneway', 'kpop_shuttle_roundtrip',
];
const TOUR_PRODUCTS = [
  'charter_seoul_city', 'charter_seoul_suburb', 'charter_dmz', 'charter_gangwon',
  'charter_ski', 'charter_gyeongju', 'charter_busan',
  'charter-seoul-city',            // 하이픈 표기
  'tour-seoul-city',               // 투어 카탈로그 id 가 그대로 흘러온 경우
];

describe('booking cutoff — 상수·분류 패리티 (서버 ↔ 프론트)', () => {
  it('마감 시간 상수가 두 곳에서 같다', () => {
    expect(CHARTER_VEHICLE_CUTOFF_HOURS).toBe(SERVER_VEHICLE_H);
    expect(TOUR_CUTOFF_HOURS).toBe(SERVER_TOUR_H);
    expect(CHARTER_VEHICLE_CUTOFF_HOURS).toBe(1);
    expect(TOUR_CUTOFF_HOURS).toBe(8);
  });

  it('전세차량 상품은 양쪽 모두 1시간', () => {
    for (const p of VEHICLE_PRODUCTS) {
      expect(isCharterVehicleProduct(p), `front:${p}`).toBe(true);
      expect(serverIsVehicle(p), `server:${p}`).toBe(true);
      expect(getCutoffHours(p)).toBe(1);
      expect(serverGetCutoffHours(p)).toBe(1);
    }
  });

  it('투어 상품은 양쪽 모두 8시간', () => {
    for (const p of TOUR_PRODUCTS) {
      expect(isCharterVehicleProduct(p), `front:${p}`).toBe(false);
      expect(serverIsVehicle(p), `server:${p}`).toBe(false);
      expect(getCutoffHours(p)).toBe(8);
      expect(serverGetCutoffHours(p)).toBe(8);
    }
  });

  it('모르는 코드·빈 값은 더 엄격한 8시간으로 떨어진다', () => {
    for (const p of ['', null, undefined, 'something_new']) {
      expect(getCutoffHours(p as string)).toBe(8);
      expect(serverGetCutoffHours(p as string)).toBe(8);
    }
  });

  it('tour_hourly(시간제 차터)와 tour-seoul-city(투어)를 혼동하지 않는다', () => {
    // 정규화하면 둘 다 tour_ 로 시작한다 — 명시 집합이 먼저 걸러야 한다.
    expect(getCutoffHours('tour_hourly')).toBe(1);
    expect(getCutoffHours('tour-seoul-city')).toBe(8);
  });
});

describe('booking cutoff — 마감 경계 (KST 고정)', () => {
  // 2026-07-28 (화) 10:00 KST = 2026-07-28T01:00:00Z
  const now = new Date('2026-07-28T01:00:00Z');

  it('전세차량: 61분 남으면 통과 / 59분 남으면 차단', () => {
    // 11:01 KST 출발 = 61분 남음
    expect(isPastCutoff('charter_transfer', '2026-07-28', '11:01', '09:00', now)).toBe(false);
    // 10:59 KST 출발 = 59분 남음
    expect(isPastCutoff('charter_transfer', '2026-07-28', '10:59', '09:00', now)).toBe(true);
  });

  it('투어: 8시간 1분 남으면 통과 / 7시간 59분 남으면 차단', () => {
    expect(isPastCutoff('charter_seoul_city', '2026-07-28', '18:01', '09:00', now)).toBe(false);
    expect(isPastCutoff('charter_seoul_city', '2026-07-28', '17:59', '09:00', now)).toBe(true);
  });

  it('사용자 신고 케이스: 10:00 KST 에 같은 날 07:00 픽업은 선택 불가', () => {
    expect(isPastCutoff('charter_transfer', '2026-07-28', '07:00', '09:00', now)).toBe(true);
    expect(isPastCutoff('charter_seoul_city', '2026-07-28', '07:00', '09:00', now)).toBe(true);
  });

  it('서버와 같은 판정을 낸다 (같은 now 주입)', () => {
    const cases: Array<[string, string, string]> = [
      ['charter_transfer', '2026-07-28', '07:00'],
      ['charter_transfer', '2026-07-28', '11:01'],
      ['charter_seoul_city', '2026-07-28', '17:59'],
      ['charter_seoul_city', '2026-07-29', '09:00'],
      ['airport_seoul_central', '2026-07-28', '10:59'],
    ];
    for (const [pt, d, t] of cases) {
      // 서버는 "> cutoff 시각"(초과), 프론트는 "<= cutoff 시간 남음" 으로 표현만 다르고 경계 동일.
      expect(isPastCutoff(pt, d, t, '09:00', now), `${pt} ${d} ${t}`)
        .toBe(serverIsPastCutoff(d, t, pt, undefined, now));
    }
  });

  it('earliestPickupTimeToday: 마감선 이후로 5분 단위 올림', () => {
    // 전세차량 1h → 10:00 + 1h = 11:00
    expect(earliestPickupTimeToday('charter_transfer', now)).toBe('11:00');
    // 투어 8h → 10:00 + 8h = 18:00
    expect(earliestPickupTimeToday('charter_seoul_city', now)).toBe('18:00');
  });

  it('마감선이 자정을 넘기면 오늘은 선택 불가(null)', () => {
    // 20:00 KST = 11:00Z. 투어 8h → 익일 04:00 → 오늘 안에 남는 시각 없음.
    const evening = new Date('2026-07-28T11:00:00Z');
    expect(earliestPickupTimeToday('charter_seoul_city', evening)).toBeNull();
    // 전세차량 1h → 21:00, 아직 오늘.
    expect(earliestPickupTimeToday('charter_transfer', evening)).toBe('21:00');
  });

  it('todayKstISO 는 UTC 가 아니라 KST 날짜를 준다', () => {
    // 2026-07-28T20:00Z = 2026-07-29 05:00 KST → 한국 기준 29일
    expect(todayKstISO(new Date('2026-07-28T20:00:00Z'))).toBe('2026-07-29');
  });
});
