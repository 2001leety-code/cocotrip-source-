/**
 * CocoTripKR — Telegram Bot 알림 모듈
 *
 * 태연님 텔레그램으로 실시간 알림 전송
 * ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *
 * CONTEXT: CocoTripKR 자동화 유틸리티
 */

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
 * 새 예약 알림 (빠른 구조화 버전 — Gemini 없이)
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
인원: ${booking.paxCount || '-'}명

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

  return sendMessage(msg);
}

/**
 * 에러 알림
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

  return sendMessage(msg);
}

/**
 * 날씨 정상 알림
 * @param {object} tourInfo
 * @param {object} weather
 */
export async function sendWeatherOkAlert(tourInfo, weather) {
  const msg = `☀️ <b>내일 날씨 OK</b>

투어: ${tourInfo.tourName || '-'}
지역: ${tourInfo.region || '-'}
날씨: ${weather.description || '-'} / ${weather.temperature || '-'}°C
특이사항: 없음`;

  return sendMessage(msg);
}

export default {
  sendMessage,
  sendLongMessage,
  sendBookingAlert,
  sendErrorAlert,
  sendWeatherOkAlert,
};
