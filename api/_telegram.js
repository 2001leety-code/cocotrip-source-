/**
 * CocoTripKR — Telegram Bot 알림 모듈
 *
 * 태연님 텔레그램으로 실시간 알림 전송
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *
 * CONTEXT: CocoTripKR 자동화 유틸리티
 */

import { notify } from './_shared/notify.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * 텔레그램 메시지 전송
 * @param {string} text - 메시지 텍스트
 * @param {object} options - 추가 옵션
 * @returns {object} API 응답
 */
export async function sendMessage(text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 미설정');
    throw new Error('Telegram 환경변수가 설정되지 않았습니다.');
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || 'HTML',  // HTML 파싱 (굵게, 이탤릭 등)
    disable_web_page_preview: true,
    ...options,
  };

  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error('[telegram] 전송 실패:', data);
    throw new Error(`Telegram 전송 실패: ${data.description}`);
  }

  console.log('[telegram] 메시지 전송 성공, message_id:', data.result?.message_id);
  return data;
}

/**
 * 긴 메시지를 4096자 단위로 분할 전송
 * @param {string} text
 */
export async function sendLongMessage(text) {
  const MAX_LEN = 4096;
  if (text.length <= MAX_LEN) {
    return sendMessage(text);
  }
  const parts = [];
  for (let i = 0; i < text.length; i += MAX_LEN) {
    parts.push(text.slice(i, i + MAX_LEN));
  }
  for (const part of parts) {
    await sendMessage(part);
    // 연속 메시지 사이 짧은 딜레이
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * 공항 픽업 정보 Telegram HTML 섹션 — 터미널/편명/수하물.
 * booking.airport가 없으면 빈 문자열 반환. 기존 호출부는 concat만 추가하면 됨.
 * @param {object} airport - { terminal?, flightNumber?, luggage?: { small?, medium?, large? } }
 */
export function airportSectionHtml(airport) {
  if (!airport || typeof airport !== 'object') return '';
  const { terminal, flightNumber, luggage } = airport;
  const lug = luggage || {};
  const lugTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const hasAny = terminal || flightNumber || lugTotal > 0;
  if (!hasAny) return '';

  const lines = [];
  if (terminal) lines.push(`터미널: <b>${terminal}</b>`);
  if (flightNumber) lines.push(`편명: <b>${flightNumber}</b>`);
  if (lugTotal > 0) {
    lines.push(
      `수하물: <b>${lugTotal}개</b> (S${lug.small ?? 0}·M${lug.medium ?? 0}·L${lug.large ?? 0})`
    );
  }
  return `\n\n✈️ <b>공항 픽업</b>\n━━━━━━━━━━━━━━━\n${lines.join('\n')}`;
}

/**
 * 새 예약 알림 (legacy — booking + dispatch 합본). 호환을 위해 유지하되 신규 호출처는
 * sendDispatchAlert + sendBookingPaymentAlert 두 개를 분리 호출 권장.
 * @param {object} booking
 */
export async function sendBookingAlert(booking) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const rate = booking.exchangeRate || 1380;
  const amountKRW = booking.amountKRW || Math.round(parseFloat(booking.amountUSD || 0) * rate);

  const msg = `🔔 <b>새 예약이 들어왔습니다!</b>

📋 <b>예약 정보</b>
━━━━━━━━━━━━━━━
고객명: ${booking.customerName || '-'}
이메일: ${booking.customerEmail || '-'}
상품: ${booking.product || '-'}
날짜: ${booking.tourDate || '-'}
인원: ${booking.paxCount || '-'}명${airportSectionHtml(booking.airport)}

💰 <b>결제 정보</b>
━━━━━━━━━━━━━━━
결제 금액: $${booking.amountUSD || '0'} USD
원화 환산: ₩${amountKRW.toLocaleString()} (환율 ${rate})
쿠폰 적용: ${booking.couponApplied || '없음'}
PayPal 거래ID: <code>${booking.transactionId || '-'}</code>

📌 <b>다음 단계</b>
- 바우처 발송: 자동 처리됨
- 드라이버 배정: 확인 필요
- 고객 확인 메시지: 자동 발송됨

⏰ ${kst}`;

  // 채널: booking (TELEGRAM_BOOKING_BOT_TOKEN 또는 폴백)
  return notify('booking', msg);
}

/**
 * 2026-05-04: 배차용 정보 — driver bot (dispatch 채널) 으로 송신.
 * 사용자 요청 ("정보는 텔레그램 드라이버로 보내고 결제내역은 코코트립 봇한테").
 * 픽업·드롭·시간·공항·차종·인원·메모 등 운행에 필요한 정보만. 결제 금액·USD·환율·
 * transactionId 같은 재무 정보는 sendBookingPaymentAlert 로 분리.
 * @param {object} booking
 */
export async function sendDispatchAlert(booking) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const route = [booking.pickupLocation, booking.dropoffLocation].filter(Boolean).join(' → ') || '-';

  const msg = `🚐 <b>신규 배차 요청</b>

예약번호: <code>${booking.bookingRef || '-'}</code>
━━━━━━━━━━━━━━━
고객: ${booking.customerName || '-'}
연락처: ${booking.customerPhone || '-'}
상품: ${booking.product || '-'}
날짜: <b>${booking.tourDate || '-'}</b>
인원: ${booking.paxCount || '-'}명
차종: ${booking.vehicleType || '-'}
경로: ${route}${airportSectionHtml(booking.airport)}${booking.memo ? `\n\n📝 메모\n${booking.memo}` : ''}

⏰ ${kst}`;

  return notify('dispatch', msg);
}

/**
 * 2026-05-04: 결제 영수증 — cocotrip bot (booking 채널) 으로 송신.
 * USD/KRW 결제 금액·환율·쿠폰·transactionId 등 재무 정보. 배차 정보 (픽업/드롭/시간)는
 * sendDispatchAlert 로 분리.
 * @param {object} booking
 */
export async function sendBookingPaymentAlert(booking) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const rate = booking.exchangeRate || 1380;
  const amountKRW = booking.amountKRW || Math.round(parseFloat(booking.amountUSD || 0) * rate);

  const msg = `💳 <b>결제 완료</b>

예약번호: <code>${booking.bookingRef || '-'}</code>
━━━━━━━━━━━━━━━
고객: ${booking.customerName || '-'}
이메일: ${booking.customerEmail || '-'}
상품: ${booking.product || '-'}

💰 결제 금액: <b>$${booking.amountUSD || '0'} USD</b>
원화 환산: ₩${amountKRW.toLocaleString()} (환율 ${rate})
쿠폰 적용: ${booking.couponApplied || '없음'}
거래ID: <code>${booking.transactionId || '-'}</code>

⏰ ${kst}`;

  return notify('booking', msg);
}

/**
 * 에러 알림 → error 채널
 * @param {string} funcName - 함수명
 * @param {Error} error
 */
export async function sendErrorAlert(funcName, error) {
  const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const msg = `⚠️ <b>자동화 오류 발생</b>

함수: ${funcName}
오류: ${error.message}
시간: ${kst}

수동 확인이 필요합니다.`;

  return notify('error', msg);
}

/**
 * 날씨 정상 알림 → report 채널
 */
export async function sendWeatherOkAlert(tourInfo, weather) {
  const msg = `☀️ <b>내일 날씨 OK</b>

투어: ${tourInfo.tourName || '-'}
지역: ${tourInfo.region || '-'}
날씨: ${weather.description || '-'} / ${weather.temperature || '-'}°C
특이사항: 없음`;

  return notify('report', msg);
}

export default {
  sendMessage,
  sendLongMessage,
  sendBookingAlert,
  sendDispatchAlert,
  sendBookingPaymentAlert,
  airportSectionHtml,
  sendErrorAlert,
  sendWeatherOkAlert,
};
