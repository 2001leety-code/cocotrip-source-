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
const SERVICE_LABEL = { vehicle: '차량', airport: '공항', manager: '매니저' };

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
  // 정액 서비스(공항)는 durationHours=0 → "정액" 표기 (0시간 방지).
  const durationLabel = Number(durationHours) > 0 ? `${durationHours}시간 (시급 ${KRW(ratePerHour)})` : '정액';
  const subject = `MOOD 예약 확정 — ${date} ${startTime} (${serviceLabel}${Number(durationHours) > 0 ? ` ${durationHours}시간` : ''})`;

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
        <tr style="background:#fff;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">시간</td><td style="padding:7px 8px;font-size:13px;">${escapeHtml(durationLabel)}</td></tr>
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
시간       : ${durationLabel}

[영수증]
청구 금액  : ${KRW(amountKRW)}
남은 잔액  : ${KRW(newBalance)}
* 선불 충전 잔액에서 차감된 내역입니다. 금액은 부가세 포함입니다.

MOOD brand consulting
${/* TODO: 사업자등록번호 / 상호 / 대표자 / 주소 / 문의 연락처 기입 */ ''}`;

  return { subject, html, text };
}

/**
 * 최종 정산 영수증 — 운행 종료 후 실제 시간/거리 기준 최종 금액 + 무엇이 추가됐는지 분해.
 *
 * "뭐가 추가됐는지 자세히" — 예약 vs 실제 비교(시간·거리) + 항목별(기본/거리추가/톨비) 분해를
 * 보여준다. 추가 방문지로 거리가 재측정되면 그 사실도 명시.
 *
 * @param {object} s
 * @param {string} s.clientName · s.bookingId · s.date · s.startTime
 * @param {'vehicle'|'manager'} s.serviceType
 * @param {number} [s.bookedHours]  - 예약 시간 / @param {number} s.actualHours - 실제 시간
 * @param {number} [s.bookedKm]     - 예약 거리 / @param {number} [s.actualKm] - 실제(재측정) 거리
 * @param {number} [s.ratePerHour]  - 시급
 * @param {number} [s.baseKRW]      - 기본요금(시급×시간)
 * @param {number} [s.distanceSurchargeKRW] - 거리 추가요금
 * @param {number} [s.tollKRW]      - 톨비
 * @param {number} [s.bookedAmountKRW] - 선결제(예약 시) 금액
 * @param {number} s.finalAmountKRW - 최종 금액
 * @param {number} s.adjustmentKRW  - 선결제 대비 차액(>0 추가차감 / <0 환원)
 * @param {number} s.newBalance     - 정산 후 잔액
 * @param {boolean}[s.routeRecomputed] - 추가 방문지로 거리 재측정했는지
 * @param {number} [s.waypointCount]   - 경유(방문)지 수
 */
export function buildMoodSettlementReceiptEmail(s) {
  const {
    clientName, bookingId, date, startTime, serviceType,
    bookedHours, actualHours, bookedKm, actualKm,
    ratePerHour, baseKRW, distanceSurchargeKRW, tollKRW,
    bookedAmountKRW, finalAmountKRW, adjustmentKRW, newBalance,
    routeRecomputed, waypointCount,
  } = s;

  const serviceLabel = SERVICE_LABEL[serviceType] || serviceType || '-';
  const bookedH = Number(bookedHours) || 0;
  const actH = Number(actualHours) || 0;
  const billableH = Math.max(3, actH); // 최소 3시간 청구
  const bookedKmN = Number(bookedKm) || 0;
  const actKmN = Number(actualKm) || 0;
  const rate = Number(ratePerHour) || 0;
  const base = Number(baseKRW) || 0;
  const surcharge = Number(distanceSurchargeKRW) || 0;
  const toll = Number(tollKRW) || 0;
  const bookedAmt = Number(bookedAmountKRW) || 0;
  const recomputed = !!routeRecomputed;
  const wpCount = Number(waypointCount) || 0;
  const hasRoute = recomputed || actKmN > 0 || bookedKmN > 0 || surcharge > 0 || toll > 0;

  const adjLabel = adjustmentKRW > 0 ? `추가 차감 ${KRW(adjustmentKRW)}`
    : adjustmentKRW < 0 ? `환원 ${KRW(-adjustmentKRW)}` : '조정 없음';
  const adjColor = adjustmentKRW > 0 ? '#dc2626' : adjustmentKRW < 0 ? '#16a34a' : '#374151';
  const subject = `MOOD 최종 정산 — ${date} ${startTime} (${serviceLabel} ${actH}시간)`;

  // 시간 비교 — 예약→실제 (+초과분 강조)
  const hourDelta = actH - bookedH;
  const hourCompare = bookedH > 0
    ? `${bookedH}시간 → <b>${actH}시간</b>${hourDelta > 0 ? ` <span style="color:#dc2626;">(+${hourDelta}시간 초과)</span>` : hourDelta < 0 ? ` <span style="color:#16a34a;">(${hourDelta}시간)</span>` : ''}`
    : `<b>${actH}시간</b>`;
  // 거리 비교 — 예약→실제 (추가 방문지 반영 명시)
  const kmDelta = Math.round((actKmN - bookedKmN) * 10) / 10;
  const kmCompare = recomputed
    ? `${bookedKmN}km → <b>${actKmN}km</b>${kmDelta > 0 ? ` <span style="color:#dc2626;">(+${kmDelta}km)</span>` : ''}${wpCount > 0 ? ` <span style="color:#6b7280;">· 추가 방문지 ${wpCount}곳 반영</span>` : ''}`
    : `<b>${actKmN}km</b>`;

  // 항목별 분해 행 (값 있을 때만)
  const lineRows = [
    `<tr><td style="padding:8px;color:#374151;font-size:14px;">기본요금 <span style="color:#9ca3af;font-size:12px;">(시급 ${KRW(rate)} × ${billableH}시간)</span></td><td style="padding:8px;text-align:right;font-size:14px;color:#16161d;">${KRW(base)}</td></tr>`,
    surcharge > 0 ? `<tr style="border-top:1px dashed #e5e7eb;"><td style="padding:8px;color:#374151;font-size:14px;">거리 추가요금 <span style="color:#9ca3af;font-size:12px;">(${actKmN}km)</span></td><td style="padding:8px;text-align:right;font-size:14px;color:#16161d;">+${KRW(surcharge)}</td></tr>` : '',
    toll > 0 ? `<tr style="border-top:1px dashed #e5e7eb;"><td style="padding:8px;color:#374151;font-size:14px;">톨비</td><td style="padding:8px;text-align:right;font-size:14px;color:#16161d;">+${KRW(toll)}</td></tr>` : '',
  ].filter(Boolean).join('');

  const kmRowHtml = hasRoute
    ? `<tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">거리</td><td style="padding:7px 8px;font-size:13px;">${kmCompare}</td></tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>MOOD 최종 정산</title></head>
<body style="font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f3f4f6;">
  <div style="background:#16161d;border-radius:12px 12px 0 0;padding:30px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:3px;">MOOD</h1>
    <p style="color:#9ca3af;margin:6px 0 0;font-size:12px;letter-spacing:1px;">brand consulting</p>
  </div>
  <div style="background:#fff;padding:30px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h2 style="color:#16161d;margin:0 0 6px;font-size:20px;">운행 종료 · 최종 정산 ✅</h2>
    <p style="color:#374151;margin:0 0 22px;font-size:14px;line-height:1.6;">${escapeHtml(clientName)} 님, 운행이 종료되어 실제 이용 내역 기준으로 최종 정산되었습니다. 아래에 예약 대비 변경된 내역을 정리했습니다.</p>
    <div style="background:#f9fafb;border-left:4px solid #16161d;border-radius:8px;padding:20px;margin:0 0 20px;">
      <h3 style="color:#16161d;margin:0 0 14px;font-size:15px;">📋 예약 → 실제</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px 8px;color:#6b7280;width:120px;font-size:13px;">예약 번호</td><td style="padding:7px 8px;font-family:monospace;font-size:13px;">${escapeHtml(bookingId)}</td></tr>
        <tr style="background:#fff;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">예약일</td><td style="padding:7px 8px;font-weight:bold;font-size:13px;">${escapeHtml(date)} ${escapeHtml(startTime)}</td></tr>
        <tr><td style="padding:7px 8px;color:#6b7280;font-size:13px;">서비스</td><td style="padding:7px 8px;font-size:13px;">${escapeHtml(serviceLabel)}</td></tr>
        <tr style="background:#fff;"><td style="padding:7px 8px;color:#6b7280;font-size:13px;">이용 시간</td><td style="padding:7px 8px;font-size:13px;">${hourCompare}</td></tr>
        ${kmRowHtml}
      </table>
    </div>
    <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:20px;margin:0 0 20px;">
      <h3 style="color:#16161d;margin:0 0 14px;font-size:15px;">🧾 최종 영수증</h3>
      <table style="width:100%;border-collapse:collapse;">
        ${lineRows}
        <tr style="border-top:2px solid #c7d2fe;"><td style="padding:10px 8px;color:#16161d;font-size:15px;font-weight:bold;">최종 금액</td><td style="padding:10px 8px;text-align:right;font-weight:bold;font-size:17px;color:#16161d;">${KRW(finalAmountKRW)}</td></tr>
        <tr style="border-top:1px dashed #c7d2fe;"><td style="padding:8px;color:#6b7280;font-size:13px;">선결제(예약 시)</td><td style="padding:8px;text-align:right;font-size:13px;color:#6b7280;">${KRW(bookedAmt)}</td></tr>
        <tr><td style="padding:8px;color:#374151;font-size:14px;">조정</td><td style="padding:8px;text-align:right;font-size:14px;font-weight:bold;color:${adjColor};">${escapeHtml(adjLabel)}</td></tr>
        <tr style="border-top:1px dashed #c7d2fe;"><td style="padding:8px;color:#6b7280;font-size:13px;">남은 잔액</td><td style="padding:8px;text-align:right;font-size:14px;color:#374151;">${KRW(newBalance)}</td></tr>
      </table>
      <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">* 실제 이용 시간(최소 3시간) 기준 최종 정산입니다.${recomputed ? ' 거리는 실제 방문 경로로 재측정했습니다.' : ''} 금액은 부가세 포함입니다.</p>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:24px;line-height:1.6;">MOOD brand consulting</p>
  </div>
</body></html>`;

  // ── 텍스트 폴백 (HTML 비활성 클라이언트) ──
  const hourLine = bookedH > 0 ? `${bookedH}시간 → ${actH}시간${hourDelta > 0 ? ` (+${hourDelta}시간 초과)` : ''}` : `${actH}시간`;
  const kmLine = hasRoute ? `${recomputed ? `${bookedKmN}km → ${actKmN}km${kmDelta > 0 ? ` (+${kmDelta}km, 추가 방문지 ${wpCount}곳)` : ''}` : `${actKmN}km`}` : '';
  const text = `MOOD 운행 종료 · 최종 정산 ✅

${clientName} 님, 실제 이용 내역 기준으로 최종 정산되었습니다.

[예약 → 실제]
예약 번호 : ${bookingId}
예약일     : ${date} ${startTime}
서비스     : ${serviceLabel}
이용 시간  : ${hourLine}${kmLine ? `\n거리       : ${kmLine}` : ''}

[최종 영수증]
기본요금   : ${KRW(base)} (시급 ${KRW(rate)} × ${billableH}시간)${surcharge > 0 ? `\n거리 추가  : +${KRW(surcharge)} (${actKmN}km)` : ''}${toll > 0 ? `\n톨비       : +${KRW(toll)}` : ''}
─────────────
최종 금액  : ${KRW(finalAmountKRW)}
선결제     : ${KRW(bookedAmt)}
조정       : ${adjLabel}
남은 잔액  : ${KRW(newBalance)}
* 실제 이용 시간(최소 3시간) 기준.${recomputed ? ' 거리는 실제 방문 경로로 재측정.' : ''} 부가세 포함.

MOOD brand consulting`;

  return { subject, html, text };
}

export default { buildMoodReceiptEmail, buildMoodSettlementReceiptEmail };
