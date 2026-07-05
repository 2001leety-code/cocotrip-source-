/**
 * MOOD 포털 — 프론트 가격 미러 (표시용 예상 금액 계산).
 *
 * 🔴 백엔드 SSOT = api/_shared/mood-pricing.js. 이 파일은 "예상 금액 실시간 표시"
 *     UX 용 미러일 뿐이며, 실제 청구/잔액 차감은 항상 백엔드 computeMoodTotalKRW 가
 *     재계산한다 (api/mood-book.js). 두 단가/공식은 반드시 동일하게 유지할 것.
 */

export type MoodServiceType = 'vehicle' | 'airport' | 'manager';

/** 서비스별 시급 (원). 부가세 포함. 백엔드 MOOD_RATES 와 동일해야 함. 순서=UI 탭 순서. */
export const MOOD_RATES: Record<MoodServiceType, number> = {
  vehicle: 30000,
  airport: 30000,
  manager: 40000,
};

export const MOOD_MAX_DURATION_HOURS = 15;

/** 최소 시간 (차량/매니저) — 3시간 고정 base. 백엔드 MOOD_MIN_DURATION_HOURS 와 동일. */
export const MOOD_MIN_DURATION_HOURS = 3;

/**
 * 정액 서비스 — 공항 픽업/샌딩은 거리·시간 무관 110,000원 고정. 백엔드 MOOD_FIXED_PRICE_KRW 와 동일.
 * (UI 는 이 서비스 선택 시 시간/거리 표시를 숨기고, 백엔드는 정액만 청구.)
 */
export const MOOD_FIXED_PRICE_KRW: Partial<Record<MoodServiceType, number>> = {
  airport: 110000,
};

/** serviceType 이 정액 서비스면 그 정액(원), 아니면 null. */
export function fixedPriceFor(serviceType: MoodServiceType): number | null {
  const fixed = MOOD_FIXED_PRICE_KRW[serviceType];
  return fixed === undefined ? null : fixed;
}

/**
 * 거리 추가요금 — 50km 이상부터 km × 600원 (= 30,000 ÷ 50, 부가세 없음, 비례).
 * 50km 미만 = 0. 백엔드 mood-pricing.js 와 동일 공식이어야 함 (운영자 2026-06-12).
 */
export const MOOD_DISTANCE_THRESHOLD_KM = 50;
export const MOOD_SURCHARGE_PER_KM = 600; // 30,000 / 50km (부가세 없음, 2026-07-04)

export function computeDistanceSurchargeKRW(km: number): number {
  const d = Number(km);
  if (!Number.isFinite(d) || d < MOOD_DISTANCE_THRESHOLD_KM) return 0;
  return Math.round(d * MOOD_SURCHARGE_PER_KM);
}

/**
 * 공항 경유 우회거리 추가요금 (2026-07-05) — 백엔드 mood-pricing.js 와 동일 공식.
 * 공항 직행은 정액이지만 경유지가 끼면 직행 대비 늘어난 거리에 km × 600원 (임계값 없음).
 */
export function computeAirportDetourSurchargeKRW(detourKm: number): number {
  const d = Number(detourKm);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.round(d * MOOD_SURCHARGE_PER_KM);
}

/** 예상 금액 (원). 표시 전용 — 실제 청구는 백엔드 재계산. (base = 시급×시간) */
export function estimateMoodAmountKRW(serviceType: MoodServiceType, durationHours: number): number {
  // 정액 서비스(공항)는 시간 무관 정액.
  const fixed = fixedPriceFor(serviceType);
  if (fixed !== null) return fixed;
  const rate = MOOD_RATES[serviceType] || 0;
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  // 최소 3시간 고정 (백엔드 SSOT 와 동일).
  const billableHours = Math.max(MOOD_MIN_DURATION_HOURS, hours);
  return Math.round(rate * billableHours);
}

export interface MoodTotalBreakdown {
  ok: boolean;
  amountKRW: number;
  baseKRW: number;
  ratePerHour: number;
  distanceSurchargeKRW: number;
  tollKRW: number;
  km: number;
}

/**
 * 예상 총액 = 시급×시간(base) + 거리 추가요금(50km↑) + 톨비. 전부 부가세 포함.
 *
 * 🔴 백엔드 SSOT = api/_shared/mood-pricing.js computeMoodTotalKRW 와 동일 공식.
 *     이 미러는 "예상 금액 실시간 표시" UX 용일 뿐, 실제 청구/잔액 차감은 항상
 *     백엔드가 재계산한다 (클라이언트가 보낸 amountKRW 는 무시). 두 공식은 반드시
 *     일치하게 유지할 것 — tests/unit/mood-pricing-mirror.test.ts 가 동등성 검증.
 *
 * 표시 전용이므로 invalid 입력은 throw 하지 않고 base(또는 0) 로 안전 폴백.
 */
export function computeMoodTotalKRW(input: {
  serviceType: MoodServiceType;
  durationHours: number;
  km?: number;
  tollKRW?: number;
  airportDetourKm?: number;
}): MoodTotalBreakdown {
  const { serviceType, durationHours, km = 0, tollKRW = 0, airportDetourKm = 0 } = input;
  // 정액 서비스(공항) — 정액 + 경유 우회거리 요금(경유 없으면 0). 백엔드 SSOT 와 동일.
  const fixed = fixedPriceFor(serviceType);
  if (fixed !== null) {
    const detourSurcharge = computeAirportDetourSurchargeKRW(airportDetourKm);
    const dk = Number.isFinite(Number(airportDetourKm)) ? Math.max(0, Number(airportDetourKm)) : 0;
    return { ok: true, amountKRW: fixed + detourSurcharge, baseKRW: fixed, ratePerHour: 0, distanceSurchargeKRW: detourSurcharge, tollKRW: 0, km: dk };
  }
  const ratePerHour = MOOD_RATES[serviceType] || 0;
  const baseKRW = estimateMoodAmountKRW(serviceType, durationHours);
  const distanceSurchargeKRW = computeDistanceSurchargeKRW(km);
  const toll = Math.max(0, Math.round(Number(tollKRW) || 0));
  const kmNum = Number.isFinite(Number(km)) ? Math.max(0, Number(km)) : 0;
  return {
    ok: baseKRW > 0,
    amountKRW: baseKRW + distanceSurchargeKRW + toll,
    baseKRW,
    ratePerHour,
    distanceSurchargeKRW,
    tollKRW: toll,
    km: kmNum,
  };
}

export function formatKRW(n: number): string {
  return `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
}
