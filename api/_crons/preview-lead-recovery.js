/**
 * CocoTripKR — 무료 미리보기 이탈 회복 이메일 (Vercel Cron).
 *
 * 매일 UTC 03:00(KST 12:00) — api/preview-lead.js 가 저장한 `preview_leads` 중
 * 결제까지 가지 않은 손님에게 짧은 recovery 이메일을 손님당 평생 딱 1회 발송.
 *
 * 대상: preview_leads where recoveryEmailSentAtMs == null (단일필드 쿼리 —
 *   createdAtMs 범위(24h~7d)는 복합인덱스를 피하려고 코드에서 필터한다).
 * 스킵: (a) 수신거부(marketing_optout) (b) 이미 결제 전환(bookings CONFIRMED,
 *   userEmail/payerEmail 매칭 — api/my-bookings.js 와 동일 2-쿼리 방식) → convertedAtMs 마킹.
 *
 * 🔒 안전: PREVIEW_RECOVERY_ENABLED='true' 일 때만 실제 발송. 미설정/false = 강제
 *   dryRun(매칭·스킵 사유만 로그, Firestore 쓰기 0건, 메일 발송 0건) — review-request.js
 *   와 동일 안전장치(깜짝 고객 메일 방지). 운영자가 dryRun 결과 확인 후 env ON.
 * 🔴 정보통신망법 §50: buildUnsubscribeUrl() 이 빈 문자열(HMAC 시크릿 미설정)이면 그
 *   손님에게는 절대 발송하지 않는다(수신거부 링크 없는 마케팅 메일 금지 — fail closed).
 *
 * 수동: GET /api/cron-runner?job=preview-lead-recovery&dryRun=1  (매칭만, 발송 0)
 *   review-request.js 미러 — getDb/dryRun 강제/sendOperatorSummary 동일 패턴.
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { sendEmail } from '../_send-email.js';
import { sendDiscord } from '../_shared/notify.js';
import { isMarketingOptedOut, buildUnsubscribeUrl } from '../_shared/marketing-optout.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// ponytail: 하루 배치 상한 20 — 백로그가 쌓이면 다음날로 밀린다(멱등이라 유실 없음).
//   상한을 올리려면 maxDuration 여유 확인.
const MAX_PER_RUN = 20;

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

// ── 순수 헬퍼 (단위 테스트 대상) ────────────────────────────────────────

/** 대상 자격: createdAtMs 가 [now-7d, now-24h] 안 (너무 최근=아직 고민 중, 너무 오래=철 지남). */
export function isEligibleForRecovery(lead, nowMs = Date.now()) {
  if (!lead || typeof lead.createdAtMs !== 'number') return false;
  const age = nowMs - lead.createdAtMs;
  return age >= DAY_MS && age <= 7 * DAY_MS;
}

const PLANNER_LINK = 'https://cocotripkr.com/planner?utm_source=email&utm_medium=recovery&utm_campaign=preview_lead';

const I18N = {
  ko: {
    subject: '[CocoTrip] 한국 여행 일정표, 거의 다 왔어요',
    greeting: '안녕하세요,',
    intro: '조금 전 코코트립에서 만들어보신 한국 여행 일정 미리보기 — 한 걸음만 더 가면 전체 일정표를 받아보실 수 있어요.',
    priceLine: '전체 일정표는 <strong>$9.90</strong> — 결제 즉시 확인 가능합니다.',
    btn: '일정표 이어서 받기',
    footer: '더 이상 이런 이메일을 원하지 않으시면 아래에서 수신거부하실 수 있습니다.',
    unsubscribeLabel: '수신거부',
  },
  en: {
    subject: '[CocoTrip] Your Korea itinerary preview is one step away',
    greeting: 'Hi,',
    intro: 'You started a Korea trip preview with CocoTrip — one step left to unlock your full itinerary.',
    priceLine: 'The full itinerary is <strong>$9.90</strong>, available right after checkout.',
    btn: 'Finish my itinerary',
    footer: "Don't want emails like this?",
    unsubscribeLabel: 'Unsubscribe',
  },
  ja: {
    subject: '[CocoTrip] 韓国旅行プランのプレビュー、もう少しで完成です',
    greeting: 'こんにちは、',
    intro: '先ほどCocoTripで作成された韓国旅行プランのプレビュー — あと一歩で完全版のご確認が可能です。',
    priceLine: '完全版は<strong>$9.90</strong> — お支払い後すぐにご確認いただけます。',
    btn: 'プランを完成させる',
    footer: 'このようなメールが不要な場合はこちらから配信停止できます。',
    unsubscribeLabel: '配信停止',
  },
  zh: {
    subject: '[CocoTrip] 您的韩国行程预览只差一步',
    greeting: '您好，',
    intro: '您之前在CocoTrip生成的韩国行程预览 — 只差最后一步即可解锁完整行程。',
    priceLine: '完整行程价格为<strong>$9.90</strong>，付款后立即可查看。',
    btn: '继续获取行程',
    footer: '不想再收到此类邮件？可在下方取消订阅。',
    unsubscribeLabel: '取消订阅',
  },
};

/**
 * 리드 언어 + 수신거부 URL로 4언어 recovery 이메일 빌드.
 * @param {{language?: string}} lead
 * @param {string} unsubscribeUrl - 비어 있으면 호출부가 발송 자체를 건너뛴다(fail closed).
 */
export function buildRecoveryEmail(lead, unsubscribeUrl) {
  const t = I18N[lead && lead.language] || I18N.en;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${t.subject}</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1a1a2e;padding:28px 30px;text-align:center;">
      <h1 style="color:#C4956A;margin:0;font-size:22px;letter-spacing:2px;">COCOTRIPKR</h1>
    </div>
    <div style="padding:30px;">
      <p style="font-size:15px;margin:0 0 12px;color:#1a1a2e;"><strong>${t.greeting}</strong></p>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">${t.intro}</p>
      <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">${t.priceLine}</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${PLANNER_LINK}" style="display:inline-block;background:#1a1a2e;color:#C4956A;text-decoration:none;font-weight:bold;font-size:14px;padding:14px 32px;border-radius:10px;">${t.btn}</a>
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin:24px 0 0;">
        ${t.footer} <a href="${unsubscribeUrl}" style="color:#9ca3af;">${t.unsubscribeLabel}</a><br>
        <a href="https://cocotripkr.com" style="color:#C4956A;text-decoration:none;">cocotripkr.com</a>
      </p>
    </div>
  </div>
</body></html>`;
  const text = [t.greeting, '', t.intro, t.priceLine.replace(/<\/?strong>/g, ''), '', `${t.btn}: ${PLANNER_LINK}`, '', `${t.footer} ${t.unsubscribeLabel}: ${unsubscribeUrl}`, 'cocotripkr.com'].join('\n');
  return { subject: t.subject, html, text };
}

async function sendOperatorSummary({ matchedCount, sentCount, optOutSkipCount, convertedCount, errorCount, dryRun }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const msg = `📧 [미리보기 이탈 회복${dryRun ? ' · DRYRUN' : ''}]\n대상: ${matchedCount}건\n발송: ${sentCount}건\n수신거부 스킵: ${optOutSkipCount}건\n이미 전환: ${convertedCount}건\n오류: ${errorCount}건`;
    await sendDiscord(msg);
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
  } catch (err) {
    console.error('[preview-lead-recovery] telegram skipped:', err.message);
  }
}

/** emailLower 이 CONFIRMED 예약으로 전환됐는지 — api/my-bookings.js 와 동일 2-쿼리(userEmail/payerEmail). */
async function hasConverted(db, emailLower) {
  const [byUser, byPayer] = await Promise.all([
    db.collection('bookings').where('userEmail', '==', emailLower).where('status', '==', 'CONFIRMED').limit(1).get(),
    db.collection('bookings').where('payerEmail', '==', emailLower).where('status', '==', 'CONFIRMED').limit(1).get(),
  ]);
  return !byUser.empty || !byPayer.empty;
}

const previewLeadRecoveryTask = async (dryRunArg = false) => {
  const enabled = process.env.PREVIEW_RECOVERY_ENABLED === 'true';
  const dryRun = dryRunArg || !enabled;
  console.log(`[preview-lead-recovery] 시작 (enabled=${enabled}, dryRun=${dryRun})`);

  const db = initAdminDb('cron/preview-lead-recovery');
  if (!db) return { statusCode: 200, body: { enabled, dryRun, error: 'no-db' } };

  const now = Date.now();
  // 단일필드 쿼리(복합인덱스 회피) — 날짜 범위는 아래에서 코드로 필터.
  const snap = await db.collection('preview_leads').where('recoveryEmailSentAtMs', '==', null).get();
  const candidates = snap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((lead) => isEligibleForRecovery(lead, now))
    .slice(0, MAX_PER_RUN);

  let sentCount = 0, optOutSkipCount = 0, convertedCount = 0, errorCount = 0;
  const matched = [];
  for (const lead of candidates) {
    matched.push({ id: lead.id, language: lead.language });
    if (dryRun) continue; // 강제 dryRun — Firestore 쓰기·메일 발송 0건.
    try {
      if (await isMarketingOptedOut(db, lead.emailLower)) { optOutSkipCount++; continue; }
      if (await hasConverted(db, lead.emailLower)) {
        convertedCount++;
        await lead.ref.update({ convertedAtMs: now });
        continue;
      }
      const unsubscribeUrl = buildUnsubscribeUrl(lead.emailLower);
      if (!unsubscribeUrl) {
        // 정보통신망법 §50 — 수신거부 링크 없이는 절대 발송하지 않는다.
        errorCount++;
        console.error('[preview-lead-recovery] unsubscribe URL 불가(시크릿 미설정?) — 발송 스킵:', lead.id);
        continue;
      }
      const email = buildRecoveryEmail(lead, unsubscribeUrl);
      await sendEmail({ to: lead.emailLower, subject: email.subject, html: email.html, text: email.text });
      await lead.ref.update({ recoveryEmailSentAtMs: now });
      sentCount++;
    } catch (err) {
      errorCount++;
      console.error('[preview-lead-recovery] send failed:', lead.id, err.message);
    }
  }

  if (sentCount > 0 || errorCount > 0 || (dryRun && matched.length > 0)) {
    await sendOperatorSummary({ matchedCount: matched.length, sentCount, optOutSkipCount, convertedCount, errorCount, dryRun });
  }
  return { statusCode: 200, body: { enabled, dryRun, totalCandidates: matched.length, sentCount, optOutSkipCount, convertedCount, errorCount, matched } };
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const r = await previewLeadRecoveryTask(dryRun);
    return res.status(r.statusCode || 200).json(r.body);
  } catch (e) {
    console.error('[preview-lead-recovery] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
