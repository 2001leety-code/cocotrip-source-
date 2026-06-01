// transitVsCharter.ts -- Pure comparison module: transit vs charter 일일 비교 계산
// PR-C3 (2026-06-01): 대중교통 합산 vs 차터 일일가 2-컬럼 비교 데이터를 계산.
//
// WARNING: firebase/React/환경변수 import 금지. 순수 함수만.
// vitest 에서 직접 import 가능 (CI firebase crash 없음).
//
// 플래그: VITE_FEATURE_TRANSIT_VS_CHARTER === 'true' (string)
// OFF(미설정) -> null 반환 (카드 미노출, 현재 동작 byte-identical).

/** 비교 계산에 필요한 stop transit 필드 최소 타입 */
export interface TransitSegmentLike {
  method?: string;
  est_min?: number;
  transfers?: number;
  est_fare_krw?: number;
  [key: string]: unknown;
}

/** 비교에 필요한 stop 최소 타입 */
export interface StopLikeForComparison {
  transit_from_prev?: TransitSegmentLike;
}

/** 하루 대중교통 합계 */
export interface DayTransitSummary {
  /** T-money 환승/지하철/버스 총 이동 시간(분) */
  totalMin: number;
  /** 환승 횟수 총합 */
  totalTransfers: number;
  /** 교통비 총합 (T-money 기준, KRW) */
  totalFareKrw: number;
  /** 대중교통(subway/bus) 구간 수 */
  publicTransitCount: number;
}

/** 차터 일일 가격 데이터 최소 타입 */
export interface CharterPricingLike {
  priceKRW: number;
  hours?: number;
  en?: string;
  ko?: string;
}

/** 비교 카드에서 렌더할 계산 결과 */
export interface TransitVsCharterComparison {
  transit: DayTransitSummary;
  charter: {
    dailyPriceKrw: number;
    perPersonKrw: number;
    hours?: number;
    label?: string;
  };
  /** 차터 절감 시간 (분). transit.totalMin - door-to-door estimate.
   *  door-to-door = transit.totalMin * 0.45 (환승 없음, 직행 기준 45% 감소 경험칙).
   *  timeSavedMin < 5 이면 표시 안 함. */
  timeSavedMin: number;
}

/**
 * 하루 stops 에서 대중교통 합계를 계산.
 * subway/bus 로 분류된 구간만 합산.
 * 데이터 부족(모든 구간 transit_from_prev 없음) 시 totalMin=0, publicTransitCount=0.
 */
export function sumDayTransit(stops: StopLikeForComparison[]): DayTransitSummary {
  let totalMin = 0;
  let totalTransfers = 0;
  let totalFareKrw = 0;
  let publicTransitCount = 0;

  for (const stop of stops) {
    const t = stop.transit_from_prev;
    if (!t) continue;
    const method = String(t.method || '').toLowerCase();
    const isPublic = method === 'subway' || method === 'bus' || method === 'transit';
    if (isPublic) {
      publicTransitCount += 1;
    }
    // 시간/환승/요금은 모든 transit 구간 합산 (도보 제외, public만)
    if (isPublic) {
      totalMin += typeof t.est_min === 'number' ? t.est_min : 0;
      totalTransfers += typeof t.transfers === 'number' ? t.transfers : 0;
      totalFareKrw += typeof t.est_fare_krw === 'number' ? t.est_fare_krw : 0;
    }
  }

  return { totalMin, totalTransfers, totalFareKrw, publicTransitCount };
}

/**
 * transit + charter 데이터에서 비교 객체를 계산.
 * 데이터 부족(대중교통 구간 없거나 차터 요금 없음) 시 null.
 */
export function computeTransitVsCharter(
  stops: StopLikeForComparison[],
  charterPricing: CharterPricingLike | null | undefined,
  pax: number,
): TransitVsCharterComparison | null {
  if (!charterPricing || charterPricing.priceKRW <= 0) return null;
  if (!stops || stops.length === 0) return null;

  const transit = sumDayTransit(stops);
  if (transit.publicTransitCount === 0) return null;

  const dailyPriceKrw = charterPricing.priceKRW;
  const safePax = pax > 0 ? pax : 1;
  const perPersonKrw = Math.round(dailyPriceKrw / safePax);

  // door-to-door 절감: 차터는 환승 없이 직행 → transit 총 시간의 ~55% 소요 추정
  // timeSavedMin = transitTime - charterTime = transitTime * 0.45
  const timeSavedMin = Math.round(transit.totalMin * 0.45);

  return {
    transit,
    charter: {
      dailyPriceKrw,
      perPersonKrw,
      hours: charterPricing.hours,
      label: charterPricing.en || charterPricing.ko,
    },
    timeSavedMin,
  };
}

/**
 * feature flag 확인.
 * VITE_FEATURE_TRANSIT_VS_CHARTER === 'true' (string strict) 일 때만 true.
 * SSR / plain Node.js: false.
 * featureEnabled override 가 전달되면 그 값을 사용 (테스트용).
 */
export function isTransitVsCharterEnabled(featureEnabled?: boolean): boolean {
  if (featureEnabled !== undefined) return featureEnabled;
  if (typeof import.meta === 'undefined') return false;
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.VITE_FEATURE_TRANSIT_VS_CHARTER || '') === 'true';
}
