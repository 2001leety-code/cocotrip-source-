/**
 * _booking-templates.js — 예약 취소·변경 알림 템플릿 (Telegram + Email)
 *
 * cancelBooking.js / modifyBooking.js 에서 재사용. 간단한 문자열 조립 함수만 제공.
 */

function airportPlainLine(airport) {
  if (!airport || typeof airport !== 'object') return '';
  const { terminal, flightNumber, luggage } = airport;
  const lug = luggage || {};
  const lugTotal = (lug.small ?? 0) + (lug.medium ?? 0) + (lug.large ?? 0);
  const parts = [];
  if (terminal) parts.push(`터미널 ${terminal}`);
  if (flightNumber) parts.push(`편명 ${flightNumber}`);
  if (lugTotal > 0) parts.push(`수하물 ${lugTotal}개(S${lug.small ?? 0}·M${lug.medium ?? 0}·L${lug.large ?? 0})`);
  return parts.length ? `\n공항: ${parts.join(' · ')}` : '';
}

export function cancelTelegramMsg({ bookingRef, productType, paxCount, tourDate, userEmail, refundUSD, refundPercent, reason, airport }) {
  return (
    `🔴 [예약 취소·환불]\n` +
    `${bookingRef}\n` +
    `상품: ${productType} · ${paxCount}명 · ${tourDate}\n` +
    `고객: ${userEmail}\n` +
    `환불: $${refundUSD} (${refundPercent}%)\n` +
    `사유: ${reason || '-'}` +
    airportPlainLine(airport)
  );
}

export function modifyTelegramMsg({ bookingRef, userEmail, summary, airport }) {
  return (
    `🟡 [예약 변경]\n` +
    `${bookingRef}\n` +
    `고객: ${userEmail}\n` +
    `변경: ${summary}` +
    airportPlainLine(airport)
  );
}

export function cancelEmailHtml({ bookingRef, productType, tourDate, paxCount, refundUSD, refundPercent, lang = 'en' }) {
  const title = lang === 'ko' ? '예약이 취소되었습니다' : 'Booking Canceled';
  const subtitle = lang === 'ko' ? '환불이 진행 중입니다 (7~10영업일 소요).' : 'Refund is in progress (7-10 business days).';
  const labels = lang === 'ko'
    ? { no: '예약번호', product: '상품', date: '투어일', pax: '인원', refundLabel: '환불 금액', note: '환불은 결제 시 사용하신 PayPal 계정으로 처리됩니다.' }
    : { no: 'Booking Ref', product: 'Product', date: 'Tour Date', pax: 'Pax', refundLabel: 'Refund', note: 'Refund issued to the PayPal account used at checkout.' };
  return `
<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family: Arial, sans-serif; background:#f5f5f5; padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <h1 style="color:#dc2626;font-size:20px;margin:0 0 8px;">${title}</h1>
    <p style="color:#555;font-size:14px;margin:0 0 24px;">${subtitle}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#777;">${labels.no}</td><td style="text-align:right;font-weight:600;">${bookingRef}</td></tr>
      <tr><td style="padding:8px 0;color:#777;">${labels.product}</td><td style="text-align:right;">${productType}</td></tr>
      <tr><td style="padding:8px 0;color:#777;">${labels.date}</td><td style="text-align:right;">${tourDate}</td></tr>
      <tr><td style="padding:8px 0;color:#777;">${labels.pax}</td><td style="text-align:right;">${paxCount}</td></tr>
      <tr><td style="padding:12px 0;border-top:1px solid #eee;color:#333;font-weight:600;">${labels.refundLabel}</td>
          <td style="text-align:right;border-top:1px solid #eee;padding:12px 0;font-weight:700;color:#16a34a;">$${refundUSD} (${refundPercent}%)</td></tr>
    </table>
    <p style="color:#999;font-size:12px;margin-top:24px;">${labels.note}</p>
  </div>
</body>
</html>
`.trim();
}

export function modifyEmailHtml({ bookingRef, changes, lang = 'en' }) {
  const title = lang === 'ko' ? '예약이 변경되었습니다' : 'Booking Modified';
  const subtitle = lang === 'ko' ? '아래와 같이 변경이 반영되었습니다.' : 'The following changes were applied.';
  const rows = Object.entries(changes)
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#777;">${k}</td><td style="text-align:right;">${v?.from ?? '-'} → ${v?.to ?? '-'}</td></tr>`)
    .join('');
  return `
<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family: Arial, sans-serif; background:#f5f5f5; padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="color:#ca8a04;font-size:20px;margin:0 0 8px;">${title}</h1>
    <p style="color:#555;font-size:14px;margin:0 0 16px;">${subtitle}</p>
    <p style="color:#333;font-size:14px;font-weight:600;margin:0 0 12px;">${bookingRef}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #eee;">${rows}</table>
  </div>
</body>
</html>
`.trim();
}
