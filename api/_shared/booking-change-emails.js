/**
 * 예약 날짜 변경 확인 메일 (2026-10-23, 후속 ②b) — 4개 언어, 새 바우처 PDF 첨부.
 *
 * 회원 = 마이페이지 링크, 게스트 = **새 관리 링크**(`/booking/manage#t=<새 토큰>`; 날짜 변경으로 버전이 올라
 * 옛 링크는 더 이상 통하지 않는다). 무료 취소 기한은 새 날짜 기준 24시간 전이라고 명시한다.
 * 사용자 입력(상품명·픽업 등)은 전부 escapeHtml/escapeAttr 를 거친다(PR #421).
 * 바우처 생성이 실패하면 첨부 없이 보내고 본문에 마이페이지/문의 안내를 넣는다(메일이 우선).
 */
import { escapeHtml, escapeAttr } from './escape.js';
import { sendEmail } from '../_send-email.js';

const COPY = {
  en: {
    subject: (ref) => `[CocoTrip] Booking date changed — ${ref}`,
    title: 'Your booking date has been changed',
    ref: 'Booking ref', product: 'Product', date: 'Date', pickup: 'Pickup', pax: 'Guests',
    attached: 'Your updated voucher is attached.',
    noVoucher: 'We could not attach the updated voucher this time — you can find it in My Page, or reply to this email and we will send it.',
    policy: 'Free cancellation now follows the new date: up to 24 hours before the new tour start (KST).',
    manage: 'Manage booking (cancel or change date)',
    manageNote: 'This new link replaces the one in your earlier emails.',
    myPage: 'Open My Page',
    footer: 'Questions? Just reply to this email.',
  },
  ko: {
    subject: (ref) => `[CocoTrip] 예약 날짜 변경 완료 — ${ref}`,
    title: '예약 날짜가 변경되었습니다',
    ref: '예약번호', product: '상품', date: '일정', pickup: '픽업', pax: '인원',
    attached: '변경된 바우처를 첨부했습니다.',
    noVoucher: '이번에는 새 바우처를 첨부하지 못했습니다 — 마이페이지에서 확인하시거나 이 메일로 회신해 주시면 보내 드리겠습니다.',
    policy: '무료 취소 기한은 이제 새 날짜 기준입니다: 새 투어 시작(한국 시간) 24시간 전까지.',
    manage: '예약 관리(취소·날짜 변경)',
    manageNote: '이 새 링크가 이전 메일의 링크를 대신합니다.',
    myPage: '마이페이지 열기',
    footer: '문의는 이 메일에 회신해 주세요.',
  },
  ja: {
    subject: (ref) => `[CocoTrip] ご予約日を変更しました — ${ref}`,
    title: 'ご予約日が変更されました',
    ref: '予約番号', product: '商品', date: '日程', pickup: 'お迎え', pax: '人数',
    attached: '変更後のバウチャーを添付しました。',
    noVoucher: '今回は新しいバウチャーを添付できませんでした。マイページでご確認いただくか、このメールにご返信いただければお送りします。',
    policy: '無料キャンセルの期限は新しい日程が基準になります：新しいツアー開始（韓国時間）の24時間前まで。',
    manage: '予約管理（キャンセル・日程変更）',
    manageNote: 'この新しいリンクが以前のメールのリンクに代わります。',
    myPage: 'マイページを開く',
    footer: 'ご不明な点はこのメールにご返信ください。',
  },
  zh: {
    subject: (ref) => `[CocoTrip] 预订日期已更改 — ${ref}`,
    title: '您的预订日期已更改',
    ref: '预订编号', product: '产品', date: '日期', pickup: '接送', pax: '人数',
    attached: '已附上更新后的凭证。',
    noVoucher: '本次未能附上新的凭证——您可以在"我的页面"查看，或回复此邮件，我们会发送给您。',
    policy: '免费取消期限现以新日期为准：新行程开始（韩国时间）前24小时。',
    manage: '管理预订（取消·更改日期）',
    manageNote: '此新链接将取代之前邮件中的链接。',
    myPage: '打开我的页面',
    footer: '如有疑问，请直接回复此邮件。',
  },
};

function pickLang(language) {
  const l = String(language || '').slice(0, 2).toLowerCase();
  return COPY[l] ? l : 'en';
}

/**
 * @param {{ language?: string, bookingRef: string, label: string, oldDate: string, newDate: string, tourTime?: string,
 *   pickupLocation?: string, paxCount?: number, manageUrl?: string|null, myPageUrl?: string|null, voucherAttached?: boolean }} args
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildBookingChangeEmail({
  language, bookingRef, label, oldDate, newDate, tourTime, pickupLocation, paxCount, manageUrl, myPageUrl, voucherAttached = true,
}) {
  const c = COPY[pickLang(language)];
  const when = (d) => [d, tourTime].filter(Boolean).join(' ');
  const rows = [
    [c.ref, bookingRef],
    [c.product, label],
    [c.date, `${when(oldDate)} → ${when(newDate)}`],
    [c.pickup, pickupLocation],
    [c.pax, paxCount ? String(paxCount) : ''],
  ].filter(([, v]) => Boolean(v));
  const voucherLine = voucherAttached ? c.attached : c.noVoucher;
  const link = manageUrl
    ? { href: manageUrl, label: c.manage, note: c.manageNote }
    : (myPageUrl ? { href: myPageUrl, label: c.myPage, note: '' } : null);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f7f7f7;margin:0;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;">
<h1 style="font-size:20px;margin:0 0 12px;color:#1a1a2e;">${escapeHtml(c.title)}</h1>
<div style="background:#f0f0fa;border-radius:8px;padding:12px 16px;margin:16px 0;">
${rows.map(([k, v]) => `<p style="margin:4px 0;font-size:14px;color:#444;"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`).join('\n')}
</div>
<p style="font-size:14px;line-height:1.6;color:#444;">${escapeHtml(voucherLine)}</p>
<p style="font-size:14px;line-height:1.6;color:#444;">${escapeHtml(c.policy)}</p>
${link ? `<div style="text-align:center;margin:24px 0;"><a href="${escapeAttr(link.href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:10px;">${escapeHtml(link.label)}</a>${link.note ? `<p style="color:#888;font-size:12px;margin-top:8px;">${escapeHtml(link.note)}</p>` : ''}</div>` : ''}
<p style="font-size:12px;color:#888;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">${escapeHtml(c.footer)}</p>
</div></body></html>`;

  const text = [
    c.title,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    voucherLine,
    c.policy,
    ...(link ? ['', `${link.label}: ${link.href}`, ...(link.note ? [link.note] : [])] : []),
    '',
    c.footer,
  ].join('\n');

  return { subject: c.subject(bookingRef), html, text };
}

/**
 * 저장된 예약 문서 → 바우처 생성 입력. 저장 형태(capturePaypalOrder 의 bookingDocPayload)에는
 * `customerName`·`product`·`transactionId` 가 없고 `payerName`·`productType`·`orderID` 가 있다 —
 * 기존 값을 우선하고 없으면 저장 필드로 채운다(그대로 넘기면 바우처에 이름·상품·거래번호가 빈다).
 */
export function buildChangeVoucherInput(booking, bookingID, newDate) {
  const b = booking || {};
  return {
    ...b,
    tourDate: newDate,
    bookingRef: b.bookingRef || bookingID,
    customerName: b.customerName || b.payerName,
    product: b.product || b.productType,
    transactionId: b.transactionId || b.orderID || bookingID,
  };
}

/**
 * 변경 확인 메일 발송(바우처 재생성·첨부 포함). 수신자 = 회원 이메일, 없으면 결제자 이메일.
 * @returns {Promise<{ sent: boolean, voucherAttached: boolean, error?: string }>} — throw 하지 않는다.
 */
export async function sendBookingChangeEmail({
  booking, bookingID, label, oldDate, newDate, manageUrl = null, myPageUrl = null,
}) {
  const b = booking || {};
  const to = b.userEmail || b.payerEmail;
  if (!to) return { sent: false, voucherAttached: false, error: 'NO_RECIPIENT' };

  let pdf = null;
  try {
    // 동적 import — 메모·공항 변경처럼 메일을 안 보내는 호출이 Chromium 모듈을 싣지 않게.
    const { generateVoucherPDF } = await import('../_generate-voucher.js');
    pdf = await generateVoucherPDF(buildChangeVoucherInput(b, bookingID, newDate));
  } catch (err) {
    console.warn('[booking-change-email] voucher generation failed — sending without attachment:', err && err.message);
  }
  const voucherAttached = Boolean(pdf);
  const { subject, html, text } = buildBookingChangeEmail({
    language: b.language,
    bookingRef: b.bookingRef || bookingID,
    label,
    oldDate,
    newDate,
    tourTime: b.tourTime || '',
    pickupLocation: b.pickupLocation || '',
    paxCount: Number(b.paxCount) || 0,
    manageUrl,
    myPageUrl,
    voucherAttached,
  });
  try {
    await sendEmail({
      to,
      subject,
      html,
      text,
      attachments: voucherAttached ? [{ filename: 'CocoTripKR_Voucher.pdf', content: pdf, contentType: 'application/pdf' }] : [],
    });
    return { sent: true, voucherAttached };
  } catch (err) {
    return { sent: false, voucherAttached, error: (err && err.message) || 'SEND_FAILED' };
  }
}
