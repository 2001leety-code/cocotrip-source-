/**
 * MOOD AI 예약 돈 로직 회귀 슬롯 (2026-07-03, PR #1046 소급 검증).
 *
 * 과소청구를 막는 두 판정을 잠근다:
 *   1. exceedsWaypointCap — 경유지 5 초과 시 거리요금 0원 청구 → 예약 차단이어야 한다.
 *   2. shouldSendRoute — 왕복(출발=도착)+경유지 있으면 경로를 보내 거리요금을 청구해야 한다.
 *      (origin!==dest 만 보던 옛 조건은 '집→관광지→집' 왕복에서 거리요금 누락 = 과소청구.)
 */
import { describe, it, expect } from 'vitest';

import { exceedsWaypointCap, shouldSendRoute, deriveScheduleTiming } from '../../src/components/mood/moodBookingLogic';

const LIMITS = { minHours: 3, maxHours: 15 };

describe('exceedsWaypointCap — 경유지 한도(5) 과소청구 방지', () => {
  it('출발+도착만(2) 또는 경유지 5 이하는 허용(false)', () => {
    expect(exceedsWaypointCap(2)).toBe(false); // 경유지 0
    expect(exceedsWaypointCap(5)).toBe(false); // 경유지 3
    expect(exceedsWaypointCap(7)).toBe(false); // 경유지 5 (한도 정확히)
  });

  it('경유지 6개 이상(geoStops 8+)은 차단(true) — 거리요금 조용히 0원 방지', () => {
    expect(exceedsWaypointCap(8)).toBe(true); // 경유지 6
    expect(exceedsWaypointCap(12)).toBe(true);
  });
});

describe('shouldSendRoute — 실이동 경로 전송(과소청구 방지)', () => {
  const A = '서울 강남구 A';
  const B = '인천 강화군 B';

  it('편도(출발≠도착)는 경로 전송(true)', () => {
    expect(shouldSendRoute({ originAddr: A, destAddr: B, usableCount: 2, waypointCount: 0 })).toBe(true);
  });

  it("왕복(출발=도착)이라도 경유지 있으면 경로 전송(true) — '집→관광지→집' 거리요금 누락 방지", () => {
    expect(shouldSendRoute({ originAddr: A, destAddr: A, usableCount: 3, waypointCount: 1 })).toBe(true);
  });

  it('왕복+경유지 없음(제자리)은 전송 안 함(false) — 실이동 없음', () => {
    expect(shouldSendRoute({ originAddr: A, destAddr: A, usableCount: 2, waypointCount: 0 })).toBe(false);
  });

  it('좌표 지점 2 미만이면 전송 안 함(false)', () => {
    expect(shouldSendRoute({ originAddr: A, destAddr: B, usableCount: 1, waypointCount: 0 })).toBe(false);
  });

  it('출발·도착 한쪽이라도 비면 전송 안 함(false) — 서버 400 방지', () => {
    expect(shouldSendRoute({ originAddr: A, destAddr: '', usableCount: 2, waypointCount: 0 })).toBe(false);
    expect(shouldSendRoute({ originAddr: '', destAddr: B, usableCount: 2, waypointCount: 0 })).toBe(false);
  });
});

// 💰 시급×시간이라 이 파생이 틀리면 곧바로 청구 오차 (2026-07-27).
describe('deriveScheduleTiming — 일정 시각 → 시작시각·이용시간 자동값', () => {
  it('첫 시각 = 시작 시각, 마지막−첫 = 이용 시간(올림)', () => {
    expect(deriveScheduleTiming(['09:30', '11:00', '15:00'], LIMITS)).toEqual({ startTime: '09:30', durationHours: 6 });
    // 5시간 30분 → 올림 6시간 (30분 남아도 1시간 청구가 운영 실태)
    expect(deriveScheduleTiming(['09:30', '15:00'], LIMITS)).toEqual({ startTime: '09:30', durationHours: 6 });
    expect(deriveScheduleTiming(['10:00', '14:00'], LIMITS)).toEqual({ startTime: '10:00', durationHours: 4 });
  });

  it('최소 3시간 하한 — 짧은 일정도 3시간 청구 정책과 일치', () => {
    expect(deriveScheduleTiming(['10:00', '11:00'], LIMITS).durationHours).toBe(3);
  });

  it('최대 15시간 상한 — 한도 초과 값이 서버 400 을 유발하지 않게', () => {
    expect(deriveScheduleTiming(['06:00', '23:30'], LIMITS).durationHours).toBe(15);
  });

  it('🔴 시각이 1개뿐이면 시간은 추정하지 않는다(null) — 억지 추측 = 청구 오차', () => {
    expect(deriveScheduleTiming(['09:30'], LIMITS)).toEqual({ startTime: '09:30', durationHours: null });
  });

  it('🔴 마지막이 첫 시각보다 이르면 추정 포기 — 24h 더해 부풀리면 과다청구', () => {
    expect(deriveScheduleTiming(['22:00', '02:00'], LIMITS)).toEqual({ startTime: '22:00', durationHours: null });
    // 같은 시각도 해석 불가
    expect(deriveScheduleTiming(['10:00', '10:00'], LIMITS).durationHours).toBe(null);
  });

  it('시각 없는 stop 은 건너뛰고, 하나도 없으면 둘 다 null(폼 기본값 유지)', () => {
    expect(deriveScheduleTiming(['', '09:00', '', '12:00'], LIMITS)).toEqual({ startTime: '09:00', durationHours: 3 });
    expect(deriveScheduleTiming(['', ''], LIMITS)).toEqual({ startTime: null, durationHours: null });
    expect(deriveScheduleTiming([], LIMITS)).toEqual({ startTime: null, durationHours: null });
  });

  it('형식 깨진 값은 무시 (HH:mm 만 인정)', () => {
    expect(deriveScheduleTiming(['9:30', '15:00'], LIMITS).startTime).toBe('15:00'); // "9:30"=2자리 아님 → 제외
    expect(deriveScheduleTiming(['99:99', '10:00'], LIMITS)).toEqual({ startTime: '10:00', durationHours: null });
  });
});
