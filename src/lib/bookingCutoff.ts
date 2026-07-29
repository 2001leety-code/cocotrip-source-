/**
 * 예약 마감 정책 — 프론트 미러 (2026-07-28).
 *
 * 백엔드 정본 = api/_shared/booking-cutoff.js.
 * 위저드(Step5DateOptions)·투어 다이얼로그(TourBookingDialog)가 **서버와 같은 값으로**
 * 날짜/시각을 잠그도록 여기 한 곳에서 파생시킨다. 두 벌로 흩어져 있던 상수(12h 하드코딩)
 * 때문에 화면은 경고만 띄우고 결제는 통과되던 어긋남이 있었다.
 *
 * ⚠️ 변경 시 백엔드와 동기 필수 — tests/unit/booking-cutoff-parity.test.ts 가 가드.
 */

/** 전세차량 마감 (시간). 배차만 하면 되는 상품. */
export const CHARTER_VEHICLE_CUTOFF_HOURS = 1;
/** 투어 마감 (시간). 코스·기사·가이드 준비가 필요한 상품. */
export const TOUR_CUTOFF_HOURS = 8;

/**
 * 전세차량(=차량 배차형) 상품 집합. 없으면 투어(더 엄격한 8h)로 본다.
 * 백엔드 CHARTER_VEHICLE_EXACT 와 1:1.
 */
const CHARTER_VEHICLE_EXACT = new Set([
  'charter_transfer',
  'charter_multiday',
  'tour_hourly',
  'charter_custom_estimate',
  'kpop_shuttle_oneway',
  'kpop_shuttle_roundtrip',
]);

function normalizeProductType(productType: string | null | undefined): string {
  return String(productType || '').toLowerCase().replace(/-/g, '_');
}

/** 전세차량 상품인가? (아니면 투어) */
export function isCharterVehicleProduct(productType: string | null | undefined): boolean {
  const pt = normalizeProductType(productType);
  if (!pt) return false;
  if (CHARTER_VEHICLE_EXACT.has(pt)) return true;
  if (pt.startsWith('airport_')) return true;
  return false;
}

/** 상품별 마감 시간(시간 단위). */
export function getCutoffHours(productType: string | null | undefined): number {
  return isCharterVehicleProduct(productType) ? CHARTER_VEHICLE_CUTOFF_HOURS : TOUR_CUTOFF_HOURS;
}

/**
 * 출발까지 남은 시간(시간 단위). KST(+09:00) 고정 해석 — 사용자 브라우저 시간대와 무관하게
 * 서버와 같은 값이 나온다.
 * @param date YYYY-MM-DD (KST 출발일)
 * @param time HH:mm (KST 픽업 시각). 없으면 fallback 사용.
 * @param fallbackTime 시각 입력이 없는 상품(투어)의 기본 출발 시각.
 * @returns 남은 시간. 날짜가 잘못됐으면 Infinity(=차단하지 않음, 다른 검증에 맡김).
 */
export function hoursUntilDeparture(
  date: string,
  time?: string,
  fallbackTime = '09:00',
  now: Date = new Date(),
): number {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.POSITIVE_INFINITY;
  const hhmm = time && /^\d{2}:\d{2}$/.test(time) ? time : fallbackTime;
  const departure = new Date(`${date}T${hhmm}:00+09:00`);
  if (Number.isNaN(departure.getTime())) return Number.POSITIVE_INFINITY;
  return (departure.getTime() - now.getTime()) / 3_600_000;
}

/**
 * 마감이 지났는가? (서버 isPastCutoff 와 동일 판정)
 * 화면은 이 함수로 **선택·결제를 잠근다** — 경고만 띄우고 통과시키지 않는다.
 */
export function isPastCutoff(
  productType: string | null | undefined,
  date: string,
  time?: string,
  fallbackTime = '09:00',
  now: Date = new Date(),
): boolean {
  const left = hoursUntilDeparture(date, time, fallbackTime, now);
  if (!Number.isFinite(left)) return false;
  return left <= getCutoffHours(productType);
}

/**
 * 오늘(KST) 날짜에서 아직 선택 가능한 가장 이른 시각 "HH:mm".
 * 지난 시각이 그대로 선택되던 문제(7/28 오전 7시 선택 가능)의 차단선.
 * 오늘 안에 남는 시각이 없으면 null → 호출부가 그 날짜를 통째로 막는다.
 */
export function earliestPickupTimeToday(
  productType: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const cutoffMs = getCutoffHours(productType) * 3_600_000;
  // KST 벽시계로 환산 후 분 단위 올림 (UTC 필드가 KST 시각이 되도록 +9h shift).
  const kst = new Date(now.getTime() + 9 * 3_600_000 + cutoffMs);
  const minutes = kst.getUTCMinutes();
  const rounded = new Date(kst.getTime() + (minutes % 5 === 0 ? 0 : (5 - (minutes % 5)) * 60_000));
  const nowKstDay = new Date(now.getTime() + 9 * 3_600_000).getUTCDate();
  if (rounded.getUTCDate() !== nowKstDay) return null; // 마감선이 내일로 넘어감 → 오늘 불가
  return `${String(rounded.getUTCHours()).padStart(2, '0')}:${String(rounded.getUTCMinutes()).padStart(2, '0')}`;
}

/** KST 기준 오늘 날짜 "YYYY-MM-DD" — <input type="date"> 의 min 값. */
export function todayKstISO(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`;
}
