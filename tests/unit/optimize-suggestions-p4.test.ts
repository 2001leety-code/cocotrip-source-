// UIUX 가이드 P4 'Edit & Optimize' 최적화 제안 — 순수 로직 회귀.
// 정직 원칙 가드: 좌표 없는 stop 존재 시 Time 제안 금지, 임계 미달 시 무제안.
import { describe, it, expect } from 'vitest';
import {
  suggestTimeOrder,
  suggestWalking,
  suggestTransport,
  buildOptimizeSuggestions,
  type OptimizeStopLike,
} from '../../src/pages/PlanDetailPage/lib/optimizeSuggestions';

// 서울 실좌표 근사 (위도 1도 ≈ 111km) — 남→북 순서가 지그재그인 비효율 일정
const hotel = { category: 'lodging', lat: 37.5600, lng: 126.9800 };
const north = { category: 'landmark', lat: 37.6000, lng: 126.9800 }; // 홀 4.4km 북
const south = { category: 'landmark', lat: 37.5200, lng: 126.9800 }; // 홀 4.4km 남
const north2 = { category: 'landmark', lat: 37.6100, lng: 126.9800 };
const south2 = { category: 'landmark', lat: 37.5100, lng: 126.9800 };

describe('suggestTimeOrder — 방문 순서 최적화', () => {
  it('지그재그 일정 = 개선 제안 + permutation 유효 + 고정 stop 위치 보존', () => {
    // 호텔 → 북 → 남 → 북2 → 남2 (지그재그, 총 ~26km) → 최적은 북·북2 몰아서
    const stops: OptimizeStopLike[] = [hotel, north, south, north2, south2];
    const s = suggestTimeOrder(stops);
    expect(s).not.toBeNull();
    expect(s!.proposedKm).toBeLessThan(s!.currentKm);
    expect(s!.savingPct).toBeGreaterThanOrEqual(15);
    // permutation 검증
    expect([...s!.proposedOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    // 첫 stop(호텔·lodging) 고정
    expect(s!.proposedOrder[0]).toBe(0);
  });

  it('좌표 없는 stop 이 하나라도 있으면 제안 금지 (오제안 방지)', () => {
    const stops: OptimizeStopLike[] = [hotel, north, { category: 'landmark' }, north2, south2];
    expect(suggestTimeOrder(stops)).toBeNull();
  });

  it('이미 효율적인 일정 = 무제안', () => {
    // 남→북 일직선
    const stops: OptimizeStopLike[] = [
      { category: 'lodging', lat: 37.50, lng: 126.98 },
      { category: 'landmark', lat: 37.52, lng: 126.98 },
      { category: 'landmark', lat: 37.54, lng: 126.98 },
      { category: 'landmark', lat: 37.56, lng: 126.98 },
      { category: 'landmark', lat: 37.58, lng: 126.98 },
    ];
    expect(suggestTimeOrder(stops)).toBeNull();
  });

  it('자유 stop 3개 미만 = 무제안', () => {
    const stops: OptimizeStopLike[] = [hotel, north, south];
    expect(suggestTimeOrder(stops)).toBeNull();
  });

  it('lodging/travel/airport 는 재배열 대상 제외 (위치 고정)', () => {
    const middleHotel = { category: 'lodging', lat: 37.5650, lng: 126.9800 };
    const stops: OptimizeStopLike[] = [hotel, north, south, middleHotel, north2, south2];
    const s = suggestTimeOrder(stops);
    if (s) {
      expect(s.proposedOrder[0]).toBe(0);
      expect(s.proposedOrder[3]).toBe(3); // 중간 lodging 위치 보존
    }
  });

  it('중간 anchor(공항)를 넘어 자유 stop 을 당기지 않는다 — 세그먼트 경계 준수 (리뷰 fix)', () => {
    // 리뷰 시나리오: 오후(공항 이후) stop 을 오전으로 당기면 거리는 짧아도 시간적으로 무효.
    // [lodging, B-far, airport, C-nearMorning, D-nearAirport]
    const stops: OptimizeStopLike[] = [
      { category: 'lodging', lat: 37.50, lng: 127.00 },
      { category: 'landmark', lat: 37.60, lng: 127.10 }, // B-far (오전 세그먼트)
      { category: 'airport', lat: 37.46, lng: 126.44 },  // 중간 anchor
      { category: 'landmark', lat: 37.505, lng: 127.004 }, // C (공항 이후 세그먼트, 오전 호텔 근처)
      { category: 'landmark', lat: 37.47, lng: 126.45 },   // D (공항 근처)
    ];
    const s = suggestTimeOrder(stops);
    // 공항(index 2)은 항상 제자리. 자유 stop 은 자기 세그먼트 안에서만 이동.
    if (s) {
      expect(s.proposedOrder[2]).toBe(2); // 공항 anchor 고정
      // C(index 3)와 D(index 4)는 공항 이후 세그먼트 — 오전(index 1)으로 넘어오면 안 됨.
      const morningSlot1 = s.proposedOrder[1];
      expect([1]).toContain(morningSlot1); // 오전 세그먼트엔 B(index 1)만 있음 → 그대로
      // 공항 이후 슬롯(3,4)에는 {3,4}만 배치
      expect([s.proposedOrder[3], s.proposedOrder[4]].sort()).toEqual([3, 4]);
    }
  });

  it('anchor 로 나뉜 각 세그먼트 내부는 최적화한다', () => {
    // 오전 세그먼트에 지그재그 3곳 → 공항 → 오후 1곳. 오전만 재배열되어야.
    const stops: OptimizeStopLike[] = [
      { category: 'lodging', lat: 37.50, lng: 127.00 },
      { category: 'landmark', lat: 37.60, lng: 127.00 }, // 북
      { category: 'landmark', lat: 37.51, lng: 127.00 }, // 남(호텔 근처)
      { category: 'landmark', lat: 37.61, lng: 127.00 }, // 북2
      { category: 'landmark', lat: 37.52, lng: 127.00 }, // 남2
      { category: 'airport', lat: 37.46, lng: 126.44 },
    ];
    const s = suggestTimeOrder(stops);
    if (s) {
      expect(s.proposedOrder[5]).toBe(5); // 공항 고정
      expect([...s.proposedOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});

describe('suggestWalking / suggestTransport — 실측 합산 임계', () => {
  const seg = (transit: NonNullable<OptimizeStopLike['transit_from_prev']>): OptimizeStopLike => ({
    category: 'landmark', transit_from_prev: transit,
  });

  it('도보 2.5km+ 합산 시 walking 제안 (70m/분 환산)', () => {
    const stops = [seg({ total_walk_m: 1400 }), seg({ total_walk_m: 1200 })];
    const s = suggestWalking(stops);
    expect(s).not.toBeNull();
    expect(s!.totalWalkM).toBe(2600);
    expect(s!.totalWalkMin).toBe(Math.round(2600 / 70));
    expect(suggestWalking([seg({ total_walk_m: 2000 })])).toBeNull();
  });

  it('환승 5회+ 합산 시 transport 제안', () => {
    const stops = [seg({ transfers: 2, est_fare_krw: 1500 }), seg({ transfers: 3, est_fare_krw: 1500 })];
    const s = suggestTransport(stops);
    expect(s).not.toBeNull();
    expect(s!.totalTransfers).toBe(5);
    expect(s!.totalFareKrw).toBe(3000);
    expect(suggestTransport([seg({ transfers: 4 })])).toBeNull();
  });

  it('buildOptimizeSuggestions — 타입별 최대 1개, 임계 미달 시 빈 배열', () => {
    expect(buildOptimizeSuggestions([seg({ transfers: 1, total_walk_m: 100 })])).toEqual([]);
    const busy = [
      seg({ transfers: 3, total_walk_m: 1500 }),
      seg({ transfers: 3, total_walk_m: 1500 }),
    ];
    const out = buildOptimizeSuggestions(busy);
    expect(out.map((s) => s.type).sort()).toEqual(['transport', 'walking']);
  });
});
