/**
 * MOOD 캘린더 — 동일 시간대 겹침 계산 (순수 함수, UI/네트워크 의존 없음).
 *
 * ⚠️ 운영자 결정(2026-07-02): 일정 "충돌 경고"(빨간 뱃지/경고 아이콘)는 구현 금지 —
 *    현재 예약 스키마에 managerId/vehicleId 가 없어 "충돌"을 정의할 수 없음.
 *    허용 범위는 캘린더의 "동일 시간대 예약 수" 수준의 중립(회색/보라) 표시까지만.
 *    필드 설계·구현 지점: docs/MOOD-CONFLICT-DETECTION-TODO.md
 */

export interface OverlapBooking {
  /** "HH:MM" — 없거나 형식 불량이면 겹침 계산에서 제외. */
  startTime?: string;
  /** 시간 단위 — 0 이하/비수치면 제외. */
  durationHours?: number;
}

/** "HH:MM"(또는 "H:MM") → 자정 기준 분. 형식 불량/범위 밖이면 null. */
export function parseStartMinutes(startTime: unknown): number | null {
  if (typeof startTime !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * 같은 날 예약 목록의 "최대 동시간대 건수".
 * - 구간 = [start, start + durationHours×60) 반열림 — 10:00~13:00 과 13:00 시작은 겹침 아님.
 * - startTime 없음/형식 불량, durationHours ≤ 0 인 예약은 계산에서 제외.
 * - 반환: 유효 예약 0건 = 0, 겹침 없음 = 1, 겹침 있음 = 최대 동시 건수(≥2).
 */
export function maxConcurrentCount(bookings: ReadonlyArray<OverlapBooking> | null | undefined): number {
  const events: Array<{ at: number; delta: number }> = [];
  for (const b of bookings || []) {
    const start = parseStartMinutes(b?.startTime);
    const dur = Number(b?.durationHours);
    if (start === null || !Number.isFinite(dur) || dur <= 0) continue;
    events.push({ at: start, delta: +1 });
    events.push({ at: start + dur * 60, delta: -1 });
  }
  if (events.length === 0) return 0;
  // 같은 시각이면 종료(-1)를 시작(+1)보다 먼저 처리 — 반열림 구간이라 "맞닿음"은 겹침 아님.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let max = 0;
  for (const e of events) {
    current += e.delta;
    if (current > max) max = current;
  }
  return max;
}
