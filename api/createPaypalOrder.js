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
import { getPaypalAccessToken } from './_shared/paypal.js';

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

const COMBO_MAP = {
  // 콤보 = (ICN→서울도심 공항픽업) + (당일투어) × 0.9 (10% 콤보 할인)
  combo_airport_seoul:   'seoul-city',
  combo_airport_nami:    'seoul-suburb',
  combo_airport_dmz:     'dmz',
  combo_airport_gangwon: 'gangwon',
  combo_airport_busan:   'busan-day',
};

// AI 플래너 서비스는 전세 가격과 별개 상품 (유료 플래너 $9.90)
const AI_PLANNER_FULL_KRW = 13_300;

function resolveKrwAmount(productType, passengers) {
  if (!SPEC) return null;
  const normalized = productType.replace(/-/g, '_');

  // AI 플래너
  if (normalized === 'ai_planner_full') return AI_PLANNER_FULL_KRW;

  // K-pop 셔틀 — 인원수 곱셈
  if (normalized === 'kpop_shuttle_oneway') {
    return (passengers || 1) * SPEC.kpop_shuttle.price_one_way;
  }
  if (normalized === 'kpop_shuttle_roundtrip') {
    return (passengers || 1) * SPEC.kpop_shuttle.price_round_trip;
  }

  // 당일 전세 투어
  if (CHARTER_MAP[normalized]) {
    return SPEC.daily_tour_prices[CHARTER_MAP[normalized]]?.priceKRW ?? null;
  }

  // 공항 픽업
  if (normalized.startsWith('airport_')) {
    const key = normalized.slice('airport_'.length).replace(/_/g, '-');
    return SPEC.airport_transfer_prices[key]?.priceKRW ?? null;
  }

  // 콤보 패키지
  if (COMBO_MAP[normalized]) {
    const airport = SPEC.airport_transfer_prices['seoul-central']?.priceKRW;
    const tour    = SPEC.daily_tour_prices[COMBO_MAP[normalized]]?.priceKRW;
    if (!airport || !tour) return null;
    return Math.round((airport + tour) * 0.9);
  }

  return null;
}

// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.
const TEST_ACCOUNTS = [];

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

    const { productType, passengers = 1, dateStart = '', dateEnd = '', language = 'en', promoCode, userEmail = '', couponDocId } = body;
    if (!productType) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('productType is required', 'MISSING_FIELDS'))); }

    // AI 플래너 = 디지털 상품 — 모든 쿠폰/프로모 reject (운영자 정책 2026-05-05).
    const normalizedProduct = productType.replace(/-/g, '_');
    if (normalizedProduct.startsWith('ai_planner') && (promoCode || couponDocId)) {
      console.warn('[createPaypalOrder] AI Planner coupon rejected:', { productType, promoCode, couponDocId });
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('AI Planner does not accept coupons', 'AI_PLANNER_NO_COUPON')));
    }

    // 2026-05-03: TEST 계정도 실제 결제는 LIVE PayPal로 진행 (sandbox 분기 제거).
    // TEST 우회는 frontend의 🧪 Test Mode 버튼이 'TEST-' prefix orderId를 직접 보내며,
    // ai-planner-full의 paymentGate가 그걸 받아 PayPal 검증 자체를 skip.
    // 여기서는 sandbox 사용 안 함 — 항상 LIVE order 생성.
    const isSandbox = false;
    void TEST_ACCOUNTS; void userEmail; // 의도적 무시 (PayPal API 호출은 항상 LIVE)
    console.log('[createPaypalOrder] mode: LIVE (always) | email:', userEmail, '| product:', productType);

    let krwAmount = resolveKrwAmount(productType, passengers);
    if (!krwAmount) {
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(`Unknown productType: ${productType}`, 'INVALID_PRODUCT')));
    }

    if (promoCode === 'EARLY50') krwAmount = Math.round(krwAmount * 0.8);

    const { getUsdToKrwRaw } = await import('./_exchange-rate.js');
    const usdToKrw = await getUsdToKrwRaw();
    const usdAmount = (krwAmount / usdToKrw).toFixed(2);

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
