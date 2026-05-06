/**
 * Manual PayPal 결제 흐름용 이메일 템플릿 (4-lang).
 *
 * 3 종류:
 *   - confirmedEmail   : 결제 확인 후 사용자에게 발송 (mark-paid)
 *   - refundedEmail    : PayPal 수동 환불 후 사용자에게 발송 (mark-refunded)
 *   - canceledEmail    : 예약 취소 후 사용자에게 발송 (mark-canceled)
 *
 * `_send-email.js` sendEmail() 로 발송. HTML + plain text 모두 반환.
 */

function commonStyles() {
  return `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f7f7f7; margin: 0; padding: 24px; }
      .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.05); }
      h1 { font-size: 20px; margin: 0 0 12px; color: #1a1a2e; }
      p  { font-size: 14px; line-height: 1.6; color: #444; margin: 0 0 12px; }
      .ref { font-family: monospace; font-weight: 700; color: #7C5CFC; }
      .total { background: #f0f0fa; border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
      .footer { font-size: 12px; color: #888; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; }
      a { color: #7C5CFC; }
    </style>`;
}

const TEMPLATES = {
  confirmed: {
    ko: {
      subject: (ref) => `[CocoTrip] 결제 확정 — ${ref}`,
      title: '결제 확정 완료 ✅',
      body: (b) => `
        <p>안녕하세요,</p>
        <p>PayPal 결제가 정상 확인되어 예약이 확정되었습니다.</p>
        <div class="total">
          <p style="margin:0"><strong>예약번호:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>상품:</strong> ${b.productType}</p>
          <p style="margin:6px 0 0"><strong>금액:</strong> ₩${(b.priceKRW || 0).toLocaleString('ko-KR')}</p>
        </div>
        <p>곧 영수증과 자세한 안내가 발송됩니다. 추가 문의는 본 메일로 회신해 주세요.</p>`,
    },
    en: {
      subject: (ref) => `[CocoTrip] Payment Confirmed — ${ref}`,
      title: 'Payment Confirmed ✅',
      body: (b) => `
        <p>Hi there,</p>
        <p>Your PayPal payment has been verified and your booking is confirmed.</p>
        <div class="total">
          <p style="margin:0"><strong>Booking ref:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>Product:</strong> ${b.productType}</p>
          <p style="margin:6px 0 0"><strong>Amount:</strong> ₩${(b.priceKRW || 0).toLocaleString('en-US')}</p>
        </div>
        <p>Your receipt and detailed instructions will follow shortly. Reply to this email if you have any questions.</p>`,
    },
    ja: {
      subject: (ref) => `[CocoTrip] 決済確定 — ${ref}`,
      title: '決済が確定しました ✅',
      body: (b) => `
        <p>こんにちは,</p>
        <p>PayPalの入金を確認し、ご予約が確定しました。</p>
        <div class="total">
          <p style="margin:0"><strong>予約番号:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>商品:</strong> ${b.productType}</p>
          <p style="margin:6px 0 0"><strong>金額:</strong> ₩${(b.priceKRW || 0).toLocaleString('ja-JP')}</p>
        </div>
        <p>領収書と詳細な案内は追ってお送りします。ご質問はこのメールにご返信ください。</p>`,
    },
    zh: {
      subject: (ref) => `[CocoTrip] 付款已确认 — ${ref}`,
      title: '付款已确认 ✅',
      body: (b) => `
        <p>您好,</p>
        <p>PayPal 付款已核实,您的预订已确认。</p>
        <div class="total">
          <p style="margin:0"><strong>预订编号:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>商品:</strong> ${b.productType}</p>
          <p style="margin:6px 0 0"><strong>金额:</strong> ₩${(b.priceKRW || 0).toLocaleString('zh-CN')}</p>
        </div>
        <p>收据和详细说明将很快发送。如有问题,请回复此邮件。</p>`,
    },
  },
  refunded: {
    ko: {
      subject: (ref) => `[CocoTrip] 환불 완료 — ${ref}`,
      title: '환불 처리 완료 💸',
      body: (b) => `
        <p>안녕하세요,</p>
        <p>요청하신 환불이 PayPal 을 통해 처리되었습니다.</p>
        <div class="total">
          <p style="margin:0"><strong>예약번호:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>환불 금액:</strong> ₩${(b.refundedKRW || 0).toLocaleString('ko-KR')}</p>
          ${b.refundReason ? `<p style="margin:6px 0 0"><strong>사유:</strong> ${b.refundReason}</p>` : ''}
        </div>
        <p>실제 PayPal 계정으로 입금되기까지 영업일 기준 2-5일 소요될 수 있습니다.</p>`,
    },
    en: {
      subject: (ref) => `[CocoTrip] Refund Processed — ${ref}`,
      title: 'Refund Processed 💸',
      body: (b) => `
        <p>Hi there,</p>
        <p>Your refund has been processed via PayPal.</p>
        <div class="total">
          <p style="margin:0"><strong>Booking ref:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>Refund amount:</strong> ₩${(b.refundedKRW || 0).toLocaleString('en-US')}</p>
          ${b.refundReason ? `<p style="margin:6px 0 0"><strong>Reason:</strong> ${b.refundReason}</p>` : ''}
        </div>
        <p>Funds typically arrive in your PayPal balance within 2-5 business days.</p>`,
    },
    ja: {
      subject: (ref) => `[CocoTrip] 返金処理完了 — ${ref}`,
      title: '返金処理が完了しました 💸',
      body: (b) => `
        <p>こんにちは,</p>
        <p>PayPalによる返金処理が完了しました。</p>
        <div class="total">
          <p style="margin:0"><strong>予約番号:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>返金額:</strong> ₩${(b.refundedKRW || 0).toLocaleString('ja-JP')}</p>
          ${b.refundReason ? `<p style="margin:6px 0 0"><strong>理由:</strong> ${b.refundReason}</p>` : ''}
        </div>
        <p>PayPal口座への着金まで営業日で2〜5日かかる場合があります。</p>`,
    },
    zh: {
      subject: (ref) => `[CocoTrip] 退款已处理 — ${ref}`,
      title: '退款已处理 💸',
      body: (b) => `
        <p>您好,</p>
        <p>您的退款已通过 PayPal 处理。</p>
        <div class="total">
          <p style="margin:0"><strong>预订编号:</strong> <span class="ref">${b.bookingRef}</span></p>
          <p style="margin:6px 0 0"><strong>退款金额:</strong> ₩${(b.refundedKRW || 0).toLocaleString('zh-CN')}</p>
          ${b.refundReason ? `<p style="margin:6px 0 0"><strong>原因:</strong> ${b.refundReason}</p>` : ''}
        </div>
        <p>资金通常在 2-5 个工作日内到账您的 PayPal 余额。</p>`,
    },
  },
  canceled: {
    ko: {
      subject: (ref) => `[CocoTrip] 예약 취소 — ${ref}`,
      title: '예약이 취소되었습니다',
      body: (b) => `
        <p>안녕하세요,</p>
        <p>예약이 취소 처리되었습니다. 결제가 완료되지 않은 상태였으므로 별도의 환불은 발생하지 않습니다.</p>
        <div class="total">
          <p style="margin:0"><strong>예약번호:</strong> <span class="ref">${b.bookingRef}</span></p>
          ${b.cancelReason ? `<p style="margin:6px 0 0"><strong>사유:</strong> ${b.cancelReason}</p>` : ''}
        </div>
        <p>다시 예약을 원하시면 언제든지 사이트에서 진행해 주세요.</p>`,
    },
    en: {
      subject: (ref) => `[CocoTrip] Booking Canceled — ${ref}`,
      title: 'Booking Canceled',
      body: (b) => `
        <p>Hi there,</p>
        <p>Your booking has been canceled. Since payment was not completed, no refund will be issued.</p>
        <div class="total">
          <p style="margin:0"><strong>Booking ref:</strong> <span class="ref">${b.bookingRef}</span></p>
          ${b.cancelReason ? `<p style="margin:6px 0 0"><strong>Reason:</strong> ${b.cancelReason}</p>` : ''}
        </div>
        <p>Feel free to book again anytime through our site.</p>`,
    },
    ja: {
      subject: (ref) => `[CocoTrip] 予約キャンセル — ${ref}`,
      title: '予約がキャンセルされました',
      body: (b) => `
        <p>こんにちは,</p>
        <p>ご予約がキャンセルされました。決済が完了していないため、返金はありません。</p>
        <div class="total">
          <p style="margin:0"><strong>予約番号:</strong> <span class="ref">${b.bookingRef}</span></p>
          ${b.cancelReason ? `<p style="margin:6px 0 0"><strong>理由:</strong> ${b.cancelReason}</p>` : ''}
        </div>
        <p>再予約をご希望の場合はいつでもサイトからお手続きください。</p>`,
    },
    zh: {
      subject: (ref) => `[CocoTrip] 预订已取消 — ${ref}`,
      title: '预订已取消',
      body: (b) => `
        <p>您好,</p>
        <p>您的预订已取消。由于付款未完成,不会产生退款。</p>
        <div class="total">
          <p style="margin:0"><strong>预订编号:</strong> <span class="ref">${b.bookingRef}</span></p>
          ${b.cancelReason ? `<p style="margin:6px 0 0"><strong>原因:</strong> ${b.cancelReason}</p>` : ''}
        </div>
        <p>如需再次预订,请随时通过我们的网站进行。</p>`,
    },
  },
};

const FOOTERS = {
  ko: '<p>— CocoTrip 팀</p><p>본 메일은 자동 발송된 안내 메일입니다.</p>',
  en: '<p>— The CocoTrip Team</p><p>This is an automated notification.</p>',
  ja: '<p>— CocoTripチーム</p><p>本メールは自動送信です。</p>',
  zh: '<p>— CocoTrip 团队</p><p>本邮件为自动通知。</p>',
};

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * 4-lang 이메일 빌더.
 *
 * @param {'confirmed'|'refunded'|'canceled'} kind
 * @param {object} booking pending_bookings doc 데이터
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildManualPaymentEmail(kind, booking) {
  const lang = (['ko', 'en', 'ja', 'zh'].includes(booking.language) ? booking.language : 'en');
  const t = TEMPLATES[kind]?.[lang] || TEMPLATES[kind]?.en;
  if (!t) throw new Error(`[manual-payment-emails] unknown kind: ${kind}`);
  const subject = t.subject(booking.bookingRef);
  const bodyHtml = t.body(booking);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${commonStyles()}</head><body><div class="container"><h1>${t.title}</h1>${bodyHtml}<div class="footer">${FOOTERS[lang] || FOOTERS.en}</div></div></body></html>`;
  const text = stripHtml(`${t.title}\n\n${bodyHtml}\n\n${FOOTERS[lang] || FOOTERS.en}`);
  return { subject, html, text };
}
