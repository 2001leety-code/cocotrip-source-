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

import { appendBooking, updateBookingStatus } from './_google-sheets.js';
// 2026-05-04: telegram 2-채널 분리 후 sendBookingAlert / generateBookingAlert / notify
// 직접 호출은 미사용. _telegram.js / _ai-employees.js 의 export 는 다른 파일이 사용하므로 유지.
import { sendDispatchAlert, sendBookingPaymentAlert, sendErrorAlert } from './_telegram.js';
import { sendBookingConfirmation, buildDefaultConfirmationEmail } from './_send-email.js';
import {
  generateConfirmationEmail,
  generateVoucherText,
} from './_ai-employees.js';
import { generateVoucherPDF } from './_generate-voucher.js';
import { createWalletPass }   from './_create-wallet-pass.js';
import { getUsdToKrwRaw } from './_exchange-rate.js';

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
  } = body;

  if (!orderID || !payerEmail) {
    return respond(400, _err('orderID와 payerEmail은 필수입니다.', 'MISSING_FIELDS'));
  }

  console.log('[booking-processor] 예약 처리 시작:', { orderID, payerEmail, amount });

  // capturePaypalOrder에서 전달된 bookingRef가 있으면 그대로 사용 (Firestore↔Sheets 일관성)
  const bookingRef = externalBookingRef || generateBookingRef();
  let exchangeRate = 1380;
  let amountKRW = 0;

  // ── Step 1: 환율 조회 ────────────────────────────────────────────────
  try {
    exchangeRate = await getUsdToKrwRaw();
    amountKRW = Math.round(parseFloat(amount || 0) * exchangeRate);
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
    amountUSD: parseFloat(amount || 0).toFixed(2),
    amountKRW,
    exchangeRate,
    couponApplied: couponApplied || '없음',
    memo: enhancedMemo,
    airport: airport || null,
  };

  const language = detectLanguage(payerEmail, payerName);
  const results = { bookingRef, steps: {} };

  // ── Step 2: Google Sheets 예약 기록 추가 ────────────────────────────
  let sheetsRowHint = null;
  try {
    const sheetsResult = await appendBooking(booking);
    sheetsRowHint = sheetsResult.appendedRow || null;
    results.steps.sheets = 'ok';
    console.log('[booking-processor] Sheets 기록 완료, row:', sheetsRowHint);
  } catch (err) {
    results.steps.sheets = `error: ${err.message}`;
    console.error('[booking-processor] Sheets 기록 실패:', err.message);
    // 비치명적 오류 — 계속 진행
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
    console.log('[booking-processor] 고객 이메일 발송 완료:', payerEmail);
  } catch (err) {
    results.steps.email = `error: ${err.message}`;
    console.error('[booking-processor] 이메일 발송 실패:', err.message);
  }

  // ── Step 7: Google Sheets 상태 '확정'으로 업데이트 (이슈#3 fix: rowHint로 전체 스캔 회피) ──
  try {
    await updateBookingStatus(orderID, '확정', sheetsRowHint);
    results.steps.sheetsUpdate = 'ok';
  } catch (err) {
    results.steps.sheetsUpdate = `error: ${err.message}`;
    console.error('[booking-processor] 상태 업데이트 실패:', err.message);
  }

  // ── 오류가 있었다면 태연님께 알림 ──────────────────────────────────
  const failedSteps = Object.entries(results.steps)
    .filter(([, v]) => v.startsWith('error'))
    .map(([k, v]) => `${k}: ${v}`);

  if (failedSteps.length > 0) {
    try {
      await sendErrorAlert(
        'booking-processor',
        new Error(`일부 단계 실패:\n${failedSteps.join('\n')}`)
      );
    } catch {}
  }

  console.log('[booking-processor] 예약 처리 완료:', results);

  // ── 로열티 포인트 자동 적립 ──────────────────────────────────────────
  try {
    const amountNum = parseFloat(amount) || 0;
    if (amountNum > 0 && body.userId) {
      const loyaltyRes = await fetch(`https://cocotripkr.com/api/loyalty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json(_err(error.message, 'INTERNAL_ERROR'));
  }
}