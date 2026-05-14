/**
 * POST /api/manual-payment-request
 *
 * 한국 체류 외국인 사용자가 PayPal QR 로 결제 후 [결제 완료 신고] 누를 때 호출.
 * Firestore `pending_bookings/{bookingRef}` 에 저장 + 텔레그램 booking 채널 알림.
 *
 * 운영자가 PayPal 알림 받고 거래내역 확인 후 admin UI 의 [입금 확인] 버튼 클릭하면
 * /api/admin-booking-action 이 status='CONFIRMED' 로 전환 + AI 플랜 자동 생성 + 영수증.
 *
 * Body:
 *   {
 *     bookingRef,            // 'CT-YYYYMMDD-XXX' (frontend 생성)
 *     productType,           // 'ai-planner-full' / 'charter_seoul_city' / ...
 *     passengers, dateStart, dateEnd,
 *     priceKRW, priceUSD,
 *     customerEmail,         // 필수
 *     customerPhone,         // 옵션
 *     pickupLocation, dropoffLocation, vehicleType, memo,
 *     itineraryData,         // AI 플래너 input 일 때 wizard preview (PDF/플랜 생성용)
 *     airport,
 *     paymentMethod: 'paypal-me-qr',
 *     paypalMeUrl,
 *     language               // 'ko' | 'en' | 'ja' | 'zh'
 *   }
 *
 * Auth: optional (Bearer Firebase token). 비로그인 사용자도 신청 가능 — admin 이
 * customerEmail 만으로 매칭 가능.
 */
import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from './_shared/notify.js';
import { confirmBookingAsPaid } from './_shared/booking-confirm.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';

// ── 어드민 bypass 허용 이메일 목록 ──────────────────────────────────────
// paymentGate.js / capturePaypalOrder.js 와 동일 패턴.
// ADMIN_BYPASS_EMAILS env var (쉼표 구분) 우선, 없으면 ADMIN_EMAIL env var,
// 없으면 하드코딩 fallback. body.customerEmail 신뢰 종료 — Firebase token 검증값 사용.
const HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com'];
function getAdminBypassEmails() {
  const raw = (process.env.ADMIN_BYPASS_EMAILS || '').trim();
  if (raw) return raw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  if (adminEmail) return [adminEmail, ...HARDCODED_ADMIN_EMAILS];
  return HARDCODED_ADMIN_EMAILS;
}

export const config = { runtime: 'nodejs' };
export const maxDuration = 15;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 가격 sanity range (KRW) — 사기성 1원 결제 / 비정상 거대 금액 차단.
const MIN_KRW = 5_000;
const MAX_KRW = 50_000_000;

const BOOKING_REF_PATTERN = /^CT-\d{8}-\d{3}$/;

function _err(error, code = 'UNKNOWN_ERROR') {
  return { ok: false, error, code };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify(_err('POST only', 'METHOD_NOT_ALLOWED')));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    const {
      bookingRef,
      productType,
      passengers,
      dateStart = '',
      dateEnd = '',
      priceKRW,
      priceUSD,
      customerEmail,
      customerPhone,
      pickupLocation = '',
      dropoffLocation = '',
      vehicleType = '',
      memo = '',
      itineraryData,
      airport,
      paymentMethod = 'paypal-me-qr',
      paypalMeUrl,
      language = 'en',
    } = body;

    // 필수 필드 검증
    if (!bookingRef || !BOOKING_REF_PATTERN.test(String(bookingRef))) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Invalid bookingRef format', 'INVALID_BOOKING_REF')));
    }
    if (!productType) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('productType required', 'MISSING_PRODUCT')));
    }
    if (!customerEmail || !String(customerEmail).includes('@')) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err('customerEmail required', 'MISSING_EMAIL')));
    }
    const krw = Number(priceKRW);
    if (!Number.isFinite(krw) || krw < MIN_KRW || krw > MAX_KRW) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify(_err(`priceKRW out of range (${MIN_KRW}~${MAX_KRW})`, 'INVALID_PRICE')));
    }

    // 옵션 인증 — Bearer 토큰이 있으면 verify 해서 uid + email 추출.
    // 토큰 미인증 사용자도 신청 허용 (로그인 우회 케이스).
    let userId = null;
    let authenticatedEmail = null;
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const tokenMatch = String(authHeader).match(/^Bearer\s+(.+)$/i);
    if (tokenMatch) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const { getApps } = await import('firebase-admin/app');
        if (getApps().length > 0) {
          const decoded = await getAuth().verifyIdToken(tokenMatch[1]);
          userId = decoded.uid;
          authenticatedEmail = (decoded.email || '').toLowerCase().trim() || null;
        }
      } catch (e) {
        // 토큰 검증 실패해도 신청은 허용 (로그인 우회 케이스 — 이메일만 받음)
        console.warn('[manual-payment-request] token verify failed:', e.message);
      }
    }

    // Admin TEST 모드 — 인증된 email 이 getAdminBypassEmails() 목록에 있으면 결제 단계
    // 우회 후 즉시 confirm 처리. paymentGate.js / capturePaypalOrder.js 와 동일 패턴.
    // 위변조 방지: body.customerEmail 신뢰 종료 — Firebase token 의 authenticatedEmail 만 사용.
    const isAdminTestRequest = !!(authenticatedEmail && getAdminBypassEmails().includes(authenticatedEmail));

    // Firestore admin 초기화 + 멱등 저장
    const adminDb = initAdminDb('manual-payment-request');
    if (!adminDb) {
      console.error('[manual-payment-request] Firestore admin unavailable');
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify(_err('Firestore unavailable', 'FIRESTORE_UNAVAILABLE')));
    }

    // IP rate limit (PR #432 — Audit W-H13). 익명 신청 허용 + 어드민 bypass 도
    // 같은 endpoint 라 인증된 admin 도 통과시켜야 하므로 인증 확인 *전에* IP
    // throttle. 결제 endpoint 는 신고보다 spam 영향이 크니 3/h. 텔레그램
    // booking 채널 spam + 가짜 pending_bookings 쓰기 폭주 차단.
    //
    // Admin bypass 는 인증된 admin 이라 IP 가 같은 사무실 망 한 곳일 수 있어
    // rate limit 에 걸릴 수 있다 → 인증 후 admin 이라 판명되면 우회 가능하지만,
    // 본 endpoint 구조상 인증 검증이 rate limit 뒤에 있는 것이 자연스럽고 admin
    // 본인이 시간당 3건 이상 manual 결제 요청을 정말로 보내는 케이스는 없으므로
    // 모두에게 동일 cap 적용.
    const clientIp = getClientIp(req);
    const rateCheck = await checkIpRateLimit({
      db: adminDb,
      ip: clientIp,
      collection: 'manual_payment_rate_limits',
      maxRequests: 3,
      errorLabel: 'payment requests',
    });
    if (!rateCheck.ok) {
      res.setHeader?.('Retry-After', String(rateCheck.retryAfterSec));
      res.writeHead(rateCheck.status, JSON_HEADERS);
      return res.end(JSON.stringify(_err(rateCheck.error, 'RATE_LIMITED')));
    }

    const docRef = adminDb.collection('pending_bookings').doc(bookingRef);
    const existing = await docRef.get();

    if (existing.exists) {
      // 이미 신청된 booking — idempotent 응답 (사용자가 [신고] 두 번 눌러도 안전)
      console.log('[manual-payment-request] idempotent — already exists:', bookingRef);
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, data: { bookingRef, idempotent: true } }));
    }

    await docRef.set({
      bookingRef,
      productType,
      passengers: Number(passengers) || 1,
      dateStart, dateEnd,
      priceKRW: krw,
      priceUSD: priceUSD || null,
      customerEmail: String(customerEmail).trim().toLowerCase(),
      customerPhone: customerPhone ? String(customerPhone).trim() : null,
      pickupLocation, dropoffLocation, vehicleType, memo,
      itineraryData: itineraryData || null,
      airport: airport || null,
      paymentMethod,
      paypalMeUrl: paypalMeUrl || null,
      language,
      userId,
      status: 'AWAITING_VERIFICATION',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Admin Bypass 모드 — 결제 단계 우회 후 즉시 confirmed 상태로 처리.
    // confirmBookingAsPaid 가 status='CONFIRMED' 전환 + bookings mirror + AI/booking-processor
    // 자동 트리거 + 텔레그램 #2 + 사용자 confirm 이메일 처리.
    // paymentGate.js / capturePaypalOrder.js / booking-processor.js 와 동일 bypass 패턴.
    if (isAdminTestRequest) {
      console.log('[manual-payment-request] 🟢 ADMIN BYPASS — auto-confirm:', bookingRef, 'admin:', authenticatedEmail);

      // pending_bookings 도큐먼트에 bypass 메타데이터 추가 기록 (감사 추적)
      try {
        await docRef.set({
          paymentMethod: 'admin-bypass',
          bypassReason: 'admin-test',
          paymentVerifiedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (bypassMetaErr) {
        console.warn('[manual-payment-request] bypass 메타데이터 기록 실패:', bypassMetaErr.message);
      }

      try {
        const result = await confirmBookingAsPaid({
          db: adminDb,
          bookingRef,
          paypalTransactionId: `ADMIN-BYPASS-${bookingRef}`,
          source: 'admin',
          adminUid: userId,
          adminEmail: authenticatedEmail,
        });
        if (!result.ok) {
          console.error('[manual-payment-request] admin bypass auto-confirm failed:', result.error);
          // 일반 흐름으로 폴백 — pending_bookings 는 이미 저장됨, admin 이 UI 에서 수동 confirm 가능
        } else {
          // 텔레그램 booking 채널 알림 (운영자 본인 bypass 임 표시)
          notify('booking', [
            '🟢 <b>어드민 테스트 예약 생성 (결제 우회)</b>',
            '',
            `<b>예약번호:</b> <code>${bookingRef}</code>`,
            `<b>상품:</b> ${productType}`,
            `<b>금액:</b> ₩${krw.toLocaleString('ko-KR')}`,
            `<b>관리자:</b> ${authenticatedEmail}`,
            '',
            '<i>admin-bypass — 실제 결제 없이 수동 결제 흐름 E2E 테스트용</i>',
          ].join('\n')).catch(() => {});

          res.writeHead(200, JSON_HEADERS);
          return res.end(JSON.stringify({
            ok: true,
            data: { bookingRef, status: 'CONFIRMED', adminBypass: true, bookingId: result.bookingId },
          }));
        }
      } catch (testErr) {
        console.error('[manual-payment-request] admin bypass auto-confirm exception:', testErr.message);
        // 폴백: 일반 흐름 진행
      }
    }

    // 일반 사용자 흐름 — 텔레그램 booking 채널 알림 (운영자에게 PayPal 거래내역 확인 요청)
    try {
      const text = [
        '🏦 <b>새 PayPal QR 결제 신고</b>',
        '',
        `<b>예약번호:</b> <code>${bookingRef}</code>`,
        `<b>상품:</b> ${productType}`,
        `<b>금액:</b> ₩${krw.toLocaleString('ko-KR')} ($${priceUSD || (krw / 1380).toFixed(2)} USD)`,
        `<b>인원:</b> ${Number(passengers) || 1}명`,
        dateStart ? `<b>날짜:</b> ${dateStart}${dateEnd && dateEnd !== dateStart ? ` ~ ${dateEnd}` : ''}` : null,
        `<b>이메일:</b> ${customerEmail}`,
        customerPhone ? `<b>연락처:</b> ${customerPhone}` : null,
        '',
        '🔍 <i>PayPal 거래내역에서 <code>' + bookingRef + '</code> 메모 또는 ' + (customerEmail) + ' 이메일로 매칭 후</i>',
        '✅ <i>admin UI 에서 [입금 확인] 클릭하세요</i>',
      ].filter(Boolean).join('\n');

      await notify('booking', text);
    } catch (notifyErr) {
      // 알림 실패해도 booking 저장은 성공 — silent log
      console.warn('[manual-payment-request] telegram notify failed:', notifyErr.message);
    }

    console.log('[manual-payment-request] saved:', bookingRef, 'product:', productType, 'amount:', krw);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: { bookingRef, status: 'AWAITING_VERIFICATION' },
    }));
  } catch (err) {
    console.error('[manual-payment-request] failed:', err.message);
    await captureError(err, { route: '/api/manual-payment-request', method: req.method });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify(_err(err.message || 'internal error', 'INTERNAL_ERROR')));
  }
}
