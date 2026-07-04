/**
 * MOOD AI 예약 — 돈 관련 순수 판정 로직 (과소청구 방지).
 *
 * 컴포넌트(MoodAiBooking)에서 뽑아 테스트와 로직을 공유(파생, 중복 아님).
 * 이 두 판정이 잘못되면 거리요금이 조용히 누락되어 과소청구가 발생하므로
 * unit 잠금테스트로 회귀를 막는다(tests/unit/mood-booking-logic.test.ts).
 */

/**
 * 경유지(출발·도착 제외 중간 지점) 최대 5개 초과 여부.
 * 네이버 경로 API 한도(5) 초과 시 거리요금이 base-only(0원)로 조용히 청구되므로
 * true 면 예약을 차단해야 한다(과소청구 방지). geoStops = 좌표 있는 지점 수.
 */
export function exceedsWaypointCap(geoStopCount: number): boolean {
  return geoStopCount - 2 > 5;
}

/**
 * 서버에 실이동 경로(거리요금 재계산용 origin/destination/waypoints)를 보낼지.
 *
 * ⚠️ 왕복(출발지=도착지)이어도 경유지가 있으면 실제 이동거리가 발생한다.
 *    origin!==dest 조건만 쓰면 '집→관광지→집' 왕복에서 거리요금이 통째로 누락(과소청구).
 *    실이동 판정 = 좌표 있는 지점 2곳 이상이고 (다른 목적지 OR 경유지 존재).
 *    origin·destination 은 함께 있어야 서버가 거리 재계산(한쪽만이면 서버 400).
 */
export function shouldSendRoute(args: {
  originAddr: string;
  destAddr: string;
  usableCount: number;
  waypointCount: number;
}): boolean {
  const { originAddr, destAddr, usableCount, waypointCount } = args;
  return (
    !!originAddr &&
    !!destAddr &&
    usableCount >= 2 &&
    (originAddr !== destAddr || waypointCount > 0)
  );
}
