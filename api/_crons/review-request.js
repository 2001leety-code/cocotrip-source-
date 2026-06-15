/**
 * CocoTripKR — 투어 후 리뷰 요청 (Vercel Cron). 자가운영 에이전시 💬 고객 직원 (배치 B).
 *
 * 매일 KST 11:00 (UTC 02:00) — 어제 투어(tourDate = 어제 KST) 완료 손님에게 리뷰 요청 1회.
 *   - bookings where status=CONFIRMED, tourDate == 어제 KST, reviewRequestSent absent
 *   - 4언어 i18n (payerEmail/payerName 로 detectLanguage)
 *   - 발송 후 reviewRequestSent: serverTimestamp() 마킹 → 중복 방지 (모닝브리핑 reviewsSent 가 이 마커 집계)
 *
 * 🔒 안전: REVIEW_REQUEST_ENABLED='true' 일 때만 실제 발송. 미설정/false = 강제 dryRun(매칭만, 발송 0).
 *   운영자가 dryRun 으로 매칭 확인 + 발송 타이밍 정책 확정 후 env 플래그 ON. (깜짝 고객 메일 방지.)
 * 🟢 2026-06-10: 운영자 REVIEW_REQUEST_ENABLED=true 설정 → prod 활성. (env 반영엔 설정 이후 fresh 배포 필수 — #754.)
 *
 * 수동: GET /api/cron-runner?job=review-request&dryRun=1  (매칭만)
 *   refund-reminder.js 미러 — getDb/detectLanguage/sendOperatorSummary 동일 패턴.
 */
import { Buffer } from 'buffer';
import { sendEmail } from '../_send-email.js';
import { sendDiscord } from '../_shared/notify.js';

async function getDb() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    let credential = null;
    const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
    const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
    let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/^﻿/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
    if (projectId && clientEmail && rawKey) {
      const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
      if (pemMatch) {
        const b = pemMatch[1].replace(/\s+/g, '');
        rawKey = '-----BEGIN PRIVATE KEY-----\n' + (b.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
      }
      credential = cert({ projectId, clientEmail, privateKey: rawKey });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
      credential = cert(sa);
    }
    if (!credential) throw new Error('Firebase admin credentials not configured');
    initializeApp({ credential });
  }
  return { db: getFirestore(), FieldValue };
}

// ── 순수 헬퍼 (단위 테스트 대상) ────────────────────────────────────────
export function detectLanguage(email = '', name = '') {
  if (email.endsWith('.jp') || /[぀-ヿ]/.test(name)) return 'ja';
  if (email.endsWith('.cn') || /[一-鿿]/.test(name)) return 'zh';
  if (/[가-힯]/.test(name)) return 'ko';
  return 'en';
}

/** KST 어제 날짜 ISO (YYYY-MM-DD) — 어제 투어 완료자가 대상. */
export function reviewTargetDateKST(nowReal = new Date()) {
  const kst = new Date(nowReal.getTime() + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

/** 리뷰 요청 대상 자격: CONFIRMED + tourDate==대상 + 미발송 + 이메일 있음. */
export function qualifiesForReview(b, targetDate) {
  if (!b || b.status !== 'CONFIRMED') return false;
  if (b.tourDate !== targetDate) return false;
  if (b.reviewRequestSent) return false;
  if (!b.payerEmail) return false;
  return true;
}

// ── 4언어 i18n ───────────────────────────────────────────────────────
const REVIEW_URL = 'https://cocotripkr.com/mypage';
const I18N = {
  ko: {
    subject: '[CocoTrip] 여행은 어떠셨나요? 후기를 들려주세요 🌸',
    greeting: (n) => `안녕하세요 ${n || '고객'}님,`,
    intro: '어제 코코트립과 함께한 여행이 즐거우셨길 바랍니다. 잠깐 시간 내어 후기를 남겨주시면 큰 힘이 됩니다.',
    box: '⭐ 솔직한 한 줄 후기가 다음 여행자에게 큰 도움이 됩니다.',
    btn: '후기 남기기',
    footer: '다시 만날 날을 기다리겠습니다. 코코트립 🇰🇷',
  },
  en: {
    subject: '[CocoTrip] How was your trip? We’d love your review 🌸',
    greeting: (n) => `Hi ${n || 'there'},`,
    intro: 'We hope you enjoyed your trip with CocoTrip yesterday. A quick review would mean a lot to us.',
    box: '⭐ Your honest review helps the next traveler so much.',
    btn: 'Leave a Review',
    footer: 'Hope to see you again. CocoTrip 🇰🇷',
  },
  ja: {
    subject: '[CocoTrip] ご旅行はいかがでしたか？ご感想をお聞かせください 🌸',
    greeting: (n) => `${n || 'お客様'}、こんにちは。`,
    intro: '昨日のCocoTripでのご旅行が楽しい時間であったことを願っています。少しだけお時間をいただき、ご感想をお寄せいただけると幸いです。',
    box: '⭐ 率直なご感想が次の旅行者の大きな助けになります。',
    btn: '感想を書く',
    footer: 'またお会いできる日を楽しみにしています。CocoTrip 🇰🇷',
  },
  zh: {
    subject: '[CocoTrip] 旅程还愉快吗？期待您的评价 🌸',
    greeting: (n) => `${n || '尊敬的客户'},您好,`,
    intro: '希望您昨天与CocoTrip的旅程愉快。如能抽空留下评价,将是对我们莫大的鼓励。',
    box: '⭐ 您真实的评价能帮到下一位旅行者。',
    btn: '留下评价',
    footer: '期待与您再次相见。CocoTrip 🇰🇷',
  },
};

function buildReviewEmail(booking, lang) {
  const t = I18N[lang] || I18N.en;
  const name = booking.payerName || booking.customerName;
  const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><title>${t.subject}</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a1a2e;padding:28px 30px;text-align:center;">
      <h1 style="color:#C4956A;margin:0;font-size:22px;letter-spacing:2px;">COCOTRIPKR</h1>
      <p style="color:#aaa;margin:6px 0 0;font-size:12px;">Korea Private Tour &amp; Transfer</p>
    </div>
    <div style="padding:30px;">
      <p style="font-size:15px;margin:0 0 12px;color:#1a1a2e;"><strong>${t.greeting(name)}</strong></p>
      <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">${t.intro}</p>
      <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 18px;margin:20px 0;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#92400e;">${t.box}</p>
      </div>
      <div style="text-align:center;margin:28px 0;">
        <a href="${REVIEW_URL}" style="display:inline-block;background:#1a1a2e;color:#C4956A;text-decoration:none;font-weight:bold;font-size:14px;padding:14px 32px;border-radius:10px;">${t.btn}</a>
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin:24px 0 0;">${t.footer}<br><a href="https://cocotripkr.com" style="color:#C4956A;text-decoration:none;">cocotripkr.com</a></p>
    </div>
  </div>
</body></html>`;
  const text = [t.greeting(name), '', t.intro, '', t.box, '', `${t.btn}: ${REVIEW_URL}`, '', t.footer, 'cocotripkr.com'].join('\n');
  return { subject: t.subject, html, text };
}

async function sendOperatorSummary({ targetDate, sentCount, skippedCount, errorCount, dryRun }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const msg = `🌸 [리뷰 요청 발송${dryRun ? ' · DRYRUN' : ''}]\n대상일(투어): ${targetDate}\n발송: ${sentCount}건\n스킵: ${skippedCount}건\n오류: ${errorCount}건`;
    await sendDiscord(msg); // 디스코드 미러 (DISCORD_WEBHOOK_URL 설정 시)
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
  } catch (err) {
    console.error('[review-request] telegram skipped:', err.message);
  }
}

const reviewRequestTask = async (dryRunArg = false) => {
  // 🔒 플래그 OFF = 강제 dryRun (깜짝 고객 메일 방지).
  const enabled = process.env.REVIEW_REQUEST_ENABLED === 'true';
  const dryRun = dryRunArg || !enabled;
  const target = reviewTargetDateKST(new Date());
  console.log(`[review-request] 시작 (enabled=${enabled}, dryRun=${dryRun}, 대상 tourDate=${target})`);

  const { db, FieldValue } = await getDb();
  const snap = await db.collection('bookings')
    .where('status', '==', 'CONFIRMED')
    .where('tourDate', '==', target)
    .get();

  let sentCount = 0, skippedCount = 0, errorCount = 0;
  const matched = [];
  for (const doc of snap.docs) {
    const b = doc.data();
    if (!qualifiesForReview(b, target)) { skippedCount++; continue; }
    matched.push({ id: doc.id, ref: b.bookingRef, email: b.payerEmail });
    if (dryRun) continue;
    try {
      const lang = detectLanguage(b.payerEmail, b.payerName || '');
      const email = buildReviewEmail(b, lang);
      await sendEmail({ to: b.payerEmail, subject: email.subject, html: email.html, text: email.text });
      await doc.ref.update({ reviewRequestSent: FieldValue.serverTimestamp(), reviewRequestLang: lang });
      sentCount++;
    } catch (err) {
      errorCount++;
      console.error('[review-request] send failed:', b.bookingRef, err.message);
    }
  }

  if (sentCount > 0 || errorCount > 0 || (dryRun && matched.length > 0)) {
    await sendOperatorSummary({ targetDate: target, sentCount, skippedCount, errorCount, dryRun });
  }
  return { statusCode: 200, body: { enabled, dryRun, targetDate: target, totalMatched: snap.size, sentCount, skippedCount, errorCount, matched } };
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const r = await reviewRequestTask(dryRun);
    return res.status(r.statusCode || 200).json(r.body);
  } catch (e) {
    console.error('[review-request] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
