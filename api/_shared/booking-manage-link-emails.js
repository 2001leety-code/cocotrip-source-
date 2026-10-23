/**
 * 게스트 예약 관리 링크 재발송 메일 (2026-10-23, PR-3) — 4개 언어.
 *
 * 관리자가 "관리 링크 재발송" 을 누르면 저장된 결제자 이메일로 **현재 버전** 관리 링크
 * (`/booking/manage#t=<token>`)를 다시 보낸다. 버전을 올리지 않으므로 이전 메일의 링크도 계속 통한다.
 * 사용자 입력(상품명 등)과 링크는 전부 escapeHtml/escapeAttr 를 거친다(PR #421).
 * 발송은 호출자(admin-booking-action.js)가 한다 — 이 모듈은 본문만 만든다.
 */
import { escapeHtml, escapeAttr } from './escape.js';

const COPY = {
  en: {
    subject: (ref) => `[CocoTrip] Your booking management link — ${ref}`,
    title: 'Here is your booking management link',
    intro: 'We are resending the link to manage your booking. Use the button below to view, cancel or change the date.',
    ref: 'Booking ref', product: 'Product', date: 'Date',
    manage: 'Manage booking (cancel or change date)',
    note: 'Links in your earlier emails keep working. Please do not forward this email — anyone with the link can manage the booking.',
    footer: 'Questions? Just reply to this email.',
  },
  ko: {
    subject: (ref) => `[CocoTrip] 예약 관리 링크 안내 — ${ref}`,
    title: '예약 관리 링크를 보내 드립니다',
    intro: '예약 관리 링크를 다시 보내 드립니다. 아래 버튼에서 예약 확인·취소·날짜 변경을 할 수 있습니다.',
    ref: '예약번호', product: '상품', date: '일정',
    manage: '예약 관리(취소·날짜 변경)',
    note: '이전 메일의 링크도 그대로 사용할 수 있습니다. 링크가 있으면 누구나 예약을 관리할 수 있으니 이 메일을 전달하지 마세요.',
    footer: '문의는 이 메일에 회신해 주세요.',
  },
  ja: {
    subject: (ref) => `[CocoTrip] ご予約管理リンクのご案内 — ${ref}`,
    title: 'ご予約管理リンクをお送りします',
    intro: 'ご予約管理リンクを再送いたします。下のボタンから予約の確認・キャンセル・日程変更ができます。',
    ref: '予約番号', product: '商品', date: '日程',
    manage: '予約管理（キャンセル・日程変更）',
    note: '以前のメールのリンクも引き続きご利用いただけます。リンクを知っている人は誰でも予約を管理できるため、このメールは転送しないでください。',
    footer: 'ご不明な点はこのメールにご返信ください。',
  },
  zh: {
    subject: (ref) => `[CocoTrip] 您的预订管理链接 — ${ref}`,
    title: '这是您的预订管理链接',
    intro: '我们重新发送您的预订管理链接。可通过下方按钮查看、取消预订或更改日期。',
    ref: '预订编号', product: '产品', date: '日期',
    manage: '管理预订（取消·更改日期）',
    note: '之前邮件中的链接仍可继续使用。任何持有此链接的人都可以管理该预订，请勿转发此邮件。',
    footer: '如有疑问，请直接回复此邮件。',
  },
};

function pickLang(language) {
  const l = String(language || '').slice(0, 2).toLowerCase();
  return COPY[l] ? l : 'en';
}

/**
 * @param {{ language?: string, bookingRef: string, label?: string, tourDate?: string, manageUrl: string }} args
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildManageLinkEmail({ language, bookingRef, label, tourDate, manageUrl }) {
  const c = COPY[pickLang(language)];
  const rows = [
    [c.ref, bookingRef],
    [c.product, label],
    [c.date, tourDate],
  ].filter(([, v]) => Boolean(v));

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f7f7f7;margin:0;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;">
<h1 style="font-size:20px;margin:0 0 12px;color:#1a1a2e;">${escapeHtml(c.title)}</h1>
<p style="font-size:14px;line-height:1.6;color:#444;">${escapeHtml(c.intro)}</p>
<div style="background:#f0f0fa;border-radius:8px;padding:12px 16px;margin:16px 0;">
${rows.map(([k, v]) => `<p style="margin:4px 0;font-size:14px;color:#444;"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`).join('\n')}
</div>
<div style="text-align:center;margin:24px 0;"><a href="${escapeAttr(manageUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:10px;">${escapeHtml(c.manage)}</a><p style="color:#888;font-size:12px;margin-top:8px;">${escapeHtml(c.note)}</p></div>
<p style="font-size:12px;color:#888;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">${escapeHtml(c.footer)}</p>
</div></body></html>`;

  const text = [
    c.title,
    '',
    c.intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `${c.manage}: ${manageUrl}`,
    c.note,
    '',
    c.footer,
  ].join('\n');

  return { subject: c.subject(bookingRef), html, text };
}
