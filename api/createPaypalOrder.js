/**
 * Vercel API Route: Create PayPal Order
 * POST /api/createPaypalOrder
 *
 * 가격은 pricing_spec.json(SSOT)에서 해석. sync-pricing 스크립트가 복사한
 * api/_pricing_spec.json을 런타임에 읽는다. 기존 PRODUCT_PRICES 하드코딩 제거됨.
 */
import { Buffer } from 'buffer';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { isPastCutoff, getCutoffHours } from './_shared/booking-cutoff.js';
import { checkAiPlannerCouponPolicy, isAiPlannerProduct } from './_shared/ai-planner-policy.js';
import { acquireSlotLock } from './_shared/slot-capacity.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { resolveMultiDayCheckoutKrw } from './_shared/charter-multiday-price.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { resolveTourCheckoutKrw } from './_shared/tour-price.js';
import { resolveTransferCheckoutKrw } from './_shared/charter-transfer-price.js';
import { getRuntimeFlags } from './_shared/runtime-flags.js';
import { usesFixedUsdRate } from './_shared/usd-rate-policy.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// ── pricing_spec.json 로드 (module-level, cold-start 1회) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
let SPEC = null;
let SPEC_LOAD_ERROR = null;
try {
  SPEC = JSON.parse(readFileSync(join(__dirname, '_pricing_spec.json'), 'utf-8'));
} catch (err) {
  SPEC_LOAD_ERROR = err.message;
  console.error('[createPaypalOrder] spec load failed:', err.message);
}

// ── productType → 가격 해석 ──
const CHARTER_MAP = {
  charter_seoul_city:   'seoul-city',
  charter_seoul_suburb: 'seoul-suburb',
  charter_dmz:          'dmz',
  charter_gangwon:      'gangwon',
  charter_ski:          'ski-resort',
  charter_gyeongju:     'gyeongju-jeonju',
  charter_busan:        'busan-day',
};

// airport_<key>: underscore → hyphen 변환 (예: airport_seoul_central → seoul-central, airport_gapyeong_nami → gapyeong-nami)
// 단, 'seoul_gangnam' → 'seoul-gangnam', 'pyeongchang_yongpyong' → 'pyeongchang-yongpyong'은 모두 underscore → hyphen.

// P1 #10 fix (2026-05-13): COMBO_MAP 하드코딩 제거 — SSOT pricing_spec.json combo_packages
// 단일 source. 콤보 가격 = (airport_key.priceKRW + tour_key.priceKRW) × (1 - discount_percent/100).
// SSOT 키 누락 시 안전 fallback (legacy 배포 환경 호환).
const COMBO_PACKAGES_FALLBACK = {
  combo_airport_seoul:   { airport_key: 'seoul-central', tour_key: 'seoul-city' },
  combo_airport_nami:    { airport_key: 'seoul-central', tour_key: 'seoul-suburb' },
  combo_airport_dmz:     { airport_key: 'seoul-central', tour_key: 'dmz' },
  combo_airport_gangwon: { airport_key: 'seoul-central', tour_key: 'gangwon' },
  combo_airport_busan:   { airport_key: 'seoul-central', tour_key: 'busan-day' },
};
const COMBO_DISCOUNT_PERCENT_FALLBACK = 10;

// AI 플래너 서비스는 전세 가격과 별개 상품 (유료 플래너 $9.90)
const AI_PLANNER_FULL_KRW = 13_300;

function resolveKrwAmount(productType, passengers, durationDays) {
  if (!SPEC) return null;
  const normalized = productType.replace(/-/g, '_');

  // AI 플래너 — 디지털 상품, fixed price (durationDays 무관)
  if (normalized === 'ai_planner_full') return AI_PLANNER_FULL_KRW;

  // K-pop 셔틀 — 인원수 곱셈 (one-way / round-trip 자체가 일자 무관)
  if (normalized === 'kpop_shuttle_oneway') {
    return (passengers || 1) * SPEC.kpop_shuttle.price_one_way;
  }
  if (normalized === 'kpop_shuttle_roundtrip') {
    return (passengers || 1) * SPEC.kpop_shuttle.price_round_trip;
  }

  // 차터/투어 — daily price × 일수.
  // P100 (2026-05-19) fix: 기존엔 `× durationDays` 누락 → multi-day charter 가
  // 1-day 가격으로 결제됨 → 운영자 4-day 무료 손해 (Seoul 5-day = 4×330k 손해).
  // 운영자 정책: charter 는 daily unit rate. 1-day 결제는 durationDays=1 또는
  // undefined fallback 으로 그대로 동작 (backward-compat).
  if (CHARTER_MAP[normalized]) {
    const dailyPrice = SPEC.daily_tour_prices[CHARTER_MAP[normalized]]?.priceKRW;
    if (!dailyPrice) return null;
    // durationDays sanity: 1~30 cap (음수/0/거대 값 차단). undefined 면 1-day.
    const days = Number.isFinite(durationDays) && durationDays >= 1 ? Math.min(30, Math.floor(durationDays)) : 1;
    return dailyPrice * days;
  }

  // 공항 픽업
  if (normalized.startsWith('airport_')) {
    const key = normalized.slice('airport_'.length).replace(/_/g, '-');
    return SPEC.airport_transfer_prices[key]?.priceKRW ?? null;
  }

  // 콤보 패키지 — SSOT combo_packages 우선, 없으면 fallback (legacy 배포 환경 호환)
  // PDF-issue-1 (2026-05-14): per-package discount_percent override 우선 (부산 콤보 5%).
  const ssotCombo = SPEC.combo_packages?.packages?.[normalized];
  const fbCombo = COMBO_PACKAGES_FALLBACK[normalized];
  const combo = ssotCombo || fbCombo;
  if (combo) {
    const airport = SPEC.airport_transfer_prices[combo.airport_key]?.priceKRW;
    const tour    = SPEC.daily_tour_prices[combo.tour_key]?.priceKRW;
    if (!airport || !tour) return null;
    // per-package override > top-level discount_percent > fallback
    const pctValue = (typeof combo.discount_percent === 'number')
      ? combo.discount_percent
      : (SPEC.combo_packages?.discount_percent ?? COMBO_DISCOUNT_PERCENT_FALLBACK);
    return Math.round((airport + tour) * (1 - pctValue / 100));
  }

  return null;
}

// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.
const TEST_ACCOUNTS = [];

// 멀티데이(1박+) 차터 즉시결제 가격 backend SSOT 재계산은 _shared/charter-multiday-price.js 로 이동
// (resolveMultiDayCheckoutKrw — 플래그 + matrix km 조회 + 재계산). ⚠️ FEATURE_MULTIDAY_CHECKOUT
// 플래그 OFF 기본 → prod 멀티데이 즉시결제 비활성(현행 WhatsApp 협의 유지). 운영자가 (1) WhatsApp→
// 즉시결제 정책 전환 결정 + (2) 실 PayPal e2e 검증 후 ON.

// PayPal token + baseUrl resolution moved to api/_shared/paypal.js
// (shared with cancelBooking.js + capturePaypalOrder.js).

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, JSON_CORS); return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED'))); }

  if (!SPEC) {
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(`Pricing spec load failed: ${SPEC_LOAD_ERROR}`, 'SPEC_MISSING')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const { productType, passengers = 1, dateStart = '', dateEnd = '', pickupTime = '', durationDays, language = 'en', promoCode, userEmail = '', couponDocId } = body;
    if (!productType) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('productType is required', 'MISSING_FIELDS'))); }

    // AI 플래너 = 디지털 상품 — 모든 쿠폰/프로모 reject (운영자 정책 2026-05-05).
    // PR #433 (Y-H10): policy 를 api/_shared/ai-planner-policy.js 로 추출 →
    // capturePaypalOrder.js 도 같은 helper 호출 (이전엔 createPaypalOrder 만
    // 검증해서 capture-time 우회 가능했음).
    const aiPlannerGate = checkAiPlannerCouponPolicy({ productType, promoCode, couponDocId });
    if (!aiPlannerGate.ok) {
      console.warn('[createPaypalOrder] AI Planner coupon rejected:', aiPlannerGate.debug);
      res.writeHead(aiPlannerGate.status, JSON_CORS);
      return res.end(JSON.stringify(_err(aiPlannerGate.error, aiPlannerGate.code)));
    }
    const isAiPlanner = isAiPlannerProduct(productType);

    // PR-R (2026-05-08): 예약 마감 정책 검증.
    // - airport / charter / day_tour / kpop_shuttle / tour: 출발 24시간 전 마감
    // - multi_day (durationDays >= 2): 출발 48시간 전 마감
    // - AI 플래너 = 디지털 상품 — 마감 검증 X (즉시 생성, 출발 일정 무관)
    // - charter_custom_estimate: dateStart + pickupTime 있으면 검증 (없으면 skip — 협의 폼)
    if (!isAiPlanner && dateStart) {
      try {
        if (isPastCutoff(dateStart, pickupTime, productType, durationDays)) {
          const cutoffHours = getCutoffHours(productType, durationDays);
          console.warn('[createPaypalOrder] Booking past cutoff:', { productType, dateStart, pickupTime, durationDays, cutoffHours });
          res.writeHead(400, JSON_CORS);
          return res.end(JSON.stringify({
            ok: false,
            error: '예약 마감 시간이 지났습니다. 빠른 예약은 챗 상담을 이용해주세요.',
            code: 'BOOKING_CLOSED',
            cutoffHours,
          }));
        }
      } catch (cutoffErr) {
        // 잘못된 날짜 포맷 등 — 명시적 400 (silent fail 금지).
        console.error('[createPaypalOrder] cutoff check failed:', cutoffErr.message);
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err(`Invalid date/time: ${cutoffErr.message}`, 'INVALID_DATE')));
      }
    }

    // P314 (2026-05-30): sandbox e2e 토글. resolveIsSandbox 이중 가드 (VERCEL_ENV !==
    // 'production' AND PAYPAL_ENV==='sandbox') → prod 는 무조건 LIVE. preview 배포에서만
    // sandbox order 생성 가능 (가짜 미국 buyer e2e). TEST- prefix 우회와는 별개 — 그건
    // paymentGate 가 PayPal 검증 자체를 skip, 이건 진짜 PayPal sandbox API 를 거침.
    const isSandbox = resolveIsSandbox();
    void TEST_ACCOUNTS; void userEmail;
    console.log(`[createPaypalOrder] mode: ${isSandbox ? 'SANDBOX (preview e2e)' : 'LIVE'} | email:`, userEmail, '| product:', productType);

    let krwAmount;
    if (productType === 'charter_multiday') {
      krwAmount = resolveMultiDayCheckoutKrw(SPEC, body, featureEnabled(process.env.FEATURE_MULTIDAY_CHECKOUT));
    } else if (productType === 'tour_hourly') {
      // 투어 시간제(기본 9h + 거리추가 + 오버타임) — VAT·쿠폰 전 순수가. 플래그 OFF 기본(현행 권역 고정가 유지).
      krwAmount = resolveTourCheckoutKrw(SPEC, body, featureEnabled(process.env.FEATURE_TOUR_HOURLY));
    } else if (productType === 'charter_transfer') {
      // 도시간 transfer — backend SSOT 재계산(matrix km, client 불신). 플래그 OFF 기본.
      // 2026-06-06 어드민 조종석: 마진가드는 런타임 토글(admin-runtime-flags) 우선. fail-safe → OFF.
      const _rtFlags = await getRuntimeFlags(initAdminDb('createPaypalOrder-rtflags'));
      krwAmount = resolveTransferCheckoutKrw(SPEC, body, featureEnabled(process.env.FEATURE_TRANSFER_CHECKOUT), { marginGuardEnabled: _rtFlags.transfer_margin_guard_enabled });
    } else {
      krwAmount = resolveKrwAmount(productType, passengers, durationDays);
    }
    if (!krwAmount) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(`Unknown productType: ${productType}`, 'INVALID_PRODUCT')));
    }

    if (promoCode === 'EARLY50') krwAmount = Math.round(krwAmount * 0.8);

    // P108 (2026-05-20): 슬롯 사용 투어 pre-lock — body 에 tourId/tourSlotId/
    // bookingDate/slotCapacity 모두 있으면 PayPal order 생성 전에 capacity
    // 검증 + pending 카운터 증가 (10분 TTL). 결제 진행 중 다른 사용자 동시
    // 같은 슬롯 진입 차단. AI 플래너/charter 등 슬롯 없는 상품은 자동 skip.
    // capturePaypalOrder.js 의 confirmSlotLock 가 결제 확정 시 pending → confirmed
    // 전환. slot-pending-sweep cron 이 10분 후 만료 lock 자동 해제.
    const tourSlotId = typeof body.tourSlotId === 'string' ? body.tourSlotId.trim() : '';
    const tourId = typeof body.tourId === 'string' ? body.tourId.trim() : '';
    const bookingDate = typeof body.bookingDate === 'string' ? body.bookingDate.trim() : dateStart;
    const slotCapacity = Number(body.slotCapacity);
    if (tourSlotId && tourId && bookingDate && Number.isFinite(slotCapacity) && slotCapacity > 0) {
      const adminDb = initAdminDb('createPaypalOrder');
      if (!adminDb) {
        console.warn('[createPaypalOrder] slot pre-lock SKIPPED — adminDb unavailable. tourId:', tourId, 'slot:', tourSlotId);
      } else {
        try {
          await acquireSlotLock({
            adminDb,
            tourId,
            date: bookingDate,
            slotId: tourSlotId,
            pax: passengers,
            capacity: slotCapacity,
            // 실제 PayPal orderId 는 아직 없음. capturePaypalOrder 가 confirmSlotLock
            // 호출 시 같은 slot+date 의 active pending 을 자동 소비 (orderId 매칭
            // 없이도 capacity 검증 + counter 갱신). pre-PayPal 식별자로 임시 사용.
            orderId: `PRELOCK-${Date.now()}-${tourSlotId}`,
          });
          console.log('[createPaypalOrder] slot lock acquired:', { tourId, date: bookingDate, slot: tourSlotId, pax: passengers });
        } catch (slotErr) {
          const code = slotErr.code || 'SLOT_LOCK_FAILED';
          const status = code === 'SLOT_FULL' ? 409
                       : code === 'DATE_UNAVAILABLE' ? 410
                       : 400;
          console.warn('[createPaypalOrder] slot lock rejected:', code, slotErr.message);
          res.writeHead(status, JSON_CORS);
          return res.end(JSON.stringify(_err(slotErr.message, code)));
        }
      }
    }

    // 2026-06-05 (운영자 결정): 차터 전체(ai_planner_full 제외)는 정책 고정환율(charter_usd_fix_rate=1400)로
    //   USD 청구 → live 환율 변동 무관 안정 USD. AI 플래너($9.90)만 live 환율. (프론트 Step6Quote ≈$ 표시도 동일 rate.)
    //   원화 약세장 헤지를 고객 USD 안정으로 이전 — 손익분기 ~1400, 실 환율 높을수록 운영자 KRW 수령 ↑.
    let usdToKrw;
    let roundUsdWhole = false;
    if (usesFixedUsdRate(productType)) {
      usdToKrw = (SPEC && SPEC.charter_usd_fix_rate) || 1400;
      roundUsdWhole = true; // 차터 = 깔끔한 정수 USD ($99·$448). AI 플래너는 센트 단위 유지.
    } else {
      const { getUsdToKrwRaw } = await import('./_exchange-rate.js');
      usdToKrw = await getUsdToKrwRaw();
    }
    const _usdRaw = krwAmount / usdToKrw;
    const usdAmount = (roundUsdWhole ? Math.round(_usdRaw) : _usdRaw).toFixed(2);

    const { accessToken, baseUrl } = await getPaypalAccessToken(isSandbox);
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: usdAmount }, description: `CocoTrip | ${productType} | ${dateStart}~${dateEnd} | ${passengers}명` }],
      }),
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error(order.message ?? 'Order creation failed');

    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({ orderID: order.id, usdAmount, krwAmount, currentRate: Math.round(usdToKrw), displayKRW: krwAmount.toLocaleString('ko-KR') + '원', displayUSD: '$' + usdAmount + ' USD' })));
  } catch (err) {
    console.error('[createPaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
