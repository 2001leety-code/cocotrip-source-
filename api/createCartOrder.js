/**
 * createCartOrder — 장바구니(멀티상품) PayPal 주문 생성 (sum-one-order, P311).
 *
 * 라인마다 backend 가 _pricing_spec.json 으로 재계산(client priceKRW 무시) → 합산 →
 * 고정 1350원/USD → 상품별 정수 USD 합산 → PayPal 주문과 cart_orders 스냅샷.
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
import { computeCartTotalKrw, resolveLineItemKrw } from './_shared/resolve-line-item.js';
import { acquireSlotLock, releaseSlotLock, readSlotFields, fetchServerSlotCapacity } from './_shared/slot-capacity.js';
import { toMinorUnits } from './_shared/paypal-capture-verify.js';

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

  // 🔴 슬롯 정원 pre-lock 롤백 대장 — 아래 라인 루프가 잡은 잠금을 기록해 두고,
  //   주문이 성립하지 못한 모든 경로(다음 라인 SLOT_FULL · PayPal 실패 · 스냅샷 실패)에서 되돌린다.
  //   되돌리지 않으면 결제로 이어지지도 않을 pending 이 10분간 남아 다른 손님을 오차단한다.
  //   해제 실패는 치명적이지 않다 — slot-pending-sweep cron 의 TTL 회수가 백스톱.
  const slotLocks = [];
  async function releaseAcquiredSlotLocks(reason) {
    if (slotLocks.length === 0) return;
    console.warn(`[createCartOrder] slot lock rollback (${reason}) — ${slotLocks.length} lock(s)`);
    const pending = slotLocks.splice(0, slotLocks.length);
    await Promise.allSettled(pending.map((l) => releaseSlotLock(l)));
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

    // 🔴 2026-08-08 투어 슬롯 정원 pre-lock (단건 createPaypalOrder 의 형제 경로).
    //   라인 booking 에 tourId·tourSlotId·bookingDate·slotCapacity·passengers 가 전부 있으면
    //   PayPal 주문을 만들기 **전에** capacity 를 검증하고 pending 을 올린다(10분 TTL).
    //   슬롯 없는 상품(차터 등)은 readSlotFields 가 null → 자동 스킵 = 기존 동작 그대로.
    //   선택한 시간대의 서버 가격 조정도 확인한 뒤 단건과 같은 순서로 옵션·야간할증을 계산한다.
    //   confirm(pending → confirmed)은 captureCartOrder 가 결제 확정 후 수행.
    //   booking.slotCapacity 는 "슬롯 상품이다" 신호로만 쓰고, 잠금 기준 정원은 아래에서
    //   서버가 tours/{tourId} 원본으로 재확인한다(2026-08-08 — 단건 createPaypalOrder 와 동시 수리).
    const slotDb = initAdminDb('createCartOrder-slots');
    for (let i = 0; i < computed.lines.length; i++) {
      const slot = readSlotFields(computed.lines[i].booking);
      if (!slot) continue;
      if (!slotDb) {
        await releaseAcquiredSlotLocks('SLOT_VERIFY_FAILED');
        res.writeHead(503, JSON_CORS);
        return res.end(JSON.stringify(_err('Could not verify the selected session — please retry', 'SLOT_VERIFY_FAILED')));
      }
      // 🔴 2026-08-08 서버 정원 재확인 — booking.slotCapacity 는 클라이언트 출처라 부풀릴 수 있다.
      //   원본 tours/{tourId}.slots[] 재조회 값으로만 잠근다(미설정 슬롯 = maxPax 폴백).
      //   검증 실패·Firestore 장애는 앞 라인 잠금을 되돌린 후 거부한다. 검증값은 라인 booking 에
      //   되써서 cart_orders 스냅샷·captureCartOrder(confirmSlotLock)도 같은 값을 쓰게 한다.
      //   형제 경로 createPaypalOrder.js 도 같은 검증(한쪽만 고침 금지 — 각 wiring 테스트가 잠근다).
      let effectiveCapacity = slot.capacity;
      try {
        const verified = await fetchServerSlotCapacity({ adminDb: slotDb, tourId: slot.tourId, slotId: slot.slotId });
        if (!verified.ok) {
          await releaseAcquiredSlotLocks(verified.code);
          console.warn('[createCartOrder] slot capacity verify rejected:', verified.code,
            '| itemIndex:', i, '| tour:', slot.tourId, '| slot:', slot.slotId, '| bodyCapacity:', slot.capacity);
          res.writeHead(409, JSON_CORS);
          return res.end(JSON.stringify({
            ..._err('선택하신 시간대를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.', verified.code),
            itemIndex: i,
          }));
        }
        if (verified.capacity !== slot.capacity) {
          console.warn('[createCartOrder] slot capacity mismatch — 서버 값 사용:',
            { itemIndex: i, tourId: slot.tourId, slot: slot.slotId, bodyCapacity: slot.capacity, serverCapacity: verified.capacity });
        }
        effectiveCapacity = verified.capacity;
        computed.lines[i].booking.slotCapacity = verified.capacity;
        const priceModifierKrw = Number(verified.priceModifierKrw || 0);
        const lineKrw = resolveLineItemKrw(SPEC, computed.lines[i].booking, { ...opts, priceModifierKrw });
        if (!Number.isSafeInteger(priceModifierKrw) || !Number.isSafeInteger(lineKrw) || lineKrw <= 0) {
          await releaseAcquiredSlotLocks('INVALID_SLOT_PRICE');
          res.writeHead(409, JSON_CORS);
          return res.end(JSON.stringify(_err('The selected session price could not be verified', 'INVALID_SLOT_PRICE')));
        }
        computed.totalKRW += lineKrw - computed.lines[i].amountKRW;
        computed.lines[i].amountKRW = lineKrw;
      } catch (verifyErr) {
        console.warn('[createCartOrder] slot verification failed before payment:', verifyErr.message, '| itemIndex:', i);
        await releaseAcquiredSlotLocks('SLOT_VERIFY_FAILED');
        res.writeHead(503, JSON_CORS);
        return res.end(JSON.stringify(_err('Could not verify the selected session — please retry', 'SLOT_VERIFY_FAILED')));
      }
      // 실제 PayPal orderId 는 아직 없다 — 단건 경로와 같은 PRELOCK 식별자 방식.
      // captureCartOrder 의 confirmSlotLock 이 같은 slot+date 의 active pending 을 소비한다.
      const lockOrderId = `CART-PRELOCK-${Date.now()}-${i}-${slot.slotId}`;
      try {
        await acquireSlotLock({
          adminDb: slotDb,
          tourId: slot.tourId,
          date: slot.date,
          slotId: slot.slotId,
          pax: slot.pax,
          capacity: effectiveCapacity,
          orderId: lockOrderId,
        });
        slotLocks.push({
          adminDb: slotDb, tourId: slot.tourId, date: slot.date, slotId: slot.slotId, orderId: lockOrderId,
        });
      } catch (slotErr) {
        const code = slotErr.code || 'SLOT_LOCK_FAILED';
        // 앞 라인이 잡아둔 좌석부터 돌려놓는다 (이 주문은 성립하지 않는다).
        await releaseAcquiredSlotLocks(code);
        const status = code === 'SLOT_FULL' ? 409
                     : code === 'DATE_UNAVAILABLE' ? 410
                     : 400;
        console.warn('[createCartOrder] slot lock rejected:', code, slotErr.message, '| itemIndex:', i);
        res.writeHead(status, JSON_CORS);
        // itemIndex = 프론트가 보낸 items 배열의 위치(computeCartTotalKrw 는 1아이템=1라인 순서 보존).
        //   어떤 상품이 막혔는지 손님에게 이름으로 알려주기 위한 유일한 단서.
        return res.end(JSON.stringify({ ..._err(slotErr.message, code), itemIndex: i }));
      }
    }

    // 상품마다 단건과 같은 정수 USD를 확정한 뒤 합산한다. 장바구니에 담아도 가격이 달라지지 않는다.
    const usdToKrw = SPEC.charter_usd_fix_rate || 1350;
    const lineUsdAmounts = computed.lines.map(line => Math.round(line.amountKRW / usdToKrw).toFixed(2));
    const lineMinor = lineUsdAmounts.map(value => toMinorUnits(value, 'USD'));
    const totalMinor = lineMinor.reduce((sum, value) => sum + (value || 0), 0);
    if (lineMinor.some(value => value === null) || !Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
      await releaseAcquiredSlotLocks('INVALID_LINE_AMOUNT');
      res.writeHead(400, JSON_CORS);
      return res.end(JSON.stringify(_err('Cart amounts are invalid', 'INVALID_LINE_AMOUNT')));
    }
    const usdAmount = (totalMinor / 100).toFixed(2);

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
            amountUSD: lineUsdAmounts[i],
            booking: l.booking,
          })),
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        throw new Error('Firestore unavailable');
      }
    } catch (snapErr) {
      console.error('[createCartOrder] snapshot write failed:', snapErr.message);
      // 이 주문은 캡처 불가(capture 가 스냅샷을 못 읽는다) → 잡아둔 좌석을 붙들고 있을 이유가 없다.
      await releaseAcquiredSlotLocks('SNAPSHOT_FAILED');
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
    // PayPal 주문 생성 실패 등 — 주문이 없으니 잡아둔 좌석도 풀어준다.
    await releaseAcquiredSlotLocks('INTERNAL_ERROR');
    res.writeHead(500, JSON_CORS);
    res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
