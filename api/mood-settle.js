/**
 * POST /api/mood-settle — MOOD 운행 종료 정산 (운영자 전용)
 *
 * 예약(가예약, status='confirmed')을 실제 운행시간으로 최종 정산:
 *   최종금액 = 시급 × max(3, 실제시간) + (원래 거리추가 + 톨비)  ← 거리/톨비는 예약 시 측정값 재사용
 *   차액 = 최종 − 선결제(원래 차감액) → 잔액 조정(초과면 추가차감 / 적으면 환원), 한 트랜잭션.
 *   status → 'completed', 실제시간·최종금액·조정액 저장 + 최종 정산 영수증 메일.
 *
 * 🔴 멱등성: status!=='confirmed' 면 거부(이미 정산/취소). 공항(정액)은 정산 무관.
 * 인증: Bearer Firebase ID token, allowlist.admins (mood-topup 동일 게이트).
 * Body: { bookingId, actualHours }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeMoodTotalKRW, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import { notify } from './_shared/notify.js';
import { buildMoodSettlementReceiptEmail } from './_shared/mood-receipt.js';
import { sendEmail } from './_send-email.js';

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
  const actualHours = Number(body.actualHours);
  if (!Number.isFinite(actualHours) || actualHours <= 0 || actualHours > MOOD_MAX_DURATION_HOURS) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `actualHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }

  try {
    const db = initAdminDb('mood-settle');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    const bookingRef = db.collection('mood_bookings').doc(bookingId);

    const result = await db.runTransaction(async (tx) => {
      // ── 모든 read 를 write 전에 (Firestore tx 규칙) ──
      const bSnap = await tx.get(bookingRef);
      if (!bSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const b = bSnap.data() || {};
      if (b.status !== 'confirmed') return { ok: false, status: 409, error: 'ALREADY_SETTLED' }; // 멱등
      if (fixedPriceFor(b.serviceType) !== null) return { ok: false, status: 400, error: 'AIRPORT_NO_SETTLE' };

      const bd = b.breakdown || {};
      // 거리/톨비는 예약 시 측정값 재사용 — 시간만 실제값으로 재계산. (백엔드 SSOT, 클라 금액 무시.)
      const finalPriced = computeMoodTotalKRW({
        serviceType: b.serviceType,
        durationHours: actualHours,
        km: Number(bd.km) || 0,
        tollKRW: Number(bd.tollKRW) || 0,
      });
      if (!finalPriced.ok) return { ok: false, status: 400, error: finalPriced.error };

      const finalAmount = finalPriced.amountKRW;
      const originalAmount = Number(b.amountKRW) || 0;
      const diff = finalAmount - originalAmount; // >0 추가차감 / <0 환원

      const clientRef = db.collection('mood_clients').doc(String(b.clientId || ''));
      const cSnap = await tx.get(clientRef);
      if (!cSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      const balance = Number(cSnap.data().balanceKRW) || 0;
      const newBalance = balance - diff;

      tx.update(clientRef, { balanceKRW: newBalance });
      tx.update(bookingRef, {
        status: 'completed',
        actualHours,
        finalAmountKRW: finalAmount,
        finalBreakdown: {
          baseKRW: finalPriced.baseKRW,
          distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
          tollKRW: finalPriced.tollKRW,
          km: finalPriced.km,
        },
        adjustmentKRW: diff,
        settledAt: Date.now(),
        settledByEmail: email,
      });

      return { ok: true, finalAmount, originalAmount, diff, newBalance, booking: b };
    });

    if (!result.ok) {
      res.writeHead(result.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: result.error }));
    }

    const b = result.booking;
    const clientName = b.clientName || b.clientId || '-';

    // ── 텔레그램 알림 (best-effort) ──
    try {
      const adj = result.diff > 0 ? `추가 ${result.diff.toLocaleString('ko-KR')}원`
        : result.diff < 0 ? `환원 ${(-result.diff).toLocaleString('ko-KR')}원` : '변동 없음';
      await notify('booking',
        `<b>MOOD 운행 종료 · 최종 정산</b>\n` +
        `${clientName} · ${b.date} ${b.startTime}\n` +
        `실제 ${actualHours}시간 — 최종 ${result.finalAmount.toLocaleString('ko-KR')}원 (${adj})\n` +
        `잔액 ${result.newBalance.toLocaleString('ko-KR')}원`);
    } catch (e) { console.warn('[mood-settle] notify 실패:', e?.message); }

    // ── 고객 최종 정산 영수증 메일 (best-effort) ──
    try {
      const toEmail = b.createdByEmail;
      if (toEmail) {
        const receipt = buildMoodSettlementReceiptEmail({
          clientName,
          bookingId,
          date: b.date,
          startTime: b.startTime,
          serviceType: b.serviceType,
          actualHours,
          finalAmountKRW: result.finalAmount,
          adjustmentKRW: result.diff,
          newBalance: result.newBalance,
        });
        await sendEmail({ to: toEmail, subject: receipt.subject, html: receipt.html, text: receipt.text });
      }
    } catch (e) { console.warn('[mood-settle] receipt 메일 실패:', e?.message); }

    console.log('[mood-settle]', email, '→', bookingId, '| 실제', actualHours, 'h | 최종', result.finalAmount, '| 차액', result.diff);
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: { bookingId, actualHours, finalAmountKRW: result.finalAmount, adjustmentKRW: result.diff, balanceKRW: result.newBalance },
    }));
  } catch (err) {
    console.error('[mood-settle] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
