/**
 * POST /api/mood-cancel — MOOD 예약 취소 + 전액 잔액 환원 (2026-07-05 운영자 지시)
 *
 * 정책 (운영자 확정):
 *   - confirmed(운행 전) 만 취소 가능 — 위약금 없이 전액 환원.
 *   - completed(정산 끝) / cancelled(이미 취소) 는 409 — 중복 환불 원천 차단(멱등).
 *   - "변경"은 별도 API 없이 [폼에 복사 → 재예약 → 기존 취소] 흐름 — 금액이 새 경로로
 *     자연 재계산되므로 수정-API 방식보다 돈 계산이 단순·안전.
 *
 * 🔴 돈 SSOT: 환불액 = 예약 doc 의 amountKRW (클라 입력 무시). 예약 doc 상태 변경 +
 *    클라이언트 잔액 환원을 한 트랜잭션으로 (P311 멱등성 규약).
 * 🔒 IDOR: 비-admin 은 자기 회사(allowlist.clientId) 예약만 취소 가능 (mood-book 동일 정책).
 * 알림: 운영자 텔레그램 (배차 취소 인지용, best-effort).
 *
 * Body: { bookingId }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail } from './_shared/mood-allowlist.js';
import { notify } from './_shared/notify.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }
  const email = auth.email;

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const bookingId = String(body.bookingId || '').trim();
  if (!bookingId) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'bookingId 필수' }));
  }

  try {
    const db = initAdminDb('mood-cancel');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음' }));
    }
    const isAdmin = isAdminEmail(allowlist, email);

    const txResult = await db.runTransaction(async (tx) => {
      const bRef = db.collection('mood_bookings').doc(bookingId);
      const bSnap = await tx.get(bRef);
      if (!bSnap.exists) return { ok: false, status: 404, error: '예약을 찾을 수 없습니다' };
      const b = bSnap.data();

      // 🔒 IDOR — 비-admin 은 자기 회사 예약만.
      if (!isAdmin && b.clientId !== allowlist.clientId) {
        return { ok: false, status: 403, error: '다른 회사 예약은 취소할 수 없습니다' };
      }
      // 멱등/상태 게이트 — confirmed 만. completed=정산 끝(환불 대상 아님), cancelled=중복.
      if (b.status !== 'confirmed') {
        return {
          ok: false, status: 409,
          error: b.status === 'cancelled' ? '이미 취소된 예약입니다'
            : b.status === 'completed' ? '정산이 끝난 예약은 취소할 수 없습니다 — 운영자에게 문의하세요'
            : `취소 불가 상태(${b.status})`,
        };
      }

      const cRef = db.collection('mood_clients').doc(b.clientId);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists) return { ok: false, status: 500, error: '클라이언트 없음' };

      const refundKRW = Number(b.amountKRW) || 0; // 🔴 환불액 = 예약 당시 차감액 (SSOT)
      const balanceKRW = Number(cSnap.data().balanceKRW) || 0;
      const newBalance = balanceKRW + refundKRW;

      tx.update(bRef, {
        status: 'cancelled',
        refundKRW,
        cancelledAt: Date.now(),
        cancelledByEmail: email,
      });
      tx.update(cRef, { balanceKRW: newBalance });
      return {
        ok: true, refundKRW, balanceKRW: newBalance,
        date: b.date, startTime: b.startTime, serviceType: b.serviceType,
        clientName: cSnap.data().name || b.clientId,
      };
    });

    if (!txResult.ok) {
      res.writeHead(txResult.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: txResult.error }));
    }

    try {
      await notify('booking', [
        '🚫 MOOD 예약 취소',
        `${txResult.clientName} | ${txResult.date} ${txResult.startTime} | ${txResult.serviceType}`,
        `환불 ${txResult.refundKRW.toLocaleString('ko-KR')}원 → 잔액 ${txResult.balanceKRW.toLocaleString('ko-KR')}원`,
        `취소자: ${email}`,
      ].join('\n'));
    } catch (notifyErr) {
      console.warn('[mood-cancel] notify failed:', notifyErr?.message);
    }

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, refundKRW: txResult.refundKRW, balanceKRW: txResult.balanceKRW }));
  } catch (e) {
    captureError(e, { api: 'mood-cancel' });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
