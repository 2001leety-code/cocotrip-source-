/**
 * 멀티데이(1박+) 차터 가격 backend 무결 재계산 — P311 SAFETY.
 *
 * 결제 금액은 절대 client priceKRW/km 를 신뢰하지 않는다 (변조 차단).
 * client 는 정규화된 matrix 키(originKey/destKey) + vehicle + durationDays 만 전달하고,
 * backend 가 SSOT(_pricing_spec.json distance_matrix + vehicles.intercity)에서 km 을
 * 직접 조회해 가격을 재계산한다. matrix 에 없는 custom 목적지는 null(결제 불가 → WhatsApp 협의).
 *
 * 프론트 useQuoteCalculator.ts multi_day 분기(L255-287)와 1:1 동일 공식.
 * charter-multiday-price.test.ts 가 프론트 공식 == backend 를 회귀 가드.
 *
 * 공식:
 *   거리부 = round((staria.base_fee + km*2*staria.rate_per_km) * MULT[vehicle])
 *            ⚠️ 거리부는 항상 staria.intercity 상수 × MULT — vehicle.intercity.base_fee/rate_per_km 는
 *               거리계산에 쓰지 않음(프론트 calcIntercityFormula 와 동일). daily/overnight 만 vehicle 별.
 *   운영비 = vehicle.daily_service_fee * days + vehicle.overnight_driver_fee * nights
 *   MULT  = staria 1.0, sprinter 2.0 (프론트 VEHICLE_MULTIPLIER). bus/vip 는 inquiry-only → null.
 */

// 프론트 src/hooks/useQuoteCalculator.ts:38 VEHICLE_MULTIPLIER 와 일치 (결제 가능 차종만).
const VEHICLE_MULTIPLIER = { staria: 1.0, sprinter: 2.0 };

// 운영자 정책 (2026-06-02): 3일(durationDays>=3) 이상 멀티데이 차터 10% 할인.
// 프론트 src/lib/multidayQuote.ts 의 동일 상수와 byte-identical (multiday-quote-frontend-parity.test.ts 가드).
const MULTIDAY_DISCOUNT_MIN_DAYS = 3;
const MULTIDAY_DISCOUNT_PCT = 10;
// FEATURE_DISCOUNT_V2 (운영자 2026-06-07): 다일 기본할인 5% (+ 가입 WELCOME 쿠폰 5% 는 결제 시 별도 가산).
// 플래그 ON 시 resolveMultiDayCheckoutKrw 가 이 값을 calc 에 전달. 프론트 multidayQuote.ts 동일 상수와 parity.
const DISCOUNT_V2_MULTIDAY_PCT = 5;

/**
 * SSOT distance_matrix 에서 origin→dest km 조회. 편도 대칭 가정(프론트 동일, 비대칭 ~5% 허용).
 * client 가 키를 위조해도 matrix 에 실재하는 키쌍 가격만 반환 → 임의 금액 생성 불가.
 * @returns {number|null} km, 또는 matrix 미존재 시 null(결제 불가)
 */
export function lookupMatrixKm(spec, originKey, destKey) {
  if (!spec || !spec.distance_matrix || !originKey || !destKey) return null;
  const m = spec.distance_matrix;
  const fwd = m[`${originKey}→${destKey}`];
  if (fwd && typeof fwd.km === 'number') return fwd.km;
  const rev = m[`${destKey}→${originKey}`];
  if (rev && typeof rev.km === 'number') return rev.km;
  return null;
}

/**
 * 멀티데이 차터 결제 금액(KRW) 재계산. 프론트 견적과 byte-identical 해야 함.
 * @param {object} spec  _pricing_spec.json
 * @param {{vehicle:string, km:number, durationDays:number}} args
 * @returns {number|null} 결제 금액, 또는 결제 불가 조건(차종/거리 무효) 시 null
 */
export function calcMultiDayCharterKrw(spec, { vehicle, km, durationDays, discountPct = MULTIDAY_DISCOUNT_PCT } = {}) {
  if (!spec || !spec.vehicles || !spec.vehicles.staria || !spec.vehicles.staria.intercity) return null;
  const mult = VEHICLE_MULTIPLIER[vehicle];
  if (!mult) return null; // staria/sprinter 만 즉시결제 가능 (bus/vip = inquiry-only)
  if (!Number.isFinite(km) || km <= 0) return null; // km 변조/누락 방어

  const sIc = spec.vehicles.staria.intercity;
  const distancePart = Math.round((sIc.base_fee + km * 2 * sIc.rate_per_km) * mult);

  const vIc = spec.vehicles[vehicle] && spec.vehicles[vehicle].intercity;
  if (!vIc) return null;

  const days = Math.min(30, Math.max(1, Math.floor(Number(durationDays) || 1))); // 1~30 cap
  const nights = Math.max(0, days - 1);

  const base = distancePart + vIc.daily_service_fee * days + vIc.overnight_driver_fee * nights;
  // 3일 이상 할인 (기본 10% / v2 5%). discountPct 는 호출처가 플래그에 따라 전달, 기본값=현행 10% (하위호환).
  return days >= MULTIDAY_DISCOUNT_MIN_DAYS ? Math.round(base * (1 - discountPct / 100)) : base;
}

/**
 * 결제 핸들러용 게이트 — 플래그 + matrix 조회 + 가격 재계산을 한 곳에서.
 * client body 에서 originKey/destKey/vehicle/durationDays 만 사용(priceKRW/km 무시 = 변조 차단).
 * @param {object} spec  _pricing_spec.json
 * @param {object} body  결제 요청 body
 * @param {boolean} featureEnabled  FEATURE_MULTIDAY_CHECKOUT (운영자 플래그). false 면 null(현행 WhatsApp 유지).
 * @returns {number|null} 결제 금액, 또는 비활성/미존재 시 null
 */
export function resolveMultiDayCheckoutKrw(spec, body, featureEnabled, opts = {}) {
  if (!featureEnabled) return null; // 플래그 OFF = 멀티데이 즉시결제 비활성 (운영자 정책 + 실 e2e 후 ON)
  if (!body) return null;
  const originKey = typeof body.originKey === 'string' ? body.originKey.trim() : '';
  const destKey   = typeof body.destKey === 'string' ? body.destKey.trim() : '';
  const vehicle   = typeof body.vehicle === 'string' ? body.vehicle.trim() : '';
  const km = lookupMatrixKm(spec, originKey, destKey);
  if (km == null) return null; // matrix 미존재 custom 목적지 → 결제 불가(협의)
  // FEATURE_DISCOUNT_V2 ON → 다일 기본할인 5% (기본 10%). 쿠폰 5% 는 createPaypalOrder 가 별도 가산.
  const discountPct = opts.discountV2 ? DISCOUNT_V2_MULTIDAY_PCT : MULTIDAY_DISCOUNT_PCT;
  return calcMultiDayCharterKrw(spec, { vehicle, km, durationDays: body.durationDays, discountPct });
}

export { VEHICLE_MULTIPLIER as MULTIDAY_VEHICLE_MULTIPLIER };
