/**
 * resolve-line-item — 장바구니 라인별 결제 금액 backend SSOT 재계산 (P311).
 *
 * createPaypalOrder.js 의 정본 resolveKrwAmount(L78-129) + dispatch(L205-218) 를
 * 순수 모듈로 복제 — cart(createCartOrder)가 라인마다 동일 공식으로 재계산.
 *
 * ⚠️ 안전 결정 (2026-06-06): createPaypalOrder live 결제 경로를 건드리지 않으려고
 *    dedup(import) 대신 복제 채택. 아래 상수/공식은 createPaypalOrder.js 와 동기 유지 —
 *    resolve-line-item.test.ts 의 source-parity 가드가 상수 divergence 를 잡는다.
 * ⚠️ pricing.js export 의 resolveKrwAmount 는 stale(2-arg, ×durationDays 누락) → 절대 금지.
 *    이 파일은 ×durationDays 포함(P100) — createPaypalOrder 정본과 동일.
 *
 * client items[].priceKRW 완전 불신 — productType + 식별 키만으로 재계산 (변조 차단).
 */
import { resolveMultiDayCheckoutKrw, captainPremiumKrw } from './charter-multiday-price.js';
import { resolveTourCheckoutKrw } from './tour-price.js';
import { resolveTransferCheckoutKrw } from './charter-transfer-price.js';
import { isAiPlannerProduct } from './ai-planner-policy.js';

// ⚠️ createPaypalOrder.js 와 byte-identical 유지 (source-parity 테스트 가드).
export const CHARTER_MAP = {
  charter_seoul_city:   'seoul-city',
  charter_seoul_suburb: 'seoul-suburb',
  charter_dmz:          'dmz',
  charter_gangwon:      'gangwon',
  charter_ski:          'ski-resort',
  charter_gyeongju:     'gyeongju-jeonju',
  charter_busan:        'busan-day',
};
export const COMBO_PACKAGES_FALLBACK = {
  combo_airport_seoul:   { airport_key: 'seoul-central', tour_key: 'seoul-city' },
  combo_airport_nami:    { airport_key: 'seoul-central', tour_key: 'seoul-suburb' },
  combo_airport_dmz:     { airport_key: 'seoul-central', tour_key: 'dmz' },
  combo_airport_gangwon: { airport_key: 'seoul-central', tour_key: 'gangwon' },
  combo_airport_busan:   { airport_key: 'seoul-central', tour_key: 'busan-day' },
};
export const COMBO_DISCOUNT_PERCENT_FALLBACK = 10;
export const AI_PLANNER_FULL_KRW = 13_300;

/**
 * 정본 resolveKrwAmount — createPaypalOrder.js L78-129 와 동일 공식 (SPEC 인자화).
 * @returns {number|null} KRW, 또는 결제 불가(미존재 키 등) 시 null.
 */
export function resolveKrwAmount(SPEC, productType, passengers, durationDays, vehicle) {
  if (!SPEC) return null;
  const normalized = String(productType || '').replace(/-/g, '_');

  // 7인승 캡틴시트 프리미엄 정액(SSOT vehicles.{vehicle}.captain_premium_krw) — createPaypalOrder.js 정본 미러.
  // staria=33,000 / staria_9=0 / 그 외=0. vehicle 미전달 시 0(기존 동작 보존). CHARTER_MAP day-tour + airport 만 가산.
  const captain = captainPremiumKrw(SPEC, vehicle);

  if (normalized === 'ai_planner_full') return AI_PLANNER_FULL_KRW;

  if (normalized === 'kpop_shuttle_oneway' || normalized === 'kpop_shuttle_roundtrip') {
    // 🔴 가격 가드 (createPaypalOrder.js 정본 미러): passengers 를 양의 정수로 정규화 —
    //   소수(0.5→과소청구)·음수·0·NaN 차단. FEATURE_CART 활성화 시 cart 도 동일 보호.
    const pax = Math.max(1, Math.floor(Number(passengers) || 1));
    return pax * (normalized === 'kpop_shuttle_oneway'
      ? SPEC.kpop_shuttle.price_one_way
      : SPEC.kpop_shuttle.price_round_trip);
  }

  // 차터/투어 — daily price × 일수 (P100: ×durationDays 필수).
  if (CHARTER_MAP[normalized]) {
    const dp = SPEC.daily_tour_prices[CHARTER_MAP[normalized]];
    const dailyPrice = dp && dp.priceKRW;
    if (!dailyPrice) return null;
    const days = Number.isFinite(durationDays) && durationDays >= 1 ? Math.min(30, Math.floor(durationDays)) : 1;
    return dailyPrice * days + captain;
  }

  // 공항 픽업
  if (normalized.startsWith('airport_')) {
    const key = normalized.slice('airport_'.length).replace(/_/g, '-');
    const ap = SPEC.airport_transfer_prices[key];
    return ap && ap.priceKRW ? ap.priceKRW + captain : null;
  }

  // 콤보 — SSOT combo_packages 우선, 없으면 fallback. per-package discount_percent override.
  const ssotCombo = SPEC.combo_packages && SPEC.combo_packages.packages && SPEC.combo_packages.packages[normalized];
  const fbCombo = COMBO_PACKAGES_FALLBACK[normalized];
  const combo = ssotCombo || fbCombo;
  if (combo) {
    const apc = SPEC.airport_transfer_prices[combo.airport_key];
    const tpc = SPEC.daily_tour_prices[combo.tour_key];
    const airport = apc && apc.priceKRW;
    const tour = tpc && tpc.priceKRW;
    if (!airport || !tour) return null;
    let pctValue;
    if (typeof combo.discount_percent === 'number') {
      pctValue = combo.discount_percent;
    } else if (SPEC.combo_packages && typeof SPEC.combo_packages.discount_percent === 'number') {
      pctValue = SPEC.combo_packages.discount_percent;
    } else {
      pctValue = COMBO_DISCOUNT_PERCENT_FALLBACK;
    }
    return Math.round((airport + tour) * (1 - pctValue / 100));
  }

  return null;
}

/**
 * 라인 dispatch — createPaypalOrder.js L205-218 와 동일 분기. flag 는 opts 로 주입(순수).
 * @param {object} SPEC
 * @param {object} booking  CartItemBooking (productType + 식별 키)
 * @param {object} [opts]  {multidayEnabled, tourHourlyEnabled, transferEnabled, marginGuardEnabled, discountV2}
 * @returns {number|null}
 */
export function resolveLineItemKrw(SPEC, booking, opts = {}) {
  if (!SPEC || !booking) return null;
  const productType = booking.productType;
  if (!productType) return null;

  if (productType === 'charter_multiday') {
    return resolveMultiDayCheckoutKrw(SPEC, booking, !!opts.multidayEnabled, { discountV2: opts.discountV2 });
  }
  if (productType === 'tour_hourly') {
    return resolveTourCheckoutKrw(SPEC, booking, !!opts.tourHourlyEnabled);
  }
  if (productType === 'charter_transfer') {
    return resolveTransferCheckoutKrw(SPEC, booking, !!opts.transferEnabled, { marginGuardEnabled: opts.marginGuardEnabled, discountV2: opts.discountV2 });
  }
  return resolveKrwAmount(SPEC, productType, booking.passengers, booking.durationDays, booking.vehicle);
}

/**
 * cart 전체 합산 재계산 (P311 SSOT). client priceKRW 무시.
 * - 한 라인이라도 resolve=null/<=0 → 전체 거부 (부분 결제 금지, INVALID_LINE)
 * - AI 플래너 하나라도 → 거부 (MIXED_DIGITAL_PHYSICAL — 환율/쿠폰/생성 트리거 상이)
 * - 빈 cart → EMPTY_CART
 * @returns {{ok:true, totalKRW, lines:Array}|{ok:false, code, productType?}}
 */
export function computeCartTotalKrw(SPEC, items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, code: 'EMPTY_CART' };
  const lines = [];
  for (const item of items) {
    const booking = item && item.booking;
    if (!booking || !booking.productType) return { ok: false, code: 'INVALID_LINE' };
    if (isAiPlannerProduct(booking.productType)) {
      return { ok: false, code: 'MIXED_DIGITAL_PHYSICAL', productType: booking.productType };
    }
    const krw = resolveLineItemKrw(SPEC, booking, opts);
    if (krw == null || !(krw > 0)) {
      return { ok: false, code: 'INVALID_LINE', productType: booking.productType };
    }
    lines.push({ productType: booking.productType, amountKRW: krw, booking });
  }
  const totalKRW = lines.reduce((sum, l) => sum + l.amountKRW, 0);
  return { ok: true, totalKRW, lines };
}
