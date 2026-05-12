/**
 * 가격 해석 SSOT — productType → KRW.
 *
 * 2026-05-03: createPaypalOrder.js 와 (legacy) braintreeCheckout.js 두 곳에서 동일
 * 로직 사용하도록 추출. 이전엔 createPaypalOrder.js 내부 함수만 있어서 ai-planner-full
 * 외 다른 productType (charter, airport_transfer, kpop_shuttle, combo) 지원이 빠져
 * 있었음. 2026-05-07 Braintree 제거 후엔 createPaypalOrder.js 단일 호출자.
 *
 * 데이터 출처: api/_pricing_spec.json (sync-pricing 스크립트가 src/data/pricing_spec.json
 * 에서 복사). 변경 시 양쪽 동기화 필요.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _spec = null;
let _specError = null;

export function loadPricingSpec() {
  if (_spec) return _spec;
  if (_specError) return null;
  try {
    _spec = JSON.parse(readFileSync(join(__dirname, '..', '_pricing_spec.json'), 'utf-8'));
    return _spec;
  } catch (err) {
    _specError = err.message;
    console.error('[pricing] spec load failed:', err.message);
    return null;
  }
}

// productType → spec key 변환 매핑 (createPaypalOrder.js 와 1:1 동일 유지)
const CHARTER_MAP = {
  charter_seoul_city:   'seoul-city',
  charter_seoul_suburb: 'seoul-suburb',
  charter_dmz:          'dmz',
  charter_gangwon:      'gangwon',
  charter_ski:          'ski-resort',
  charter_gyeongju:     'gyeongju-jeonju',
  charter_busan:        'busan-day',
};

// P1 #10 fix (2026-05-13): COMBO_MAP 하드코딩 제거 — SSOT pricing_spec.json combo_packages 단일 source.
// 콤보 가격 = (airport_key.priceKRW + tour_key.priceKRW) × (1 - discount_percent/100).
// SSOT 키 누락 시 안전 fallback (legacy 배포 환경 호환).
const COMBO_PACKAGES_FALLBACK = {
  combo_airport_seoul:   { airport_key: 'seoul-central', tour_key: 'seoul-city' },
  combo_airport_nami:    { airport_key: 'seoul-central', tour_key: 'seoul-suburb' },
  combo_airport_dmz:     { airport_key: 'seoul-central', tour_key: 'dmz' },
  combo_airport_gangwon: { airport_key: 'seoul-central', tour_key: 'gangwon' },
  combo_airport_busan:   { airport_key: 'seoul-central', tour_key: 'busan-day' },
};
const COMBO_DISCOUNT_PERCENT_FALLBACK = 10;

// AI 플래너 가격 정책 (2026-05-05 운영자 확정 — Option B):
//   정가 (originalKRW)     : ₩26,600 / $19.90
//   Launch promo (-50%)    : -₩13,300
//   최종 결제 (finalKRW)    : ₩13,300 / $9.90
//
// 마케팅 카피 "첫 100명 한정 50% OFF" 는 광고용 — 실제 카운트 enforcement 없음
// (계속 50% 할인 적용). 정가/할인 분리 기록은 Firestore booking 의
// originalAmountKRW + launchDiscountKRW 에 저장 (영수증·어드민 리포트용).
//
// AI 플래너는 디지털 상품 = 사용자 쿠폰/Trip Coins 모두 reject (PR #269 정책).
// 이 launch promo 와 사용자 쿠폰 결합 안 됨.
const AI_PLANNER_FULL_KRW = 13_300;
export const AI_PLANNER_FULL_ORIGINAL_KRW = 26_600;
export const AI_PLANNER_LAUNCH_DISCOUNT_RATE = 0.50;
export const AI_PLANNER_LAUNCH_LABEL = 'Launch Special — 첫 100명 한정 50% OFF';

// 2026-05-04 URGENT-1 fix: zone fallback 추정가 결제용 productType. 매트릭스에 없는
// 장거리(부산 등)나 ICN 외 공항 출발도 wizard quote가 산출됐으면 결제 가능하게 함.
// 가격은 productType 하드코딩이 아니라 client가 전달한 customAmountKRW 사용 —
// 호출처(createPaypalOrder)에서 sanity range 체크 후 적용.
export const CUSTOM_ESTIMATE_PRODUCT = 'charter_custom_estimate';
export const CUSTOM_ESTIMATE_MIN_KRW = 30_000;     // 최소 결제 가드 (사기성 1원 결제 차단)
export const CUSTOM_ESTIMATE_MAX_KRW = 10_000_000; // 차량 투어 1회 상한 (관리자 검토 임계치)

export function isCustomEstimateProduct(productType) {
  if (!productType) return false;
  return String(productType).replace(/-/g, '_') === CUSTOM_ESTIMATE_PRODUCT;
}

/**
 * 사용자/어드민에게 표시되는 productType 라벨. 이메일·텔레그램·바우처 등 사람이 읽는
 * 표면에서 raw productType 키 (charter_custom_estimate 등) 대신 친화적 문구를 노출.
 *
 * 2026-05-04: charter_custom_estimate 만 우선 매핑 (오늘 신규 도입). 나머지 productType
 * 의 raw 키 노출은 기존 wart — 별도 PR 에서 일괄 정리 권장.
 *
 * @param {string|undefined} productType
 * @returns {string} 사람이 읽는 라벨
 */
export function productDisplayLabel(productType) {
  if (!productType) return 'CocoTrip Service';
  if (isCustomEstimateProduct(productType)) {
    return 'Custom Charter (Estimate — pending reconciliation)';
  }
  return String(productType);
}

/**
 * @param {string} productType
 * @param {number} passengers
 * @returns {number|null} KRW (정수) 또는 null (해석 실패 — 호출처에서 400 처리)
 */
export function resolveKrwAmount(productType, passengers) {
  const spec = loadPricingSpec();
  if (!spec || !productType) return null;
  const normalized = productType.replace(/-/g, '_');

  if (normalized === 'ai_planner_full') return AI_PLANNER_FULL_KRW;

  // charter_custom_estimate — body의 customAmountKRW 사용. 호출처가 직접 처리하므로
  // 여기선 null 반환 (호출처가 isCustomEstimateProduct로 분기 후 별도 처리).
  if (normalized === CUSTOM_ESTIMATE_PRODUCT) return null;

  // K-pop 셔틀 — 인원수 곱셈
  if (normalized === 'kpop_shuttle_oneway') {
    return (passengers || 1) * spec.kpop_shuttle.price_one_way;
  }
  if (normalized === 'kpop_shuttle_roundtrip') {
    return (passengers || 1) * spec.kpop_shuttle.price_round_trip;
  }

  // 당일 전세 투어
  if (CHARTER_MAP[normalized]) {
    return spec.daily_tour_prices[CHARTER_MAP[normalized]]?.priceKRW || null;
  }

  // 공항 픽업 (airport_seoul_central → seoul-central 변환)
  if (normalized.startsWith('airport_')) {
    const key = normalized.slice('airport_'.length).replace(/_/g, '-');
    return spec.airport_transfer_prices[key]?.priceKRW || null;
  }

  // 콤보 패키지 — SSOT combo_packages 우선, 없으면 fallback
  // PDF-issue-1 (2026-05-14): per-package discount_percent override 우선 (부산 콤보 5%).
  const ssotCombo = spec.combo_packages?.packages?.[normalized];
  const fbCombo = COMBO_PACKAGES_FALLBACK[normalized];
  const combo = ssotCombo || fbCombo;
  if (combo) {
    const airport = spec.airport_transfer_prices[combo.airport_key]?.priceKRW;
    const tour    = spec.daily_tour_prices[combo.tour_key]?.priceKRW;
    if (!airport || !tour) return null;
    // per-package override > top-level discount_percent > fallback
    const pctValue = (typeof combo.discount_percent === 'number')
      ? combo.discount_percent
      : (spec.combo_packages?.discount_percent ?? COMBO_DISCOUNT_PERCENT_FALLBACK);
    return Math.round((airport + tour) * (1 - pctValue / 100));
  }

  return null;
}
