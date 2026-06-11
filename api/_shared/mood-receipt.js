/**
 * MOOD 예약 확정 영수증 렌더러 (HTML + 텍스트 폴백).
 *
 * MOOD B2B 선불 예약 포털의 예약자(광고사 직원 = 이 흐름의 고객)에게
 * 보내는 예약 확정 + 영수증 이메일 본문을 생성한다.
 *
 * 🔴 돈/잔액 로직은 여기 없음 — 이미 확정된 예약 데이터를 받아 렌더만 한다.
 *    (api/mood-book.js 의 runTransaction 밖, best-effort 발송용.)
 *
 * Security: 모든 사용자/클라이언트 유래 문자열(clientName, bookingId, date,
 *    startTime 등)은 escapeHtml() 을 거쳐 HTML 에 삽입한다. (api/_email-renderer.js
 *    Audit CZ2 패턴과 동일.)
 */

import { escapeHtml } from './escape.js';

const KRW = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const SERVICE_LABEL = { vehicle: '차량', manager: '매니저' };

/**
 * 예약 확정 영수증 이메일 콘텐츠 생성.
 *
 * @param {object} booking
 * @param {string} booking.bookingId    - 예약 번호 (mood_bookings doc id)
 * @param {string} booking.clientName   - 광고사(클라이언트) 표시명
 * @param {string} booking.date         - YYYY-MM-DD
 * @param {string} booking.startTime    - HH:mm
 * @param {number} booking.durationHours- 예약 시간
 * @param {'vehicle'|'manager'} booking.serviceType
 * @param {number} booking.ratePerHour  - 시급 (원)
 * @param {number} booking.amountKRW    - 청구 금액 (원)
 * @param {number} booking.newBalance   - 차감 후 남은 잔액 (원)
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildMoodReceiptEmail(booking) {
  const {
    bookingId,
    clientName,
    date,
    startTime,
    durationHours,
    serviceType,
    ratePerHour,
    amountKRW,
    newBalance,
  } = booking;

  const serviceLabel = SERVICE_LABEL[serviceType] || serviceType || '-';
  const subject = `MOOD 예약 확정 — ${date} ${startTime} (${serviceLabel} ${durationHours}시간)`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MOOD 예약 확정</title>
</head>
<body style="font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f3f4f6;">

  <!-- 헤더 -->
  <div style="background:#16161d;border-radius:12px 12px 0 0;padding:30px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:3px;">MOOD</h1>
    <p style="color:#9ca3af;margin:6px 0 0;font-size:12px;letter-spacing:1px;">brand consulting</p>
  </div>

  <div style="background:#fff;padding:30px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <h2 style="color:#16161d;margin:0 0 6px;font-size:20px;">예약 확정 ✅</h2>
    <p style="color:#374151;margin:0 0 22px;font-size:14px;line-height:1.6;">
      ${escapeHtml(clientName)} 님, 예약이 정상 확정되었습니다. 아래는 예약 내역 및 영수증입니다.
    </p>

    <!-- 예약 내역 -->
    <div style="background:#f9fafb;border-left:4px solid #16161d;border-radius:8px;padding:20px;margin:0 0 20px;">
      <h3 style="color:#16161d;margin:0 0 14px;font-size:15px;">📋 예약 내역</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px 8px;color:#6b7280;width:120px;font-size:13px;">예약 번호</td><td style="padding:7px 8px;font-family:monospace;font-size:13px;">${escapeHtml(bookingId)}</td></tr>
        <tr style="background:#fff;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">예약일</td><td style="padding:7px 8px;font-weight:bold;font-size:13px;">${escapeHtml(date)} ${escapeHtml(startTime)}</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">서비스</td><td style="padding:7px 8px;font-size:13px;">${escapeHtml(serviceLabel)}</td></tr>
        <tr style="background:#fff;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">시간</td><td style="padding:7px 8px;font-size:13px;">${escapeHtml(durationHours)}시간 (시급 ${escapeHtml(KRW(ratePerHour))})</td></tr>
      </table>
    </div>

    <!-- 영수증 (금액) -->
    <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:20px;margin:0 0 20px;">
      <h3 style="color:#16161d;margin:0 0 14px;font-size:15px;">🧾 영수증</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px;color:#374151;font-size:14px;">청구 금액</td><td style="padding:8px;text-align:right;font-weight:bold;font-size:16px;color:#16161d;">${escapeHtml(KRW(amountKRW))}</td></tr>
        <tr style="border-top:1px dashed #c7d2fe;"><td style="padding:8px;color:#6b7280;font-size:13px;">남은 잔액</td><td style="padding:8px;text-align:right;font-size:14px;color:#374151;">${escapeHtml(KRW(newBalance))}</td></tr>
      </table>
      <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
        * 본 영수증은 선불 충전 잔액에서 차감된 내역입니다. 금액은 부가세 포함입니다.
      </p>
    </div>

    <!-- 푸터 -->
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:24px;line-height:1.6;">
      MOOD brand consulting<br>
      <!-- TODO: 사업자등록번호 / 상호 / 대표자 / 주소 / 문의 연락처 기입 -->
    </p>
  </div>
</body>
</html>`;

  const text = `MOOD 예약 확정 ✅

${clientName} 님, 예약이 정상 확정되었습니다.

[예약 내역]
예약 번호 : ${bookingId}
예약일     : ${date} ${startTime}
서비스     : ${serviceLabel}
시간       : ${durationHours}시간 (시급 ${KRW(ratePerHour)})

[영수증]
청구 금액  : ${KRW(amountKRW)}
남은 잔액  : ${KRW(newBalance)}
* 선불 충전 잔액에서 차감된 내역입니다. 금액은 부가세 포함입니다.

MOOD brand consulting
${/* TODO: 사업자등록번호 / 상호 / 대표자 / 주소 / 문의 연락처 기입 */ ''}`;

  return { subject, html, text };
}

export default { buildMoodReceiptEmail };
