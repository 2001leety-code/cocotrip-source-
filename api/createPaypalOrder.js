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
import { resolveMultiDayCheckoutKrw, multiDayListBaseKrw, captainPremiumKrw } from './_shared/charter-multiday-price.js';
import { verifyCouponForCharge } from './_shared/coupon-charge.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { resolveTourCheckoutKrw } from './_shared/tour-price.js';
import { resolveTransferCheckoutKrw, transferListBaseKrw } from './_shared/charter-transfer-price.js';
import { fetchTmapCarRouteKm, extractRouteCoords } from './_tmap_car_route.js';
import { applyTotalDiscountCap, TOTAL_DISCOUNT_CAP_PCT } from './_shared/total-discount-cap.js';
import { getRuntimeFlags } from './_shared/runtime-flags.js';
import { usesFixedUsdRate } from './_shared/usd-rate-policy.js';
// charter_custom_estimate (zone-fallback 추정가 즉시결제) SSOT — 상수/판별을 pricing.js 에서
// 직접 import 해 sanity range 가 어드민/스캔(admin-scan-suspect-bookings.js) 과 단일 source 로 유지.
// 하드코딩 시 범위가 drift 되어 한쪽만 바뀌면 정산/차단 기준 불일치 발생.
import { CUSTOM_ESTIMATE_MIN_KRW, CUSTOM_ESTIMATE_MAX_KRW, isCustomEstimateProduct } from './_shared/pricing.js';

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

function resolveKrwAmount(productType, passengers, durationDays, vehicle) {
  if (!SPEC) return null;
  const normalized = productType.replace(/-/g, '_');

  // 7인승 캡틴시트 프리미엄 정액(SSOT vehicles.{vehicle}.captain_premium_krw) — body.vehicle 로 조회.
  // 프론트 resolveProductType.ts(airport/day_tour 패키지 경로) 가 동일 가산 → 표시가==청구가(P311).
  // staria=33,000 / staria_9=0 / 그 외=0. vehicle 미전달(레거시 결제 호출) 시 0 — 기존 동작 보존.
  const captain = captainPremiumKrw(SPEC, vehicle);

  // AI 플래너 — 디지털 상품, fixed price (durationDays 무관)
  if (normalized === 'ai_planner_full') return AI_PLANNER_FULL_KRW;

  // K-pop 셔틀 — 인원수 곱셈 (one-way / round-trip 자체가 일자 무관)
  if (normalized === 'kpop_shuttle_oneway' || normalized === 'kpop_shuttle_roundtrip') {
    // 🔴 가격 가드: passengers 를 양의 정수로 정규화 — 소수(0.5→비례 과소청구)·음수(음수
    //   금액)·0·NaN 차단. (이전 `passengers || 1` 은 0.5·음수를 truthy 로 통과시켰음.)
    const pax = Math.max(1, Math.floor(Number(passengers) || 1));
    return pax * (normalized === 'kpop_shuttle_oneway'
      ? SPEC.kpop_shuttle.price_one_way
      : SPEC.kpop_shuttle.price_round_trip);
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
    // 7인승 캡틴시트 프리미엄 정액 가산 (9인승=0). 프론트 resolveProductType.ts day_tour 패키지 경로와 동일 → P311.
    return dailyPrice * days + captain;
  }

  // 공항 픽업
  if (normalized.startsWith('airport_')) {
    const key = normalized.slice('airport_'.length).replace(/_/g, '-');
    const base = SPEC.airport_transfer_prices[key]?.priceKRW ?? null;
    if (base == null) return null;
    // 7인승 캡틴시트 프리미엄 정액 가산 (9인승=0). 프론트 resolveProductType.ts airport 패키지 경로와 동일 → P311.
    return base + captain;
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

    const { productType, passengers = 1, dateStart = '', dateEnd = '', pickupTime = '', durationDays, language = 'en', promoCode, userEmail = '', couponDocId, couponUserId } = body;
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

    // FEATURE_DISCOUNT_V2 (운영자 2026-06-07): 왕복/다일 5% + 가입 WELCOME 쿠폰 5% = 10%, EARLY50 비활성.
    // OFF(기본) = 현행 동작(다일/왕복 10%, EARLY50 20%, 쿠폰 미적용). 라이브 전 운영자 검토 후 활성화.
    const discountV2 = featureEnabled(process.env.FEATURE_DISCOUNT_V2);
    // 7인승 캡틴시트 프리미엄(staria +33,000) 가산용 — 프론트 PayPalBookingButton 이 charter 결제 시 body.vehicle 전달.
    // staria_9/sprinter/미전달 = +0 (기존 동작 보존). resolveKrwAmount 만 사용(공항/당일패키지 경로); 다른 경로는 자체 spec 조회.
    const bodyVehicle = typeof body.vehicle === 'string' ? body.vehicle.trim() : undefined;

    // FEATURE_CHARTER_WAYPOINTS (경유지 경로기반 가격, 운영자 e2e 후 ON): 플래그 ON + body.routeCoords
    //   (origin/dest 좌표) 있으면 서버가 TMAP 자동차경로로 총 주행거리(경유지 반영)를 직접 재조회(P311,
    //   클라 위조 방어) → routeKm. 아래 charter 가격 함수에 opts.routeKm 으로 주입(경유지 detour 반영).
    //   좌표가 있는데 TMAP 재조회 실패 = 표시가==청구가 보장 불가 → 결제 차단(협의). 좌표 없으면 routeKm=null
    //   → 기존 matrix km 경로 그대로(무경유 예약 = 무영향). 플래그 OFF = 항상 기존 동작.
    const waypointsEnabled = featureEnabled(process.env.FEATURE_CHARTER_WAYPOINTS);
    let routeKm = null;
    if (waypointsEnabled && (productType === 'charter_multiday' || productType === 'charter_transfer')) {
      const coords = extractRouteCoords(body);
      if (coords) {
        const route = await fetchTmapCarRouteKm(coords.origin, coords.dest, coords.waypoints);
        routeKm = route && route.km > 0 ? route.km : null;
        if (routeKm == null) {
          console.warn('[createPaypalOrder] charter waypoint route km unavailable — 결제 차단(표시가==청구가)');
          res.writeHead(502, JSON_CORS);
          return res.end(JSON.stringify(_err('경로 거리 조회에 실패했습니다. 잠시 후 다시 시도하거나 챗 상담을 이용해주세요.', 'ROUTE_KM_UNAVAILABLE')));
        }
      }
    }

    let krwAmount;
    if (productType === 'charter_multiday') {
      krwAmount = resolveMultiDayCheckoutKrw(SPEC, body, featureEnabled(process.env.FEATURE_MULTIDAY_CHECKOUT), { discountV2, routeKm });
    } else if (productType === 'tour_hourly') {
      // 투어 시간제(기본 9h + 거리추가 + 오버타임) — VAT·쿠폰 전 순수가. 플래그 OFF 기본(현행 권역 고정가 유지).
      krwAmount = resolveTourCheckoutKrw(SPEC, body, featureEnabled(process.env.FEATURE_TOUR_HOURLY));
    } else if (productType === 'charter_transfer') {
      // 도시간 transfer — backend SSOT 재계산(matrix km, client 불신). 플래그 OFF 기본.
      // 2026-06-06 어드민 조종석: 마진가드는 런타임 토글(admin-runtime-flags) 우선. fail-safe → OFF.
      const _rtFlags = await getRuntimeFlags(initAdminDb('createPaypalOrder-rtflags'));
      krwAmount = resolveTransferCheckoutKrw(SPEC, body, featureEnabled(process.env.FEATURE_TRANSFER_CHECKOUT), { marginGuardEnabled: _rtFlags.transfer_margin_guard_enabled, discountV2, routeKm });
    } else if (isCustomEstimateProduct(productType)) {
      // charter_custom_estimate = zone-fallback 추정가 즉시결제(운영자 사후 WhatsApp 확정+정산).
      // 가격은 client wizard quote(customAmountKRW). 🔴 sanity range 가드 — pricing.js SSOT 상수
      // (CUSTOM_ESTIMATE_MIN_KRW=30,000 / MAX=10,000,000). 1원·0·NaN·음수·이상 고액 차단.
      // 범위 통과분만 PayPal order 금액으로 사용 → capture 는 PayPal 이 order 금액을 강제하므로 위조 불가.
      const _customRaw = Number(body.customAmountKRW);
      if (Number.isFinite(_customRaw) && _customRaw >= CUSTOM_ESTIMATE_MIN_KRW && _customRaw <= CUSTOM_ESTIMATE_MAX_KRW) {
        krwAmount = Math.round(_customRaw);
      } else {
        console.warn('[createPaypalOrder] charter_custom_estimate customAmountKRW out of range:', body.customAmountKRW);
        res.writeHead(400, JSON_CORS);
        return res.end(JSON.stringify(_err(
          `charter_custom_estimate: customAmountKRW out of range (${CUSTOM_ESTIMATE_MIN_KRW.toLocaleString()}~${CUSTOM_ESTIMATE_MAX_KRW.toLocaleString()} KRW)`,
          'INVALID_AMOUNT',
        )));
      }
    } else {
      // 공항픽업/당일패키지 경로 — bodyVehicle 로 7인승 캡틴시트 프리미엄 가산(staria +33,000 / staria_9·미전달 +0).
      krwAmount = resolveKrwAmount(productType, passengers, durationDays, bodyVehicle);
    }
    // 🔴 음수/0/NaN 금액 차단 — cart(resolve-line-item.js) 와 정합. 이전 `!krwAmount` 는
    //   음수를 truthy 로 통과시켜 PayPal 에 음수/잘못된 금액이 도달할 수 있었다.
    if (!(krwAmount > 0)) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(`Unknown productType or invalid amount: ${productType}`, 'INVALID_PRODUCT')));
    }

    // 총 할인 상한 10% (운영자 정책): 딜(다일/왕복)+쿠폰 합산이 정가의 10% 를 못 넘게 clamp 할
    // 기준선(정가=할인 전). 딜 있는 경로만 별도 산출, 나머지는 청구가가 곧 정가. v2 에서만 사용.
    let listBaseKrw = krwAmount;
    if (discountV2) {
      if (productType === 'charter_multiday') {
        listBaseKrw = multiDayListBaseKrw(SPEC, body, featureEnabled(process.env.FEATURE_MULTIDAY_CHECKOUT), { routeKm }) ?? krwAmount;
      } else if (productType === 'charter_transfer') {
        listBaseKrw = transferListBaseKrw(SPEC, body, featureEnabled(process.env.FEATURE_TRANSFER_CHECKOUT), { discountV2, routeKm }) ?? krwAmount;
      }
    }

    // v2 ON 시 EARLY50 비활성 (운영자 2026-06-07 '일단 끄기'). OFF 시 현행 20%.
    if (!discountV2 && promoCode === 'EARLY50') krwAmount = Math.round(krwAmount * 0.8);

    // v2: WELCOME 개인 쿠폰을 실제 청구가에 적용 (표시=청구 버그 fix). 검증 실패=정가(안전).
    // 소진(isUsed)은 capturePaypalOrder 트랜잭션 락이 담당 — 여기선 할인%만 반영.
    if (discountV2 && couponDocId && couponUserId && !isAiPlanner) {
      const cv = await verifyCouponForCharge(initAdminDb('createPaypalOrder-coupon'), couponUserId, couponDocId, productType);
      if (cv.valid) {
        krwAmount = Math.round(krwAmount * (1 - cv.discountPct / 100));
        console.log('[createPaypalOrder] coupon applied:', couponDocId, cv.discountPct + '%');
      }
    }

    // 🔴 총 할인 상한 10% (운영자 정책 "딜+쿠폰 최대 10%"): 딜+쿠폰 합산이 정가 10% 를 넘으면
    // 정가×0.9 로 floor. v2 에서만 적용(v1/OFF 는 현행 동작 보존 — 회귀 0). 정가 산출 실패 시 skip(안전).
    if (discountV2) {
      const cappedKrw = applyTotalDiscountCap(krwAmount, listBaseKrw, TOTAL_DISCOUNT_CAP_PCT);
      if (cappedKrw !== krwAmount) {
        console.log('[createPaypalOrder] total-discount cap 10% → floored', krwAmount, '→', cappedKrw);
        krwAmount = cappedKrw;
      }
    }

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
    if (!order.id) throw new Error(order.message || 'Order creation failed');

    // SECURITY (버그헌트 #11 2026-06-14): 주문 스냅샷 영속화 → capturePaypalOrder 가 capture-time 클라
    // body 대신 이 스냅샷의 product/pax/date 를 booking 에 사용해 위조(저가결제로 고가서비스 기록) 무력화.
    //
    // 🔴 fail-closed 로 전환 (2026-07-15). 이전엔 best-effort — 쓰기 실패해도 주문을 진행했다.
    //   이제 이 스냅샷이 **결제 provenance 의 유일한 근거**다: AI 플래너 gate 가 "이 주문이 정말
    //   AI 플래너용이고 금액·통화가 맞는가" 를 오직 여기서 확인한다. 따라서 best-effort 를 유지하면
    //   create 시점의 Firestore 깜빡임 하나가 "고객은 결제했는데 상품은 영구 거부"로 이어진다
    //   (게다가 격리 해제 경로가 없다).
    //   → 돈이 움직이기 **전인 주문 생성 시점**에 실패시킨다. 사용자는 안전하게 재시도하면 되고,
    //     캡처되지 않은 PayPal 주문은 무해하게 만료된다. createCartOrder.js 가 이미 동일 정책이다.
    try {
      const _snapDb = initAdminDb('createPaypalOrder-snapshot');
      if (!_snapDb) throw new Error('Firestore unavailable');
      await _snapDb.collection('paypal_order_snapshots').doc(order.id).set({
        productType,
        expectedKRW: krwAmount,
        expectedUSD: usdAmount,
        // PayPal order 는 위에서 항상 USD 로 생성된다(purchase_units amount.currency_code: 'USD').
        // 명시 저장 → gate 가 legacy 기본값 추정에 의존하지 않게 한다.
        expectedCurrency: 'USD',
        passengers,
        durationDays: durationDays || null,
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
        createdAt: new Date().toISOString(),
      });
    } catch (_snapErr) {
      console.error('[createPaypalOrder] order snapshot write failed → 주문 반환 차단(fail-closed):', _snapErr.message);
      res.writeHead(500, JSON_CORS);
      return res.end(JSON.stringify(_err('Order setup failed — please retry', 'SNAPSHOT_FAILED')));
    }

    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({ orderID: order.id, usdAmount, krwAmount, currentRate: Math.round(usdToKrw), displayKRW: krwAmount.toLocaleString('ko-KR') + '원', displayUSD: '$' + usdAmount + ' USD' })));
  } catch (err) {
    console.error('[createPaypalOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
