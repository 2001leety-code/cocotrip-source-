/**
 * MOOD 경로별 일정 계약.
 *
 * 경로 주소는 booking.breakdown(origin/waypoints/destination)이 SSOT이고,
 * routeSchedule은 같은 순서의 도착·재출발 시각만 보관한다. 금액·이용시간
 * 계산에는 사용하지 않는 운영 메타데이터다.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MOOD_ROUTE_SCHEDULE_MAX_STOPS = 7;
export const MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES = 15 * 60;

function minutesOf(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function normalizeTime(value) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const normalized = value.trim();
  return TIME_RE.test(normalized)
    ? { ok: true, value: normalized }
    : { ok: false };
}

/**
 * routeSchedule을 Firestore에 넣을 수 있는 화이트리스트 모양으로 정규화한다.
 *
 * - undefined: 기존 예약 호환을 위한 "미제공"
 * - 첫 지점: 도착 없음, 재출발 = 예약 시작시각
 * - 마지막 지점: 재출발 없음
 * - 알려진 시각들은 일정 순서대로이며 자정은 한 번만 넘을 수 있음
 */
export function normalizeMoodRouteSchedule(raw, stopCount, startTime) {
  if (raw === undefined) {
    return { ok: true, provided: false, value: null };
  }
  if (
    !Number.isInteger(stopCount)
    || stopCount < 0
    || stopCount > MOOD_ROUTE_SCHEDULE_MAX_STOPS
    || !TIME_RE.test(String(startTime || ''))
    || !Array.isArray(raw)
    || raw.length !== stopCount
  ) {
    return { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
  }
  if (stopCount === 0) {
    return raw.length === 0
      ? { ok: true, provided: true, value: [] }
      : { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
  }

  const normalized = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
    }
    const arrival = normalizeTime(entry.arrivalTime);
    const pickup = normalizeTime(entry.pickupTime);
    if (!arrival.ok || !pickup.ok) {
      return { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
    }
    normalized.push({
      arrivalTime: arrival.value,
      pickupTime: pickup.value,
    });
  }

  if (
    normalized[0].arrivalTime !== null
    || normalized[0].pickupTime !== startTime
    || normalized[normalized.length - 1].pickupTime !== null
  ) {
    return { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
  }

  let firstKnownMinutes = null;
  let previousMinutes = null;
  let dayOffset = 0;
  let crossedMidnight = false;
  for (const stop of normalized) {
    for (const time of [stop.arrivalTime, stop.pickupTime]) {
      if (time === null) continue;
      let absoluteMinutes = minutesOf(time) + dayOffset;
      if (previousMinutes !== null && absoluteMinutes < previousMinutes) {
        if (crossedMidnight) {
          return { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
        }
        crossedMidnight = true;
        dayOffset += 24 * 60;
        absoluteMinutes = minutesOf(time) + dayOffset;
      }
      if (previousMinutes !== null && absoluteMinutes < previousMinutes) {
        return { ok: false, error: 'INVALID_ROUTE_SCHEDULE' };
      }
      if (firstKnownMinutes === null) firstKnownMinutes = absoluteMinutes;
      previousMinutes = absoluteMinutes;
    }
  }

  if (
    firstKnownMinutes !== null
    && previousMinutes !== null
    && previousMinutes - firstKnownMinutes > MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES
  ) {
    return { ok: false, error: 'INVALID_ROUTE_SCHEDULE_SPAN' };
  }

  return { ok: true, provided: true, value: normalized };
}
