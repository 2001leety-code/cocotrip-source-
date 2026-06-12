/**
 * createCartOrder — 장바구니(멀티상품) PayPal 주문 생성 (sum-one-order, P311).
 *
 * 라인마다 backend 가 _pricing_spec.json 으로 재계산(client priceKRW 무시) → 합산 →
 * 고정 USD 1400 → PayPal 단일 주문 → cart_orders/{orderID} 스냅샷(capture 가 신뢰할 SSOT).
 *
 * ⚠️ flag OFF(FEATURE_CART) = 404 (현행 무영향). 실 캡처 없음(주문 생성까지) — 돈 안 빠짐.
 *    captureCartOrder(PR2d)가 캡처 + 합계 재검증 + 예약 fan-out.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPaypalAccessToken, resolveIsSandbox } from './_shared/paypal.js';
import { featureEnabled } from './_shared/feature-flag.js';
import { getRuntimeFlags } from './_shared/runtime-flags.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { computeCartTotalKrw } from './_shared/resolve-line-item.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
let SPEC = null;
let SPEC_LOAD_ERROR = null;
try {
  SPEC = JSON.parse(readFileSync(join(__dirname, '_pricing_spec.json'), 'utf-8'));
} catch (err) {
  SPEC_LOAD_ERROR = err.message;
  console.error('[createCartOrder] spec load failed:', err.message);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(405, JSON_CORS); return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED'))); }

  // 플래그 게이트 — OFF 면 cart 결제 비활성 (현행 단건 결제만, 무영향)
  if (!featureEnabled(process.env.FEATURE_CART)) {
    res.writeHead(404, JSON_CORS);
    return res.end(JSON.stringify(_err('Cart checkout not enabled', 'CART_DISABLED')));
  }
  if (!SPEC) {
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(`Pricing spec load failed: ${SPEC_LOAD_ERROR}`, 'SPEC_MISSING')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) { res.writeHead(400, JSON_CORS); return res.end(JSON.stringify(_err('items array required', 'MISSING_ITEMS'))); }

    // 라인별 flag — createPaypalOrder 와 동일 env. transfer 마진가드는 런타임 override(fail-safe OFF).
    const _rtFlags = await getRuntimeFlags(initAdminDb('createCartOrder-rtflags'));
    const opts = {
      multidayEnabled:   featureEnabled(process.env.FEATURE_MULTIDAY_CHECKOUT),
      tourHourlyEnabled: featureEnabled(process.env.FEATURE_TOUR_HOURLY),
      transferEnabled:   featureEnabled(process.env.FEATURE_TRANSFER_CHECKOUT),
      marginGuardEnabled: _rtFlags.transfer_margin_guard_enabled,
      // discountV2 누락 시 cart 라인은 v1 할인(10%)으로 청구되는데 표시가는 v2(5%) → 표시≠청구.
      // createPaypalOrder L208 과 동일 — 모든 호출처는 calc 에 discountV2 를 넘겨야 한다(discountFlags 불변식).
      discountV2:        featureEnabled(process.env.FEATURE_DISCOUNT_V2),
    };

    // P311 SSOT 합산 — client priceKRW 무시, productType+식별키만으로 재계산.
    const computed = computeCartTotalKrw(SPEC, items, opts);
    if (!computed.ok) {
      const msg = computed.code === 'MIXED_DIGITAL_PHYSICAL'
        ? 'AI 플래너는 장바구니 결제 불가 — 단독 결제해주세요.'
        : computed.code === 'EMPTY_CART'
          ? '장바구니가 비어 있습니다.'
          : `결제 불가 상품: ${computed.productType || '(unknown)'}`;
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err(msg, computed.code)));
    }

    // 차터/투어 = 고정 USD 1400 (createPaypalOrder usesFixedUsdRate 정책 동일). 정수 USD.
    const usdToKrw = SPEC.charter_usd_fix_rate || 1400;
    const usdAmount = Math.round(computed.totalKRW / usdToKrw).toFixed(2);

    const isSandbox = resolveIsSandbox();
    console.log(`[createCartOrder] mode: ${isSandbox ? 'SANDBOX' : 'LIVE'} | lines:`, computed.lines.length, '| KRW:', computed.totalKRW);
    const { accessToken, baseUrl } = await getPaypalAccessToken(isSandbox);
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: usdAmount },
          description: `CocoTrip Cart | ${computed.lines.length} items`,
        }],
      }),
    });
    const order = await orderRes.json();
    if (!order.id) throw new Error(order.message || 'Cart order creation failed');

    // cart_orders/{orderID} 스냅샷 — captureCartOrder 가 신뢰할 server 재계산 SSOT.
    // 실패 시 명시 500 (capture 가 합계 검증 불가 → 주문 진행 막음, 안전). 미캡처 주문은 무해.
    try {
      const db = initAdminDb('createCartOrder');
      if (db) {
        const { FieldValue } = await import('firebase-admin/firestore');
        await db.collection('cart_orders').doc(order.id).set({
          orderID: order.id,
          status: 'created',
          totalKRW: computed.totalKRW,
          usdAmount,
          usdRate: usdToKrw,
          lines: computed.lines.map((l, i) => ({
            lineId: `L${i}`,
            productType: l.productType,
            amountKRW: l.amountKRW,
            booking: l.booking,
          })),
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        throw new Error('Firestore unavailable');
      }
    } catch (snapErr) {
      console.error('[createCartOrder] snapshot write failed:', snapErr.message);
      res.writeHead(500, JSON_CORS);
      return res.end(JSON.stringify(_err('Cart order snapshot failed — please retry', 'SNAPSHOT_FAILED')));
    }

    res.writeHead(200, JSON_CORS);
    res.end(JSON.stringify(_ok({
      orderID: order.id,
      usdAmount,
      totalKRW: computed.totalKRW,
      usdRate: usdToKrw,
      lineCount: computed.lines.length,
      displayKRW: computed.totalKRW.toLocaleString('ko-KR') + '원',
      displayUSD: '$' + usdAmount + ' USD',
    })));
  } catch (err) {
    console.error('[createCartOrder] Error:', err);
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
