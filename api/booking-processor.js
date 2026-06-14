/**
 * CocoTripKR — 예약 처리 오케스트레이터
 * POST /api/booking-processor
 *
 * capturePaypalOrder 성공 후 내부적으로 호출됨
 * 실행 순서:
 *  1. Google Sheets에 예약 기록 추가
 *  2. USD/KRW 환율 조회
 *  3. 예약 번호 생성 (CT-YYYYMMDD-순번)
 *  4. Gemini 1호 → 텔레그램 알림 메시지 생성
 *  5. 텔레그램 → 태연님 알림 전송
 *  6. Gemini 2호 → 확인 이메일 + 바우처 텍스트 생성
 *  7. Gmail → 고객 확인 이메일 발송
 *  8. Google Sheets 상태 → '확정' 업데이트
 *
 * CONTEXT: CocoTripKR 자동화 메인 함수
 * ENV: 모든 관련 환경변수 필요
 */

import { captureError } from './_shared/sentry.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { appendBooking, updateBookingStatus } from './_google-sheets.js';
// 2026-05-04: telegram 2-채널 분리 후 sendBookingAlert / generateBookingAlert / notify
// 직접 호출은 미사용. _telegram.js / _ai-employees.js 의 export 는 다른 파일이 사용하므로 유지.
import { sendDispatchAlert, sendBookingPaymentAlert, sendErrorAlert } from './_telegram.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { notify } from './_shared/notify.js';
import { safeParseAmountUSD } from './_shared/amount-guard.js';

// ── 어드민 bypass 감지 ───────────────────────────────────────────────────
// capturePaypalOrder → booking-processor 호출 시 orderID 에 ADMIN-BYPASS- prefix 가
// 붙어 있으면 결제 우회 예약으로 간주. paymentGate.js 와 동일 prefix 규약 사용.
function isAdminBypassOrder(orderID) {
  return typeof orderID === 'string' && orderID.startsWith('ADMIN-BYPASS-');
}
import { sendBookingConfirmation, buildDefaultConfirmationEmail } from './_send-email.js';
import {
  generateConfirmationEmail,
  generateVoucherText,
} from './_ai-employees.js';
import { generateVoucherPDF } from './_generate-voucher.js';
import { createWalletPass }   from './_create-wallet-pass.js';
import { getUsdToKrwRaw } from './_exchange-rate.js';
import { USD_TO_KRW } from './_shared/exchange-rate.js';
import { bookingStepGuards, BOOKING_STEP_MARKERS } from './_shared/booking-idempotency.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── 표준 응답 래퍼 ──
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ── 예약 번호 생성 (CT-YYYYMMDD-순번) ────────────────────────────────────
function generateBookingRef() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 900) + 100; // 100~999
  return `CT-${dateStr}-${seq}`;
}

// 환율 조회는 _exchange-rate.js 공통 유틸 사용 (getUsdToKrwRaw)

// ── 고객 언어 감지 (간단 휴리스틱) ──────────────────────────────────────
function detectLanguage(email = '', name = '') {
  // 이메일 도메인으로 대략 추정
  if (email.endsWith('.jp') || /[\u3040-\u30FF]/.test(name)) return 'ja';
  if (email.endsWith('.cn') || /[\u4E00-\u9FFF]/.test(name)) return 'zh';
  if (/[\uAC00-\uD7AF]/.test(name)) return 'ko';
  return 'en';
}

// ── 버그 #17 fix: 부수효과 단계 원자 선점 (atomically-claim) ──
// 기존 'check stepGuards → do → setBookingMarker' 는 순차 retry 만 막고 동시 호출
// (cart fan-out + retry-sweep, capture 25s timeout 후 원본 계속 도는 중 retry 재발화)은
// 못 막음 → 두 인스턴스가 둘 다 마커 없음 읽어 sheets/email/loyalty 각각 실행 → 중복.
//
// 해결: 부수효과 진입 전에 해당 마커를 db.runTransaction 으로 원자 선점(CAS).
//  - 트랜잭션은 read + set 만 (외부 I/O 금지) → 실제 append/email/loyalty 는 밖에서.
//  - 마커 없으면 마커 set 하고 claimed=true 반환(내가 선점) → 그 단계 실행.
//  - 마커 있으면 claimed=false (이미 처리됨) → 스킵.
//  - db/orderID 없거나 트랜잭션 실패 시 안전 기본 = claimed=true (처리 진행). 기존
//    단일상품/Firestore-unavailable 동작 100% 불변 (첫 호출은 항상 선점 성공).
//  - 선점 성공 후 단계가 실패하면 마커가 이미 박혀 retry 가 재실행 안 함—
//    기존 setBookingMarker 동작과 동일(성공한 단계만 마커). loyalty 는 실패 시
//    재적립 위해 명시적으로 마커 해제(아래 참조).
async function claimBookingStep(orderID, field) {
  if (!orderID || !field) return true; // db/orderID 없으면 처리 진행 (안전 기본)
  let db;
  try {
    db = initAdminDb('booking-processor');
  } catch {
    return true;
  }
  if (!db) return true; // Firestore unavailable → 기존 동작(전 단계 처리)
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    const ref = db.collection('bookings').doc(orderID);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      if (data[field]) return false; // 이미 처리됨 → 선점 실패
      tx.set(ref, { [field]: FieldValue.serverTimestamp() }, { merge: true });
      return true; // 내가 선점
    });
    return claimed;
  } catch (e) {
    // 트랜잭션 자체 실패(Firestore 오류) → 안전 기본 = 처리 진행.
    // (기존도 마커 읽기 실패 시 전 단계 처리) — 극도의 race 중복보다
    // 고객 메일 누락이 더 낫다. 트랜잭션 실패 시 처리 진행은 기존 가드 동작을 계승.
    console.warn(`[booking-processor] 단계 선점 ${field} 트랜잭션 실패 (처리 진행):`, e.message);
    return true;
  }
}

// 버그 #17: loyalty 는 선점 후 earn 실패 시 재적립을 위해 마커를 풀어야 한다
// (기존: 성공 시에만 setBookingMarker = 실패 시 마커 없음 → retry 재적립).
// 선점은 미리 마커를 박으므로, earn 실패 시 명시적으로 delete 해야 동일 의미 유지.
async function releaseBookingStep(orderID, field) {
  if (!orderID || !field) return;
  try {
    const db = initAdminDb('booking-processor');
    if (db) {
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection('bookings').doc(orderID).set(
        { [field]: FieldValue.delete() },
        { merge: true },
      );
    }
  } catch (e) {
    console.warn(`[booking-processor] 단계 마커 ${field} 해제 실패 (비치명적):`, e.message);
  }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────
const originalHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, _err('Method not allowed', 'METHOD_NOT_ALLOWED'));

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, _err('Invalid JSON body', 'INVALID_BODY'));
  }

  const {
    orderID,
    payerEmail,
    payerName,
    amount,     // USD amount string
    // 예약 상세 정보 (프론트에서 함께 전달)
    product,
    tourDate,
    pickupLocation,
    dropoffLocation,
    paxCount,
    vehicleType,
    customerPhone,
    couponApplied,
    memo,
    itineraryData,
    airport,
    userEmail,          // 이슈#1 fix: 로열티 적립 등에 활용
    bookingRef: externalBookingRef,  // 이슈#2 fix: capturePaypalOrder에서 생성한 CT- 번호
    requiresReconciliation,  // 2026-05-04: charter_custom_estimate booking 표식
  } = body;

  if (!orderID || !payerEmail) {
    return respond(400, _err('orderID와 payerEmail은 필수입니다.', 'MISSING_FIELDS'));
  }

  // ── 어드민 결제 우회 감지 + Firestore 기록 ─────────────────────────────
  // paymentGate.js 에서 ADMIN-BYPASS- prefix 허용 시 capturePaypalOrder 가 orderID
  // 그대로 booking-processor 로 전달. 여기서 감지해 bypass 메타데이터를 기록하고
  // 텔레그램 admin(booking) 채널에 알림 전송.
  const adminBypass = isAdminBypassOrder(orderID);
  if (adminBypass) {
    console.log('[booking-processor] 🟢 ADMIN BYPASS 예약 감지 | orderID:', orderID, '| email:', payerEmail);
    try {
      const db = initAdminDb('booking-processor');
      if (db) {
        const { FieldValue } = await import('firebase-admin/firestore');
        await db.collection('bookings').doc(orderID).set({
          paymentMethod: 'admin-bypass',
          bypassReason: 'admin-test',
          paymentVerifiedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log('[booking-processor] 어드민 bypass 메타데이터 기록 완료');
      }
    } catch (bypassDbErr) {
      // 비치명적 — 기록 실패해도 예약 처리는 계속
      console.warn('[booking-processor] bypass 메타데이터 기록 실패:', bypassDbErr.message);
    }
    // 텔레그램 booking 채널 알림 (비치명적)
    notify('booking', [
      '🟢 <b>어드민 테스트 예약 생성 (결제 우회)</b>',
      '',
      `<b>orderID:</b> <code>${orderID}</code>`,
      `<b>상품:</b> ${product || '(미지정)'}`,
      `<b>날짜:</b> ${tourDate || '(미지정)'}`,
      `<b>결제자:</b> ${payerEmail}`,
      '',
      '<i>ADMIN-BYPASS- prefix — 실제 결제 없이 예약 흐름 E2E 테스트용</i>',
    ].join('\n')).catch((e) => console.warn('[booking-processor] bypass telegram notify 실패:', e.message));
  }

  console.log('[booking-processor] 예약 처리 시작:', { orderID, payerEmail, amount });

  // capturePaypalOrder에서 전달된 bookingRef가 있으면 그대로 사용 (Firestore↔Sheets 일관성)
  const bookingRef = externalBookingRef || generateBookingRef();
  let exchangeRate = USD_TO_KRW;
  let amountKRW = 0;

  // ── 멱등 가드: 이미 끝낸 단계 스킵 (retry 큐 sweep / admin-replay / cart fan-out 중복 방지) ──
  // 안전 기본: 읽기 실패/마커 없음 = 전 단계 처리. 첫 호출엔 마커 없음 → 기존 단일상품 동작 100% 불변.
  let stepGuards = bookingStepGuards(null);
  try {
    const db = initAdminDb('booking-processor');
    if (db && orderID) {
      const snap = await db.collection('bookings').doc(orderID).get();
      if (snap.exists) stepGuards = bookingStepGuards(snap.data());
    }
  } catch (guardErr) {
    console.warn('[booking-processor] 멱등 마커 읽기 실패 (전 단계 처리):', guardErr.message);
  }

  // PR #452 (Audit Z-H9): malformed `amount` (e.g. 'abc') previously NaN-
  // propagated through KRW conversion + booking record + loyalty earn,
  // surfacing as $NaN in Sheets / email / voucher and silent loss of
  // loyalty points. safeParseAmountUSD returns 0 on invalid + an
  // `invalid` flag so we can alert operator without blocking the booking.
  const amountGuard = safeParseAmountUSD(amount);
  const amountUSDSafe = amountGuard.value;
  if (amountGuard.invalid) {
    console.error('[booking-processor] amount NaN guard tripped:', { orderID, rawAmount: String(amount).slice(0, 100) });
    throttledTelegramAlert({
      key: 'booking-amount-nan',
      channel: 'admin',
      severity: 'critical',
      message: [
        '🚨 <b>booking amount malformed — $0 으로 진행</b>',
        '',
        `<b>OrderID:</b> <code>${orderID}</code>`,
        `<b>BookingRef:</b> <code>${bookingRef}</code>`,
        `<b>Raw amount:</b> <code>${String(amount).slice(0, 100).replace(/[<>&]/g, '_')}</code>`,
        `<b>이메일:</b> ${payerEmail || '(none)'}`,
        '',
        '→ Sheets/email/voucher 모두 $0 으로 표시. 운영자 수동 보정 필요.',
        `→ /api/admin-update-booking 또는 admin UI 에서 amountUSD 갱신.`,
      ].join('\n'),
      context: { orderID, bookingRef, rawAmount: String(amount).slice(0, 100) },
    }).catch(() => {});
  }

  // ── Step 1: 환율 조회 ────────────────────────────────────────────────
  try {
    exchangeRate = await getUsdToKrwRaw();
    amountKRW = Math.round(amountUSDSafe * exchangeRate);
    console.log('[booking-processor] 환율:', exchangeRate, '→ KRW:', amountKRW);
  } catch (err) {
    console.warn('[booking-processor] 환율 조회 실패, 기본값 사용:', err.message);
  }

  // 공항 픽업 정보를 memo에 합쳐 Google Sheets에 노출 (별도 컬럼 추가 없이 태연님 가시성 확보)
  const airportMemoLine = (() => {
    if (!airport || typeof airport !== 'object') return '';
    const { terminal, flightNumber, luggage } = airport;
    const lug = luggage || {};
    const total = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
    const parts = [];
    if (terminal) parts.push(`터미널 ${terminal}`);
    if (flightNumber) parts.push(`편명 ${flightNumber}`);
    if (total > 0) parts.push(`수하물 ${total}개(S${lug.small ?? 0}·M${lug.medium ?? 0}·L${lug.large ?? 0})`);
    return parts.length ? `✈ ${parts.join(' · ')}` : '';
  })();
  const enhancedMemo = [airportMemoLine, memo].filter(Boolean).join(' | ');

  const booking = {
    bookingRef,
    transactionId: orderID,
    customerName: payerName || 'Guest',
    customerEmail: payerEmail,
    customerPhone: customerPhone || '',
    product: product || '코코트립 서비스',
    tourDate: tourDate || '미정',
    pickupLocation: pickupLocation || '',
    dropoffLocation: dropoffLocation || '',
    paxCount: paxCount || 1,
    vehicleType: vehicleType || '스타리아',
    amountUSD: amountUSDSafe.toFixed(2),
    amountKRW,
    exchangeRate,
    couponApplied: couponApplied || '없음',
    memo: enhancedMemo,
    airport: airport || null,
    requiresReconciliation: !!requiresReconciliation,
  };

  const language = detectLanguage(payerEmail, payerName);
  const results = { bookingRef, steps: {} };

  // ── Step 2: Google Sheets 예약 기록 추가 (멱등: 원자 선점으로 동시 호출 중복 방지) ──
  // 버그 #17: read-then-write 가드 대신 claimBookingStep 으로 마커를 트랜잭션 선점.
  //   stepGuards.skipSheets = 빠른 경로(이미 기록된 게 명백) / claim 실패 = 동시 호출이
  //   먼저 선점함 → 둘 다 'skip'. 선점 성공한 인스턴스만 appendBooking 1회 실행.
  let sheetsRowHint = null;
  const claimedSheets = stepGuards.skipSheets
    ? false
    : await claimBookingStep(orderID, BOOKING_STEP_MARKERS.sheets);
  if (!claimedSheets) {
    results.steps.sheets = 'skip: already appended (idempotent)';
    console.log('[booking-processor] Sheets 스킵 (멱등 — 이미 기록/선점됨):', orderID);
  } else {
    try {
      const sheetsResult = await appendBooking(booking);
      sheetsRowHint = sheetsResult.appendedRow || null;
      results.steps.sheets = 'ok';
      console.log('[booking-processor] Sheets 기록 완료, row:', sheetsRowHint);
      // 마커는 claimBookingStep 트랜잭션에서 이미 set 됨 → 별도 setBookingMarker 불필요.
    } catch (err) {
      // 버그 #17: 선점만 하고 append 실패/env-skip → 마커를 풀어 retry 가 재append 하도록.
      //   (기존: 성공 후에만 마커 set = 실패/env-skip 시 마커 없음 → retry 재시도.)
      await releaseBookingStep(orderID, BOOKING_STEP_MARKERS.sheets);
      // B9-31: env 미설정(SheetsEnvSkipped) 시 silent — _google-sheets.js 가 이미 1회 info 로그 출력.
      if (err?.skipped || err?.name === 'SheetsEnvSkipped') {
        results.steps.sheets = 'skipped (env not configured)';
      } else {
        results.steps.sheets = `error: ${err.message}`;
        console.error('[booking-processor] Sheets 기록 실패:', err.message);
      }
      // 비치명적 오류 — 계속 진행
    }
  }

  // ── Step 3: 텔레그램 알림 전송 (2026-05-04: 2-채널 분리) ─────────────
  // 사용자 정책: "정보는 텔레그램 드라이버로 보내고 결제내역은 코코트립 봇한테".
  //   - dispatch 채널 (driver bot): 픽업·드롭·시간·차종·인원·공항·메모 등 운행 정보
  //   - booking  채널 (cocotrip bot): USD/KRW 결제 금액·환율·쿠폰·transactionId 등 영수증
  // Gemini 합본 알림은 사용 중지 — 채널별 deterministic 포맷이 일관성 있고 빠름.
  // generateBookingAlert / sendBookingAlert 는 호환을 위해 export 유지하되 미호출.
  try {
    const [dispatchRes, paymentRes] = await Promise.allSettled([
      sendDispatchAlert(booking),
      sendBookingPaymentAlert(booking),
    ]);
    const okDispatch = dispatchRes.status === 'fulfilled' && dispatchRes.value?.ok;
    const okPayment  = paymentRes.status  === 'fulfilled' && paymentRes.value?.ok;
    results.steps.telegram = okDispatch && okPayment
      ? 'ok'
      : `partial: dispatch=${okDispatch} payment=${okPayment}`;
    console.log('[booking-processor] 텔레그램 알림: dispatch=', okDispatch, 'payment=', okPayment);
  } catch (err) {
    results.steps.telegram = `error: ${err.message}`;
    console.error('[booking-processor] 텔레그램 전송 실패:', err.message);
  }

  // ── Step 3.5: (옵션) 자동 driver 배차 broadcast ─────────────────────
  // C2 (2026-05-04): driver bot 으로 [✓ 수락]/[✗ 거절] 인라인 키보드 메시지를
  // 활성 기사 전원에게 broadcast — first-to-accept wins. 어드민 /dispatch 명령
  // 없이도 결제 직후 즉시 기사들에게 배차 알림 도달.
  //
  // ENV 게이트: AUTO_DISPATCH_BROADCAST=1 일 때만 활성. prod 도입 전 단계적 롤아웃.
  // booking.bookingRef 가 곧 bookings 도큐먼트 ID (booking-processor 호출처 보장).
  if (process.env.AUTO_DISPATCH_BROADCAST === '1') {
    try {
      const orderID = booking.bookingRef;
      if (!orderID) {
        results.steps.dispatchBroadcast = 'skip: no bookingRef';
      } else {
        const { broadcastDispatchToDrivers } = await import('./_shared/dispatch-helpers.js');
        const r = await broadcastDispatchToDrivers({ orderID, booking });
        results.steps.dispatchBroadcast =
          r.ok ? `sent=${r.sent} failed=${r.failed}` : `none: ${r.errors.join('; ')}`;
        console.log('[booking-processor] driver broadcast:', results.steps.dispatchBroadcast);
      }
    } catch (err) {
      results.steps.dispatchBroadcast = `error: ${err.message}`;
      console.error('[booking-processor] driver broadcast 실패:', err.message);
    }
  }

  // ── Step 4: PDF 바우처 생성 ─────────────────────────────────────────
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateVoucherPDF(booking);
    results.steps.pdf = 'ok';
    console.log('[booking-processor] PDF 바우처 생성 완료, 크기:', pdfBuffer.length, 'bytes');
  } catch (err) {
    results.steps.pdf = `error: ${err.message}`;
    console.error('[booking-processor] PDF 생성 실패 (계속 진행):', err.message);
  }

  // ── Step 5: Google Wallet 패스 생성 (승인 완료 후 활성화) ─────────────
  let walletUrl = null;
  try {
    walletUrl = await createWalletPass(booking);
    results.steps.wallet = walletUrl ? 'ok' : 'skipped (credentials not set)';
    if (walletUrl) console.log('[booking-processor] Google Wallet 링크 생성 완료');
  } catch (err) {
    results.steps.wallet = `error: ${err.message}`;
    console.error('[booking-processor] Wallet 생성 실패 (계속 진행):', err.message);
  }

  // ── Step 6: 고객 확인 이메일 발송 (PDF 첨부 + Wallet 링크) ───────────
  // PR-L: voucher 첨부 이메일 발송 성공/실패를 bookings/{orderID} 도큐먼트에 기록.
  //   - 성공: voucherSentAt = serverTimestamp()
  //   - 실패: voucherFailedAt = serverTimestamp() + voucherError
  // operator-todo-reminder 가 이 필드로 미발송 booking 정확 검출 (bookingRef proxy 한계 보완).
  let voucherEmailOk = false;
  let voucherEmailErr = null;
  let voucherSkipped = false;
  // 버그 #17: voucherSentAt 마커를 발송 전에 트랜잭션 선점 → 동시 호출 시 한 인스턴스만
  //   확인메일 발송 (중복 메일 방지). 선점 실패(stepGuards 빠른 경로 포함) = 이미 발송/선점됨.
  //   원래 voucherSentAt 은 Step 6.5 성공 시에만 set 됐으나, 이제 선점이 미리 박는다.
  //   발송 실패 시 releaseBookingStep 으로 마커를 풀어 retry 재발송 보장(기존 의미 유지).
  const claimedVoucher = stepGuards.skipVoucher
    ? false
    : await claimBookingStep(orderID, BOOKING_STEP_MARKERS.voucher);
  if (!claimedVoucher) {
    // 멱등: 이미 발송됨/선점됨 (voucherSentAt 존재) → 재발송 안 함.
    voucherSkipped = true;
    voucherEmailOk = true;
    results.steps.email = 'skip: already sent (idempotent)';
    console.log('[booking-processor] 이메일 스킵 (멱등 — 이미 발송/선점됨):', orderID);
  } else {
    try {
      let emailContent;
      let voucherText = '';

      // Gemini로 이메일 + 바우처 생성 시도
      try {
        [emailContent, voucherText] = await Promise.all([
          generateConfirmationEmail(booking, language),
          generateVoucherText(booking),
        ]);
      } catch (aiErr) {
        console.warn('[booking-processor] AI 이메일 생성 실패, 기본 템플릿 사용:', aiErr.message);
        emailContent = buildDefaultConfirmationEmail(booking, walletUrl, itineraryData);
      }

      await sendBookingConfirmation(payerEmail, emailContent, voucherText, pdfBuffer, walletUrl);
      results.steps.email = 'ok';
      voucherEmailOk = true;
      console.log('[booking-processor] 고객 이메일 발송 완료:', payerEmail);
    } catch (err) {
      results.steps.email = `error: ${err.message}`;
      voucherEmailErr = err.message || 'unknown';
      console.error('[booking-processor] 이메일 발송 실패:', err.message);
      // 버그 #17: 선점만 하고 발송 실패 → 마커를 풀어 retry 가 재발송하도록 (메일 누락 방지).
      await releaseBookingStep(orderID, BOOKING_STEP_MARKERS.voucher);
    }
  }

  // ── Step 6.5: voucher 발송 결과를 Firestore booking 도큐먼트에 기록 ──
  // PR-L: operator-todo-reminder 가 voucherSentAt 빈 booking 검출용. 부분 실패도
  // 포함 (voucherFailedAt + voucherError) — 어드민이 명시적으로 인지 가능.
  // 비치명적 — Firestore unavailable 이어도 전체 처리는 계속.
  if (voucherSkipped) {
    // 멱등: voucherSentAt 이미 기록됨 → 재기록 불필요.
    results.steps.voucherStatus = 'skip: already recorded (idempotent)';
  } else if (voucherEmailOk) {
    // 버그 #17: voucherSentAt 은 claimBookingStep 선점 트랜잭션에서 이미 set 됨 →
    //   Step 6.5 에서 재기록 불필요. (기존엔 여기서 처음 박았으나 이제 선점이 담당.)
    results.steps.voucherStatus = 'ok';
  } else {
    // 발송 실패 — voucherFailedAt + voucherError 기록 (operator-todo-reminder 검출용).
    //   voucherSentAt 선점 마커는 위에서 releaseBookingStep 으로 이미 해제됨 → retry 재발송.
    try {
      const db = initAdminDb('booking-processor');
      if (db && orderID) {
        const { FieldValue } = await import('firebase-admin/firestore');
        await db.collection('bookings').doc(orderID).set({
          voucherFailedAt: FieldValue.serverTimestamp(),
          voucherError: String(voucherEmailErr || 'unknown').slice(0, 500),
        }, { merge: true });
        results.steps.voucherStatus = 'failed-recorded';
      } else {
        results.steps.voucherStatus = 'skip: firestore unavailable';
      }
    } catch (statusErr) {
      results.steps.voucherStatus = `error: ${statusErr.message}`;
      console.error('[booking-processor] voucherStatus 기록 실패:', statusErr.message);
    }
  }

  // ── Step 7: Google Sheets 상태 '확정'으로 업데이트 (이슈#3 fix: rowHint로 전체 스캔 회피) ──
  try {
    await updateBookingStatus(orderID, '확정', sheetsRowHint);
    results.steps.sheetsUpdate = 'ok';
  } catch (err) {
    // B9-31: env 미설정(SheetsEnvSkipped) 시 silent.
    if (err?.skipped || err?.name === 'SheetsEnvSkipped') {
      results.steps.sheetsUpdate = 'skipped (env not configured)';
    } else {
      results.steps.sheetsUpdate = `error: ${err.message}`;
      console.error('[booking-processor] 상태 업데이트 실패:', err.message);
    }
  }

  // ── 오류가 있었다면 태연님께 알림 ──────────────────────────────────
  const failedSteps = Object.entries(results.steps)
    .filter(([, v]) => v.startsWith('error'))
    .map(([k, v]) => `${k}: ${v}`);

  if (failedSteps.length > 0) {
    // K Tier 2-E: 동일 step 실패 burst 시 dedup. key 는 단계 기반으로 묶어 동일 원인 묶이게.
    const failedKeySig = failedSteps.map(s => s.split(':')[0]).sort().join(',') || 'unknown';
    throttledTelegramAlert({
      key: `booking-processor-fail:${failedKeySig}`,
      channel: 'error',
      severity: 'high',
      message: `⚠️ <b>booking-processor 일부 단계 실패</b>\n\n예약: <code>${bookingRef || '-'}</code>\n실패:\n${failedSteps.join('\n')}`,
      context: { bookingRef, orderID, step: failedKeySig },
    }).catch(() => {});
  }

  console.log('[booking-processor] 예약 처리 완료:', results);

  // ── 로열티 포인트 자동 적립 ──────────────────────────────────────────
  try {
    // PR #452 (Z-H9): use the shared guard so 'abc' doesn't silently set
    // amountNum=0 + skip loyalty earn (the operator-alerted path above
    // already fired for the same NaN).
    const amountNum = amountUSDSafe;
    // 버그 #17: loyaltyEarnedAt 마커를 earn 호출 전에 트랜잭션 선점 → 동시 호출 시
    //   한 인스턴스만 적립 (중복 포인트 방지). earn 가능 조건(amount>0 && userId)일 때만
    //   선점 시도. 선점 실패(stepGuards 빠른 경로 포함) = 이미 적립/선점됨 → 스킵.
    //   earn 실패(non-2xx/예외) 시 releaseBookingStep 으로 마커를 풀어 retry 재적립 보장
    //   (기존 '성공 시에만 마커' 의미 유지).
    let loyaltyClaimed = false;
    if (!stepGuards.skipLoyalty && amountNum > 0 && body.userId) {
      loyaltyClaimed = await claimBookingStep(orderID, BOOKING_STEP_MARKERS.loyalty);
    }
    if (stepGuards.skipLoyalty || (amountNum > 0 && body.userId && !loyaltyClaimed)) {
      // 멱등: 이미 적립됨/선점됨 → 재적립 안 함 (retry 중복 포인트 방지).
      results.loyalty = { skipped: 'already earned (idempotent)' };
    } else if (loyaltyClaimed) {
      let loyaltyOk = false;
      try {
        const loyaltyRes = await fetch(`https://cocotripkr.com/api/loyalty`, {
          method: 'POST',
          // earn 은 내부 전용 — 서비스 토큰 동봉 (loyalty.js earn 게이트). 미설정 시 earn 403
          // → 적립 일시 중단(비치명적, best-effort). 운영자 INTERNAL_API_TOKEN 설정 필요.
          headers: { 'Content-Type': 'application/json', 'x-internal-token': (process.env.INTERNAL_API_TOKEN || '').trim() },
          body: JSON.stringify({
            action: 'earn',
            userId: body.userId,
            amountUSD: amountNum,
            bookingRef,
            description: `Booking confirmed: ${product || 'Charter'} $${amountNum}`,
          }),
        });
        const loyaltyData = await loyaltyRes.json();
        console.log('[booking-processor] 포인트 적립:', loyaltyData);
        results.loyalty = loyaltyData;
        loyaltyOk = loyaltyRes.ok;
      } finally {
        // 적립 실패(non-2xx/예외) 시 선점 마커 해제 → retry 재적립 (포인트 누락 방지).
        // 성공 시엔 선점 트랜잭션에서 박은 마커 유지.
        if (!loyaltyOk) {
          await releaseBookingStep(orderID, BOOKING_STEP_MARKERS.loyalty);
        }
      }
    }
  } catch (loyaltyErr) {
    console.warn('[booking-processor] 포인트 적립 실패 (비치명적):', loyaltyErr.message);
  }

  return respond(200, _ok({ bookingRef, steps: results.steps, loyalty: results.loyalty }));
};



export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

// --- Vercel Native Handler ---
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || '{}'),
  };

  try {
    const result = await originalHandler(event);
    if (result && result.headers) {
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    const statusCode = result?.statusCode || 200;
    let finalBody = result?.body;
    if (typeof finalBody === 'string') { try { finalBody = JSON.parse(finalBody); } catch {} }
    return res.status(statusCode).json(finalBody || result);
  } catch (error) {
    console.error('[booking-processor] Handler error:', error);
    await captureError(error, {
      route: '/api/booking-processor',
      method: req.method,
    });
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json(_err(error.message, 'INTERNAL_ERROR'));
  }
}