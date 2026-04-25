/**
 * CocoTripKR — Free Cancellation Deadline Reminder (Vercel Cron)
 *
 * 매일 23:00 UTC (= 다음날 08:00 KST) 실행 — daily-report 1시간 후
 *
 * 로직:
 *   - Firestore bookings where status=CONFIRMED, freeCancelReminderSent absent
 *   - tourDate == today_KST + 4d (D-4)
 *   - Bronze 자유 취소 데드라인이 D-3(72h 전)이므로 D-4에 알리면 약 24h 결정 시간 제공
 *   - 4언어 i18n (ko/en/ja/zh) — payerName/payerEmail로 detectLanguage
 *   - 발송 후 freeCancelReminderSent: serverTimestamp() 마킹 → 중복 발송 방지
 *
 * 수동 호출:
 *   GET /api/cron-runner?job=refund-reminder         실제 발송
 *   GET /api/cron-runner?job=refund-reminder&dryRun=1  매칭만 리턴, 발송 안 함
 */

import { Buffer } from 'buffer';
import { sendEmail } from '../_send-email.js';

// ── Firebase Admin 초기화 (cancelBooking.js 패턴) ────────────────────
async function getDb() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8'));
    initializeApp({ credential: cert(sa) });
  }
  return { db: getFirestore(), FieldValue };
}

// ── 언어 감지 (booking-processor.js 패턴 재사용) ──────────────────────
function detectLanguage(email = '', name = '') {
  if (email.endsWith('.jp') || /[぀-ヿ]/.test(name)) return 'ja';
  if (email.endsWith('.cn') || /[一-鿿]/.test(name)) return 'zh';
  if (/[가-힯]/.test(name)) return 'ko';
  return 'en';
}

// ── KST 기준 날짜 유틸 ───────────────────────────────────────────────
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function addDaysISO(base, days) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── 4언어 i18n ───────────────────────────────────────────────────────
const I18N = {
  ko: {
    subject: '[CocoTrip] 투어 4일 전 안내 — 자유 취소 데드라인 임박',
    greeting: (n) => `안녕하세요 ${n || '고객'}님,`,
    intro: '예약하신 투어가 4일 앞으로 다가왔습니다. 일정 변경이나 취소가 필요하시면 미리 알려주세요.',
    deadlineBox: '⏰ 자유 취소(100% 환불) 마감까지 약 24시간 남았습니다.',
    refundTitle: '환불 정책 (일반 등급 기준)',
    refundLines: [
      '투어 출발 72시간(3일) 전까지: 100% 환불',
      '48~72시간 전: 80% 환불',
      '24~48시간 전: 50% 환불',
      '24시간 이내·노쇼: 환불 불가',
    ],
    tierNote: '* Gold/Platinum 등급은 더 관대한 정책이 적용됩니다. 자세한 내용은 마이페이지에서 확인해주세요.',
    bookingTitle: '📋 예약 정보',
    refLabel: '예약번호',
    productLabel: '상품',
    dateLabel: '투어일',
    pickupLabel: '픽업',
    paxLabel: '인원',
    paxUnit: '명',
    actionBtn: '예약 관리하기',
    contactTitle: '문의',
    contactLines: [
      'WhatsApp: +82-10-8714-0611',
      'Email: cocotripkr@gmail.com',
    ],
    footer: '즐거운 한국 여행을 위해 코코트립이 함께합니다 🇰🇷',
  },
  en: {
    subject: '[CocoTrip] Tour in 4 Days — Free Cancellation Deadline Approaching',
    greeting: (n) => `Hi ${n || 'there'},`,
    intro: 'Your booked tour is 4 days away. If you need to modify or cancel, please let us know soon.',
    deadlineBox: '⏰ About 24 hours left until the free cancellation (100% refund) deadline.',
    refundTitle: 'Refund Policy (General Tier)',
    refundLines: [
      '72+ hours before tour: 100% refund',
      '48–72 hours before: 80% refund',
      '24–48 hours before: 50% refund',
      'Within 24 hours / no-show: no refund',
    ],
    tierNote: '* Gold/Platinum members enjoy more lenient terms. See your account page for details.',
    bookingTitle: '📋 Booking Details',
    refLabel: 'Booking Ref',
    productLabel: 'Service',
    dateLabel: 'Tour Date',
    pickupLabel: 'Pickup',
    paxLabel: 'Pax',
    paxUnit: 'person(s)',
    actionBtn: 'Manage Booking',
    contactTitle: 'Contact',
    contactLines: [
      'WhatsApp: +82-10-8714-0611',
      'Email: cocotripkr@gmail.com',
    ],
    footer: 'CocoTrip — your private guide to Korea 🇰🇷',
  },
  ja: {
    subject: '[CocoTrip] ツアー4日前のご案内 — 無料キャンセル期限が近づいています',
    greeting: (n) => `${n || 'お客様'}、こんにちは。`,
    intro: 'ご予約のツアーまであと4日です。日程の変更やキャンセルが必要な場合は、お早めにご連絡ください。',
    deadlineBox: '⏰ 無料キャンセル(100%返金)期限まで残り約24時間です。',
    refundTitle: 'キャンセル・返金ポリシー(一般)',
    refundLines: [
      'ツアー開始72時間以上前: 100%返金',
      '48〜72時間前: 80%返金',
      '24〜48時間前: 50%返金',
      '24時間以内・ノーショー: 返金不可',
    ],
    tierNote: '* Gold/Platinum会員はより寛容な条件が適用されます。マイページでご確認ください。',
    bookingTitle: '📋 ご予約内容',
    refLabel: '予約番号',
    productLabel: 'サービス',
    dateLabel: 'ツアー日',
    pickupLabel: 'ピックアップ',
    paxLabel: '人数',
    paxUnit: '名',
    actionBtn: '予約を管理する',
    contactTitle: 'お問い合わせ',
    contactLines: [
      'WhatsApp: +82-10-8714-0611',
      'Email: cocotripkr@gmail.com',
    ],
    footer: '韓国の素敵な旅をCocoTripがサポートします 🇰🇷',
  },
  zh: {
    subject: '[CocoTrip] 行程前4日提醒 — 免费取消截止日临近',
    greeting: (n) => `${n || '尊敬的客户'},您好,`,
    intro: '您预订的行程距出发还有4天。如需更改或取消,请尽早告知我们。',
    deadlineBox: '⏰ 距免费取消(全额退款)截止日仅剩约24小时。',
    refundTitle: '退款政策(普通等级)',
    refundLines: [
      '出发前72小时以上: 全额退款',
      '48–72小时前: 退款80%',
      '24–48小时前: 退款50%',
      '24小时内·未到场: 不予退款',
    ],
    tierNote: '* Gold/Platinum 会员享有更宽松的条款,详情请在会员页面查看。',
    bookingTitle: '📋 预订信息',
    refLabel: '预订编号',
    productLabel: '服务',
    dateLabel: '行程日期',
    pickupLabel: '接送地点',
    paxLabel: '人数',
    paxUnit: '位',
    actionBtn: '管理预订',
    contactTitle: '联系方式',
    contactLines: [
      'WhatsApp: +82-10-8714-0611',
      'Email: cocotripkr@gmail.com',
    ],
    footer: 'CocoTrip 与您一起探索韩国 🇰🇷',
  },
};

// ── 이메일 HTML/Text 빌더 ────────────────────────────────────────────
function buildReminderEmail(booking, lang) {
  const t = I18N[lang] || I18N.en;
  const mypageUrl = 'https://cocotripkr.com/mypage';
  const refundList = t.refundLines.map((l) => `<li style="margin:6px 0;">${l}</li>`).join('');
  const contactList = t.contactLines.map((l) => `<li style="margin:4px 0;">${l}</li>`).join('');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><title>${t.subject}</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a1a2e;padding:28px 30px;text-align:center;">
      <h1 style="color:#C4956A;margin:0;font-size:22px;letter-spacing:2px;">COCOTRIPKR</h1>
      <p style="color:#aaa;margin:6px 0 0;font-size:12px;">Korea Private Tour & Transfer</p>
    </div>
    <div style="padding:30px;">
      <p style="font-size:15px;margin:0 0 12px;color:#1a1a2e;"><strong>${t.greeting(booking.payerName || booking.customerName)}</strong></p>
      <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">${t.intro}</p>

      <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 18px;margin:20px 0;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#92400e;">${t.deadlineBox}</p>
      </div>

      <div style="background:#eff6ff;border-radius:8px;padding:18px 20px;margin:20px 0;">
        <h2 style="margin:0 0 12px;font-size:15px;color:#1a1a2e;">${t.bookingTitle}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 0;color:#6b7280;width:120px;">${t.refLabel}</td><td style="font-family:monospace;font-weight:600;">${booking.bookingRef || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">${t.productLabel}</td><td style="font-weight:600;">${booking.productType || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">${t.dateLabel}</td><td style="font-weight:600;">${booking.tourDate || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">${t.pickupLabel}</td><td>${booking.pickupLocation || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280;">${t.paxLabel}</td><td>${booking.paxCount || '-'} ${t.paxUnit}</td></tr>
        </table>
      </div>

      <h3 style="margin:24px 0 10px;font-size:14px;color:#1a1a2e;">${t.refundTitle}</h3>
      <ul style="margin:0 0 8px;padding-left:20px;color:#374151;font-size:13px;line-height:1.8;">
        ${refundList}
      </ul>
      <p style="margin:8px 0 20px;font-size:11px;color:#9ca3af;">${t.tierNote}</p>

      <div style="text-align:center;margin:28px 0;">
        <a href="${mypageUrl}" style="display:inline-block;background:#1a1a2e;color:#C4956A;text-decoration:none;font-weight:bold;font-size:14px;padding:14px 32px;border-radius:10px;letter-spacing:0.5px;">${t.actionBtn}</a>
      </div>

      <div style="background:#f9fafb;border-radius:8px;padding:14px 18px;margin:20px 0;">
        <h3 style="margin:0 0 8px;font-size:13px;color:#1a1a2e;">${t.contactTitle}</h3>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:12px;list-style:none;">
          ${contactList}
        </ul>
      </div>

      <p style="text-align:center;color:#9ca3af;font-size:12px;margin:24px 0 0;">${t.footer}<br><a href="https://cocotripkr.com" style="color:#C4956A;text-decoration:none;">cocotripkr.com</a></p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    t.greeting(booking.payerName || booking.customerName),
    '',
    t.intro,
    '',
    t.deadlineBox,
    '',
    `── ${t.bookingTitle} ──`,
    `${t.refLabel}: ${booking.bookingRef || '-'}`,
    `${t.productLabel}: ${booking.productType || '-'}`,
    `${t.dateLabel}: ${booking.tourDate || '-'}`,
    `${t.pickupLabel}: ${booking.pickupLocation || '-'}`,
    `${t.paxLabel}: ${booking.paxCount || '-'} ${t.paxUnit}`,
    '',
    `── ${t.refundTitle} ──`,
    ...t.refundLines.map((l) => `- ${l}`),
    '',
    t.tierNote,
    '',
    `${t.actionBtn}: ${mypageUrl}`,
    '',
    `── ${t.contactTitle} ──`,
    ...t.contactLines,
    '',
    t.footer,
    'cocotripkr.com',
  ].join('\n');

  return { subject: t.subject, html, text };
}

// ── Telegram 운영자 알림 (best-effort) ────────────────────────────────
async function sendOperatorSummary({ targetDate, sentCount, skippedCount, errorCount }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const msg =
      `🔔 [환불 reminder 발송 — D-4]\n` +
      `대상일: ${targetDate}\n` +
      `발송 성공: ${sentCount}건\n` +
      `이미 발송됨: ${skippedCount}건\n` +
      `오류: ${errorCount}건`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
  } catch (err) {
    console.error('[refund-reminder] telegram skipped:', err.message);
  }
}

// ── 메인 작업 ────────────────────────────────────────────────────────
const refundReminderTask = async (dryRun = false) => {
  console.log('[refund-reminder] 시작 (dryRun=' + dryRun + ')');
  const target = addDaysISO(todayKST(), 4);
  console.log('[refund-reminder] 대상 tourDate:', target);

  const { db, FieldValue } = await getDb();

  const snap = await db.collection('bookings')
    .where('status', '==', 'CONFIRMED')
    .where('tourDate', '==', target)
    .get();

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const matched = [];

  for (const doc of snap.docs) {
    const b = doc.data();
    matched.push({ id: doc.id, ref: b.bookingRef, email: b.payerEmail, sent: !!b.freeCancelReminderSent });

    if (b.freeCancelReminderSent) {
      skippedCount++;
      continue;
    }
    if (!b.payerEmail) {
      console.warn('[refund-reminder] no email, skip:', doc.id);
      skippedCount++;
      continue;
    }
    if (dryRun) continue;

    try {
      const lang = detectLanguage(b.payerEmail, b.payerName || '');
      const email = buildReminderEmail(b, lang);
      await sendEmail({ to: b.payerEmail, subject: email.subject, html: email.html, text: email.text });
      await doc.ref.update({
        freeCancelReminderSent: FieldValue.serverTimestamp(),
        freeCancelReminderLang: lang,
      });
      sentCount++;
      console.log('[refund-reminder] sent:', b.bookingRef, '→', b.payerEmail, '(' + lang + ')');
    } catch (err) {
      errorCount++;
      console.error('[refund-reminder] send failed:', b.bookingRef, err.message);
    }
  }

  if (!dryRun && (sentCount > 0 || errorCount > 0)) {
    await sendOperatorSummary({ targetDate: target, sentCount, skippedCount, errorCount });
  }

  return {
    statusCode: 200,
    body: { dryRun, targetDate: target, totalMatched: snap.size, sentCount, skippedCount, errorCount, matched },
  };
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const r = await refundReminderTask(dryRun);
    return res.status(r.statusCode || 200).json(r.body);
  } catch (e) {
    console.error('[refund-reminder] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
