/**
 * /api/admin-payment-reviews — capture 무결성 격리(payment_reviews) 운영자 큐.
 *   GET  → 미해결 격리 목록 (resolvedAt == null, 최신순).
 *   POST { orderID, resolution, auditNote? } → 해결 **기록**.
 *
 * ## 범위 — 기록만. 실행 없음.
 * 이 엔드포인트는 **환불도 확정도 실행하지 않는다.** resolution 을 기록할 뿐이고, 그 기록을
 * paymentGate 가 읽어 이행 여부를 판정한다(isReviewFulfillable).
 *
 * 왜 실행 버튼이 없나: 환불 멱등키(PayPal-Request-Id)가 방금 들어갔지만 **실 PayPal 로는 아직
 * 미검증**이다(sandbox 운영자 확인 대기). 검증 안 된 환불 경로를 운영자 원클릭에 노출하면
 * 그 결함이 곧바로 돈 경로가 된다. 실제 환불은 기존 admin-booking-action 의 mark-refunded 로.
 *
 * ## 왜 필요한가
 * 이전엔 resolution writer 가 코드베이스에 아예 없었다 → 격리 해제 = Firebase 콘솔 수동 편집뿐.
 * 정상 결제인데 오격리된 고객을 풀어줄 제품 표면이 없었다.
 *
 * ## 왜 서버 경유인가
 * firestore.rules 의 payment_reviews 는 `allow write: if false` — **운영자라도** 클라 쓰기 금지
 * (금액·해결상태를 클라에서 조작할 수 있으면 격리의 의미가 없다). 읽기는 isAdminEmail() 로
 * 허용되지만, admin-* 관례를 따라 읽기도 엔드포인트를 경유한다(claim 으로 승격된 운영자는
 * rules 의 이메일 하드코딩에 막히므로 엔드포인트 경유가 더 정확하다).
 *
 * 신규 코드 규약: nullish coalescing 금지, OR 사용.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { PAYMENT_REVIEW_RESOLUTION, resolvePaymentReview } from './_shared/payment-review.js';

export const config = { maxDuration: 15 };
const CORS_METHODS = 'GET,POST,OPTIONS';
const MAX_QUEUE = 50;

function json(req, res, status, body) {
  res.writeHead(status, {
    ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }),
    // 돈 상태 큐 — 중간 캐시가 옛 목록을 주면 운영자가 이미 해결한 건을 다시 보거나 그 반대.
    'Cache-Control': 'no-store',
  });
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });

  const db = initAdminDb('admin-payment-reviews');
  if (!db) return json(req, res, 503, { error: 'Firestore not configured', code: 'DB_UNAVAILABLE' });

  try {
    if (req.method === 'GET') {
      // ⚠️ 정렬은 메모리에서 — where + orderBy 조합은 복합 인덱스가 필요해 런타임
      //   FAILED_PRECONDITION 이 난다(firestore.indexes.json 에 payment_reviews 인덱스 없음).
      //   admin-decisions.js 와 동일한 관례.
      // ⚠️ resolvedAt == null 은 **명시적 null 값**만 매칭한다(필드 자체가 없는 문서는 안 잡힘).
      //   recordPaymentReview 가 신규 문서에 항상 resolvedAt:null 을 심으므로 정상 데이터는 안전.
      //   콘솔에서 수동으로 필드를 지운 문서는 이 큐에서 조용히 사라진다 — 알려진 한계.
      const snap = await db.collection('payment_reviews').where('resolvedAt', '==', null).limit(MAX_QUEUE).get();
      const items = snap.docs.map((d) => {
        const v = d.data() || {};
        // 운영자 판단에 필요한 것만. rawCaptureSummary·bookingPayload 전체는 내려보내지 않는다
        // (PII/카드정보 최소 노출 — payment-review.js 가 애초에 비민감 요약만 저장하지만
        //  큐 목록에까지 payer 이메일을 뿌릴 이유는 없다).
        return {
          orderID: d.id,
          flow: v.flow || null,
          mismatchCode: v.mismatchCode || null,
          mismatchDetail: v.mismatchDetail || null,
          expectedAmountMinor: v.expectedAmountMinor != null ? v.expectedAmountMinor : null,
          expectedCurrency: v.expectedCurrency || null,
          actualAmountMinor: v.actualAmountMinor != null ? v.actualAmountMinor : null,
          actualCurrency: v.actualCurrency || null,
          paymentCaptured: v.paymentCaptured === true,
          captureID: v.captureID || null,
          captureStatus: v.captureStatus || null,
          userEmail: v.userEmail || null,
          createdAt: v.createdAt || null,
        };
      }).sort((a, b) => {
        const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      return json(req, res, 200, { items, count: items.length, truncated: snap.size >= MAX_QUEUE });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const orderID = body && body.orderID;
      const resolution = body && body.resolution;
      const auditNote = body && body.auditNote;
      if (!orderID || !resolution) {
        return json(req, res, 400, { error: 'orderID + resolution 필요', code: 'MISSING_FIELDS' });
      }
      // 화이트리스트는 SSOT 상수로 — 리터럴을 여기 하드코딩하면 판정부(paymentGate)와 조용히 어긋난다.
      if (!Object.values(PAYMENT_REVIEW_RESOLUTION).includes(resolution)) {
        return json(req, res, 400, {
          error: `resolution 은 ${Object.values(PAYMENT_REVIEW_RESOLUTION).join('|')} 중 하나`,
          code: 'INVALID_RESOLUTION',
        });
      }

      const r = await resolvePaymentReview({
        db,
        serverTimestamp: FieldValue.serverTimestamp(),
        orderID,
        resolution,
        resolvedBy: auth.email,   // 클라가 보낸 값 신뢰 금지 — 검증된 토큰의 이메일만.
        auditNote: auditNote ? String(auditNote).slice(0, 500) : null,
      });
      if (!r.ok) {
        const status = r.code === 'REVIEW_NOT_FOUND' ? 404 : 400;
        return json(req, res, status, { error: r.code, code: r.code });
      }
      // 운영자 감사 로그 (admin-runtime-flags.js 관례). 돈 상태를 바꾸는 행위라 흔적을 남긴다.
      console.log('[admin-payment-reviews] resolved', orderID, resolution, 'by', auth.email,
        r.alreadyResolved ? '(already resolved — no-op)' : '');
      return json(req, res, 200, { ok: true, orderID, resolution, alreadyResolved: !!r.alreadyResolved });
    }

    return json(req, res, 405, { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  } catch (e) {
    console.error('[admin-payment-reviews]', e && e.message);
    return json(req, res, 500, { error: 'Internal error', code: 'INTERNAL' });
  }
}
