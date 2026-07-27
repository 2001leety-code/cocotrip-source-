/**
 * MOOD B2B 선불 예약 포털 — 가격 SSOT (Single Source of Truth)
 *
 * 운영자 MOOD brand consulting (매니저업) 이 광고사에 시급 매니저/차량 제공.
 * 광고사는 선불 충전 후 예약마다 잔액에서 차감.
 *
 * 🔴 금액 계산은 무조건 백엔드 (이 모듈) 에서만. 클라이언트가 보낸 amountKRW 는
 *     절대 신뢰하지 않는다 (위조 가능). api/mood-book.js 가 이 함수로 재계산해서
 *     트랜잭션 안에서 잔액 차감 → 클라이언트가 금액을 조작해도 무력화.
 *
 * 단가 (부가세 포함, 원/시간):
 *   - vehicle : 33,000원/시간 (차량)
 *   - airport : 33,000원/시간 (공항) · 2시간 고정 = 66,000 기본 + km + 톨비
 *   - manager : 44,000원/시간 (매니저)
 *
 * ESM — Vercel serverless (api/*) + Vitest 양쪽에서 import 가능.
 */

/** @typedef {'vehicle' | 'airport' | 'manager'} MoodServiceType */

/** 서비스별 시급 (원). 부가세 없음(2026-07-04 운영자 — 기존 33,000/44,000은 부가세 포함가 착오). 순서 = UI 탭 순서(차량/공항/매니저).
 *  ⚠️ airport 는 정액 서비스라 시급 미사용(MOOD_FIXED_PRICE_KRW 참조) — 탭 존재용 placeholder. */
export const MOOD_RATES = Object.freeze({
  vehicle: 30000,
  airport: 30000,
  manager: 40000,
});

/**
 * 공항별 정액 (원) — 공항(airport) 픽업/샌딩은 거리·시간 무관 정액(운영자 2026-06-14).
 * 부가세 없음(운영자 확인 2026-07-04 — 공항은 원래 부가세 없이 책정).
 *   - ICN 인천공항 : 110,000
 *   - GMP 김포공항 :  80,000 (운영자 2026-07-27 — 거리가 짧아 별도 정액)
 * 시급×시간/거리추가/톨비 전부 무시하고 이 정액만 청구.
 */
export const MOOD_AIRPORT_PRICE_KRW = Object.freeze({ ICN: 110000, GMP: 80000 });

/** 공항 코드 표시명 (알림·영수증용). */
export const MOOD_AIRPORT_LABEL = Object.freeze({ ICN: '인천공항', GMP: '김포공항' });

/** 기본 공항 = 인천 — airportCode 미지정(레거시 예약/구 클라이언트)일 때의 값. */
export const MOOD_DEFAULT_AIRPORT_CODE = 'ICN';

/**
 * 정액 서비스 — 공항 기본가(인천). 하위호환용 상수.
 * 🔴 공항별 금액은 MOOD_AIRPORT_PRICE_KRW 가 SSOT. 이 상수는 "airport 는 정액 서비스"
 *    라는 사실과 기본가만 표현한다.
 */
export const MOOD_FIXED_PRICE_KRW = Object.freeze({ airport: MOOD_AIRPORT_PRICE_KRW[MOOD_DEFAULT_AIRPORT_CODE] });

/** 공항 코드 정규화 — 알 수 없는 값/미지정은 전부 기본(인천). 대소문자 무관. */
export function normalizeAirportCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(MOOD_AIRPORT_PRICE_KRW, c) ? c : MOOD_DEFAULT_AIRPORT_CODE;
}

/**
 * serviceType 이 정액 서비스면 그 정액(원), 아니면 null.
 * @param {MoodServiceType} serviceType
 * @param {string} [airportCode] - 'ICN' | 'GMP'. 생략/미지원 코드 = ICN(기본가).
 */
export function fixedPriceFor(serviceType, airportCode) {
  if (serviceType !== 'airport') return null;
  return MOOD_AIRPORT_PRICE_KRW[normalizeAirportCode(airportCode)];
}

/** 예약 1건 최대 시간 (mood-book.js maxDuration 가드와 동일 의미의 비즈 한도). */
export const MOOD_MAX_DURATION_HOURS = 15;

/** 최소 시간 (차량/매니저) — 3시간 고정 base. 3h 미만도 3h 청구, 그 이상만 시간당 추가.
 *  운영자 2026-06-14. 공항(정액)은 무관. */
export const MOOD_MIN_DURATION_HOURS = 3;

/** 유효 서비스 타입인지 검사. */
export function isValidServiceType(serviceType) {
  return serviceType === 'vehicle' || serviceType === 'manager' || serviceType === 'airport';
}

/** 서비스 타입의 시급 (원). 유효하지 않으면 null. */
export function rateForServiceType(serviceType) {
  return isValidServiceType(serviceType) ? MOOD_RATES[serviceType] : null;
}

/**
 * 예약 금액 계산 — rate × hours.
 *
 * @param {MoodServiceType} serviceType - 'vehicle' | 'manager'
 * @param {number} durationHours - 시간 (양의 정수/소수, 0 초과 ~ 15 이하)
 * @returns {{ ok: true, amountKRW: number, ratePerHour: number } | { ok: false, error: string }}
 *
 * 실패 케이스 (호출자가 400 으로 반환):
 *   - 알 수 없는 serviceType
 *   - durationHours 가 숫자 아님 / NaN / 0 이하 / 15 초과
 */
export function computeAmountKRW(serviceType, durationHours, ratePerHourOverride) {
  // 정산 보존(2026-07-04): 요율 개정 후에도 기존 예약은 예약 당시 단가로 정산 —
  // override 가 유효(양수 finite)하면 현행 MOOD_RATES 대신 사용.
  const _ov = Number(ratePerHourOverride);
  const ratePerHour = Number.isFinite(_ov) && _ov > 0 ? _ov : rateForServiceType(serviceType);
  if (ratePerHour === null) {
    return { ok: false, error: `INVALID_SERVICE_TYPE: ${String(serviceType)}` };
  }
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { ok: false, error: 'INVALID_DURATION: must be a positive number' };
  }
  if (hours > MOOD_MAX_DURATION_HOURS) {
    return { ok: false, error: `INVALID_DURATION: max ${MOOD_MAX_DURATION_HOURS}h` };
  }
  // 최소 3시간 고정 — 3h 미만도 3h 청구(그 이상만 시간당 추가). rate × max(3, hours).
  const billableHours = Math.max(MOOD_MIN_DURATION_HOURS, hours);
  const amountKRW = Math.round(ratePerHour * billableHours);
  return { ok: true, amountKRW, ratePerHour };
}

/**
 * 거리 추가요금 — 50km 이상부터 km × 600원 (= 30,000 ÷ 50, 부가세 없음, 비례).
 * 50km 미만 = 0. 운영자 정책 2026-06-12(비례) + 2026-07-04 부가세 제외: 50km=30,000 / 100km=60,000.
 */
export const MOOD_DISTANCE_THRESHOLD_KM = 50;
export const MOOD_SURCHARGE_PER_KM = 600; // 30,000 / 50km (부가세 없음, 2026-07-04)

export function computeDistanceSurchargeKRW(km) {
  const d = Number(km);
  if (!Number.isFinite(d) || d < MOOD_DISTANCE_THRESHOLD_KM) return 0;
  return Math.round(d * MOOD_SURCHARGE_PER_KM);
}

/**
 * 공항 경유 우회거리 추가요금 (2026-07-05 운영자) — 공항 직행은 11만 정액이지만,
 * 경유지가 끼면 직행 대비 늘어난(우회) 거리에 km × 600원. 우회분에는 50km 임계값
 * 없음 — 첫 km부터 과금(정액에 이미 직행 거리가 포함됐고, 추가 이동만 별도라).
 *
 * @param {number} detourKm - 경유포함 실도로거리 − 직행 실도로거리 (음수/0 이면 0).
 */
export function computeAirportDetourSurchargeKRW(detourKm) {
  const d = Number(detourKm);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.round(d * MOOD_SURCHARGE_PER_KM);
}

/**
 * 예약 총액.
 *   - 차량/매니저: 시급×시간(base) + 거리 추가요금(50km↑) + 톨비.
 *   - 공항: 공항별 정액(ICN 110,000 / GMP 80,000) + 경유 우회거리 요금(airportDetourKm × 600, 경유 없으면 0).
 * 전부 부가세 없음(2026-07-04). mood-book.js 가 이 함수로 잔액 차감액을 재계산(클라 금액 무시).
 *
 * @param {{ serviceType: MoodServiceType, durationHours: number, km?: number, tollKRW?: number,
 *           ratePerHourOverride?: number, airportDetourKm?: number, airportCode?: string }} input
 * @returns {{ ok:true, amountKRW, baseKRW, ratePerHour, distanceSurchargeKRW, tollKRW, km } | { ok:false, error }}
 */
export function computeMoodTotalKRW({ serviceType, durationHours, km = 0, tollKRW = 0, ratePerHourOverride, airportDetourKm = 0, airportCode } = {}) {
  // 정액 서비스(공항) — 시간/톨비 무시, 공항별 정액 + 경유 우회거리 요금만.
  if (isValidServiceType(serviceType)) {
    const fixed = fixedPriceFor(serviceType, airportCode);
    if (fixed !== null) {
      const detourSurcharge = computeAirportDetourSurchargeKRW(airportDetourKm);
      const dk = Number.isFinite(Number(airportDetourKm)) ? Math.max(0, Number(airportDetourKm)) : 0;
      return {
        ok: true,
        amountKRW: fixed + detourSurcharge,
        baseKRW: fixed,
        ratePerHour: 0,
        distanceSurchargeKRW: detourSurcharge, // 우회거리 요금 (경유 없으면 0)
        tollKRW: 0,
        km: dk, // 우회 km (직행이면 0)
      };
    }
  }
  const base = computeAmountKRW(serviceType, durationHours, ratePerHourOverride);
  if (!base.ok) return base;
  const distanceSurchargeKRW = computeDistanceSurchargeKRW(km);
  const toll = Math.max(0, Math.round(Number(tollKRW) || 0));
  const kmNum = Number.isFinite(Number(km)) ? Math.max(0, Number(km)) : 0;
  return {
    ok: true,
    amountKRW: base.amountKRW + distanceSurchargeKRW + toll,
    baseKRW: base.amountKRW,
    ratePerHour: base.ratePerHour,
    distanceSurchargeKRW,
    tollKRW: toll,
    km: kmNum,
  };
}
