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

/** "HH:mm" → 분. 형식이 아니면 null. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 일정 시각들 → 예약 폼 시작 시각·이용 시간 자동값 (2026-07-27).
 *
 * 💰 durationHours 는 시급×시간이라 **돈에 직결** — 다음 안전 규칙을 지킨다:
 *   - 시각이 1개 이하면 시간은 추정하지 않는다(null → 폼 기본값 유지). 억지 추측 금지.
 *   - 마지막이 첫 시각보다 이르면(자정 넘김/오전오후 오독 의심) 추정 포기 — 조용히
 *     24h 를 더해 부풀리면 과다청구가 된다.
 *   - **올림** (30분 남아도 1시간 청구가 운영 실태) + 하한 min / 상한 max 로 clamp.
 *   - 어디까지나 **입력칸 자동 채움**이고, 실제 청구는 서버가 재계산한다(P311).
 *     운영자가 화면에서 고칠 수 있어야 하므로 호출측은 경고 배지를 함께 노출할 것.
 *
 * @param timeHints 동선 순서대로의 "HH:mm" (빈 문자열 = 시각 없음)
 */
export function deriveScheduleTiming(
  timeHints: string[],
  opts: { minHours: number; maxHours: number },
): { startTime: string | null; durationHours: number | null } {
  const mins = (Array.isArray(timeHints) ? timeHints : [])
    .map(toMinutes)
    .filter((n): n is number => n !== null);
  if (!mins.length) return { startTime: null, durationHours: null };

  const first = mins[0];
  const startTime = `${String(Math.floor(first / 60)).padStart(2, '0')}:${String(first % 60).padStart(2, '0')}`;
  if (mins.length < 2) return { startTime, durationHours: null };

  const last = mins[mins.length - 1];
  if (last <= first) return { startTime, durationHours: null }; // 역전 = 해석 불가, 추정 포기
  const hours = Math.ceil((last - first) / 60);
  return {
    startTime,
    durationHours: Math.min(opts.maxHours, Math.max(opts.minHours, hours)),
  };
}
