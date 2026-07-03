/**
 * MOOD AI 예약 돈 로직 회귀 슬롯 (2026-07-03, PR #1046 소급 검증).
 *
 * 과소청구를 막는 두 판정을 잠근다:
 *   1. exceedsWaypointCap — 경유지 5 초과 시 거리요금 0원 청구 → 예약 차단이어야 한다.
 *   2. shouldSendRoute — 왕복(출발=도착)+경유지 있으면 경로를 보내 거리요금을 청구해야 한다.
 *      (origin!==dest 만 보던 옛 조건은 '집→관광지→집' 왕복에서 거리요금 누락 = 과소청구.)
 */
import { describe, it, expect } from 'vitest';

import { exceedsWaypointCap, shouldSendRoute } from '../../src/components/mood/moodBookingLogic';

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
