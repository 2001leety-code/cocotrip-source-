/**
 * POST /api/mood-book — MOOD 선불 예약 (잔액 차감)
 *
 * MOOD B2B 포털: 광고사 직원이 매니저/차량을 예약. 선불 충전된 잔액에서 차감.
 *
 * 🔴 돈 원자성 (이 파일이 핵심):
 *   Firestore runTransaction 안에서 ① 잔액 읽기 ② 백엔드 금액 재계산
 *   ③ 잔액 < 금액 이면 abort + INSUFFICIENT_BALANCE ④ 충분하면 예약 doc 생성 +
 *   잔액 차감을 "한 트랜잭션" 으로 수행. → 동시 예약 더블스펜드 / 음수 잔액 불가.
 *   (Firestore 트랜잭션은 read 한 doc 이 commit 전 변경되면 자동 재시도 → race-safe.)
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.emails 에 없으면 403.
 *
 * Body: { clientId, date(YYYY-MM-DD), startTime(HH:mm), durationHours, serviceType }
 *   - amountKRW 는 body 로 받아도 무시 — 백엔드 computeAmountKRW 로 재계산.
 *
 * 성공 시 notifyOperator 텔레그램 알림 (best-effort, 실패해도 예약은 확정).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail } from './_shared/mood-allowlist.js';
import { computeAmountKRW, isValidServiceType, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import { notify } from './_shared/notify.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;       // YYYY-MM-DD
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm (00:00 ~ 23:59)

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  // ── 1) 인증 ──────────────────────────────────────────────
  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;

  // ── 2) body 파싱 + 검증 ──────────────────────────────────
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { clientId, date, startTime, durationHours, serviceType } = body;

  if (!clientId || typeof clientId !== 'string') {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'clientId 필수' }));
  }
  if (!DATE_RE.test(String(date))) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'date 는 YYYY-MM-DD 형식' }));
  }
  if (!TIME_RE.test(String(startTime))) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'startTime 은 HH:mm 형식' }));
  }
  if (!isValidServiceType(serviceType)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: "serviceType 은 'vehicle' 또는 'manager'" }));
  }
  const hours = Number(durationHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MOOD_MAX_DURATION_HOURS) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `durationHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }

  // ── 3) 백엔드 금액 재계산 (body.amountKRW 는 무시) ────────
  const priced = computeAmountKRW(serviceType, hours);
  if (!priced.ok) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: priced.error }));
  }
  const { amountKRW, ratePerHour } = priced;

  try {
    const db = initAdminDb('mood-book');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // ── 4) allowlist 게이트 ───────────────────────────────
    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음' }));
    }

    const clientRef = db.collection('mood_clients').doc(clientId);
    const bookingRef = db.collection('mood_bookings').doc(); // 새 doc id 미리 확보

    // ── 5) 🔴 원자적 잔액 차감 + 예약 생성 ─────────────────
    // runTransaction 안에서 read→check→write. balanceKRW 가 commit 전 변경되면
    // Firestore 가 트랜잭션 전체를 재실행 → 동시 예약이 같은 잔액을 두 번 쓰는
    // 더블스펜드 / 음수 잔액 불가능.
    const txResult = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) {
        return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      }
      const clientData = clientSnap.data() || {};
      const balanceKRW = Number(clientData.balanceKRW) || 0;

      if (balanceKRW < amountKRW) {
        // 잔액 부족 → 아무것도 쓰지 않고 abort (write 없이 return = 차감 안 됨).
        return { ok: false, status: 402, error: 'INSUFFICIENT_BALANCE', balanceKRW, amountKRW };
      }

      const newBalance = balanceKRW - amountKRW;
      const createdAt = Date.now();

      // 예약 doc 생성
      tx.set(bookingRef, {
        clientId,
        date,
        startTime,
        durationHours: hours,
        serviceType,
        ratePerHour,
        amountKRW,
        status: 'confirmed',
        createdByEmail: email,
        createdAt,
      });

      // 잔액 차감 (같은 트랜잭션)
      tx.update(clientRef, { balanceKRW: newBalance });

      return {
        ok: true,
        bookingId: bookingRef.id,
        amountKRW,
        ratePerHour,
        newBalance,
        clientName: clientData.name || clientId,
      };
    });

    if (!txResult.ok) {
      res.writeHead(txResult.status, JSON_HEADERS);
      return res.end(JSON.stringify({
        ok: false,
        error: txResult.error,
        ...(txResult.error === 'INSUFFICIENT_BALANCE'
          ? { balanceKRW: txResult.balanceKRW, amountKRW: txResult.amountKRW }
          : {}),
      }));
    }

    // ── 6) 텔레그램 알림 (best-effort — 실패해도 예약은 확정됨) ──
    const fmt = (n) => Number(n).toLocaleString('ko-KR');
    const serviceLabel = serviceType === 'vehicle' ? '차량' : '매니저';
    const msg =
      `<b>MOOD 예약</b>\n` +
      `${txResult.clientName} · ${date} ${startTime}\n` +
      `${serviceLabel} ${hours}시간 — ${fmt(txResult.amountKRW)}원\n` +
      `잔액 ${fmt(txResult.newBalance)}원\n` +
      `예약자: ${email}`;
    try {
      await notify('booking', msg);
    } catch (notifyErr) {
      // 알림 실패는 비치명적 — 로그만.
      console.warn('[mood-book] notify failed:', notifyErr?.message);
    }

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        bookingId: txResult.bookingId,
        amountKRW: txResult.amountKRW,
        ratePerHour: txResult.ratePerHour,
        balanceKRW: txResult.newBalance,
      },
    }));
  } catch (err) {
    console.error('[mood-book] failed:', err.message);
    await captureError(err, { route: '/api/mood-book', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
