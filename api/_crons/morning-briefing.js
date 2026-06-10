/**
 * 모닝 브리핑 cron — 매일 아침 운영자 텔레그램으로 "어제 회사 한 장".
 *
 * 2026-06-10: 자가운영 에이전시. 사무실 4직원이 한 장에:
 *   💰 재무(어제 매출+상품별+주간/월간 추세) · 🛠️ 운영(오류) · 📣 마케팅(방문·전환) · 💬 고객(문의·리뷰).
 * AI 0% = 순수 코드 집계 + HogQL(SQL) + Firestore. 집계 로직은 morningBriefingAggregate.js(순수, 단위 테스트).
 * 마케팅(PostHog)·Sentry 는 graceful — 미설정/실패해도 나머지 섹션 발송.
 * 기존 daily-report(Sheets)는 별개. cron-runner JOBS + vercel.json("30 23 * * *", KST 08:30) 등록.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { notifyOperatorLong } from '../_shared/operator-alerts.js';
import { getUsdToKrwRaw } from '../_exchange-rate.js';
import {
  aggregateMorningBriefing, kstYesterdayWindow, kstWeekStartMs, kstMonthStartMs,
} from '../_shared/morningBriefingAggregate.js';
import { fetchMarketingMetrics } from '../_shared/morningBriefingMarketing.js';

const FALLBACK_RATE = 1450;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtUsd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtKrw = (usd, rate) => `₩${Math.round((Number(usd) || 0) * rate).toLocaleString()}`;

/** 실 epoch → KST 날짜 라벨 "2026-06-09 (월)". */
function ymdKST(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} (${wd})`;
}

function buildMessage(agg, rate, marketing, failedSections) {
  const { revenue, trends, byProduct, aiPlanner, newUsers, errors, customer, meta, window } = agg;
  const L = [
    '☀️ <b>코코트립 모닝 브리핑</b>',
    `📅 ${ymdKST(window.yStartMs)} · 어제 회사 (KST)`,
  ];

  // 💰 재무
  L.push('', '━━━ 💰 재무 ━━━',
    `어제 매출 <b>${fmtUsd(revenue.usd)}</b> · ${revenue.count}건 (${fmtKrw(revenue.usd, rate)})`);
  const productLines = Object.entries(byProduct).filter(([, v]) => v.count > 0)
    .map(([k, v]) => `  · ${esc(k)} ${v.count}건 ${fmtUsd(v.usd)}`);
  if (productLines.length) L.push(...productLines);
  L.push(`이번주 누적 <b>${fmtUsd(trends.week.usd)}</b>(${trends.week.count}건) · 이번달 <b>${fmtUsd(trends.month.usd)}</b>(${trends.month.count}건)`);
  L.push(`AI 플래너 유료 <b>${aiPlanner.paidCount}건</b> · 수수료 ${fmtUsd(aiPlanner.feeUsd)}`);
  L.push(`신규 가입 <b>${newUsers}명</b>`);

  // 🛠️ 운영
  L.push('', '━━━ 🛠️ 운영 ━━━');
  if (errors.total === 0) {
    L.push('어제 오류 <b>0건</b> ✅');
  } else {
    const sev = errors.bySeverity;
    L.push(`어제 오류 <b>${errors.total}건</b> (심각 ${sev.critical} · 높음 ${sev.high} · 보통 ${sev.medium} · 낮음 ${sev.low})`);
    if (errors.top.length) L.push(...errors.top.map((t) => `  · ${esc(t.key)} ${t.count}회`));
  }

  // 📣 마케팅 (graceful)
  L.push('', '━━━ 📣 마케팅 ━━━');
  if (marketing && !marketing.skipped) {
    L.push(`어제 방문자 <b>${(marketing.visitors || 0).toLocaleString()}명</b> · 결제 전환 <b>${marketing.conversions || 0}건</b>`);
  } else {
    L.push(`<i>데이터 수집 중 (PostHog ${marketing && marketing.reason ? esc(marketing.reason) : '미연동'})</i>`);
  }

  // 💬 고객
  L.push('', '━━━ 💬 고객 ━━━',
    `신규 문의 <b>${customer.newTickets}건</b> · 리뷰요청 발송 <b>${customer.reviewsSent}건</b>`);

  // footer
  const foot = [`환율 ₩${rate.toLocaleString()}/$`, `제외 ${meta.excludedBypass + meta.excludedCanceled}건(테스트·취소)`];
  if (failedSections.length) foot.push(`⚠️ 조회실패: ${failedSections.join(',')}`);
  L.push('', `<i>${foot.join(' · ')}</i>`, '🌐 cocotripkr.com/admin');
  return L.join('\n');
}

async function morningBriefingTask() {
  const db = initAdminDb();
  if (!db) {
    await notifyOperatorLong('todo', '⚠️ <b>모닝 브리핑</b>\nFirestore 연결 안 됨 (env 확인 필요).', { skipPrefix: true }).catch(() => {});
    return { statusCode: 200, body: 'no-db' };
  }

  const now = new Date();
  const { yStartMs, todayStartMs } = kstYesterdayWindow(now);
  const weekStartMs = kstWeekStartMs(now);
  const monthStartMs = kstMonthStartMs(now);
  const trendStartMs = Math.min(weekStartMs, monthStartMs); // 추세용 bookings fetch 시작(이른 쪽).

  // createdAt 타입: bookings/users = Firestore Timestamp / plans = createdAtMs(number) / error_log·cs_tickets = number.
  const sinceTrend = Timestamp.fromMillis(trendStartMs);
  const sinceY = Timestamp.fromMillis(yStartMs);
  const untilY = Timestamp.fromMillis(todayStartMs);

  const [bk, pl, us, er, cs] = await Promise.allSettled([
    db.collection('bookings').where('createdAt', '>=', sinceTrend).get(),                                  // 추세용 ~한달치
    db.collection('plans').where('createdAtMs', '>=', yStartMs).where('createdAtMs', '<', todayStartMs).get(),
    db.collection('users').where('createdAt', '>=', sinceY).where('createdAt', '<', untilY).get(),
    db.collection('error_log').where('createdAt', '>=', yStartMs).where('createdAt', '<', todayStartMs).get(), // number
    db.collection('cs_tickets').where('createdAt', '>=', yStartMs).where('createdAt', '<', todayStartMs).get(), // number
  ]);

  const failed = [];
  const docs = (r, label) => {
    if (r.status === 'fulfilled') return r.value.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.error(`[morning-briefing] ${label} 조회 실패:`, r.reason && r.reason.message);
    failed.push(label);
    return [];
  };

  const agg = aggregateMorningBriefing({
    bookingDocs: docs(bk, '예약'),
    planDocs: docs(pl, '플랜'),
    userDocs: docs(us, '가입'),
    errorDocs: docs(er, '오류'),
    cstDocs: docs(cs, '문의'),
  }, { now });

  // 마케팅 — graceful (네트워크).
  const marketing = await fetchMarketingMetrics(yStartMs, todayStartMs).catch((e) => ({ skipped: true, reason: (e && e.message) || 'error' }));

  let rate = FALLBACK_RATE;
  try { const r = await getUsdToKrwRaw(); if (Number.isFinite(r) && r > 0) rate = r; } catch { /* fallback */ }

  const msg = buildMessage(agg, rate, marketing, failed);
  const result = await notifyOperatorLong('todo', msg, { skipPrefix: true });
  if (!result.ok) {
    console.error('[morning-briefing] 텔레그램 발송 실패:', result.error);
    return { statusCode: 500, body: `send-fail:${result.error || 'unknown'}` };
  }
  return { statusCode: 200, body: `sent (매출 ${agg.revenue.count} · 오류 ${agg.errors.total} · 문의 ${agg.customer.newTickets})` };
}

export default async function vercelHandler(req, res) {
  if (req && req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await morningBriefingTask();
    return res.status(r.statusCode || 200).json({ ok: (r.statusCode || 200) < 400, body: r.body });
  } catch (e) {
    console.error('[morning-briefing] 실패:', e && e.message);
    return res.status(500).json({ error: e && e.message });
  }
}
