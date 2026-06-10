/**
 * 모닝 브리핑 cron — 매일 아침 운영자 텔레그램으로 "어제 회사 한 장".
 *
 * 2026-06-10: 자가운영 에이전시 P1 "비서". AI 0% = 순수 코드 집계(비용 $0, 벤더 독립).
 * 집계 로직은 morningBriefingAggregate.js(순수 함수, 단위 테스트 100%)에 분리 — 여기는 fetch+발송만.
 * 기존 daily-report(Sheets 기반)는 별개 유지. 본 cron 은 Firestore 실데이터(bookings/plans/users).
 *
 * cron-runner.js dispatcher 가 인증(verifyCronRequest) 후 (req,res) 전달. 등록: cron-runner JOBS + vercel.json.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { notifyOperatorLong } from '../_shared/operator-alerts.js';
import { getUsdToKrwRaw } from '../_exchange-rate.js';
import { aggregateMorningBriefing, kstYesterdayWindow } from '../_shared/morningBriefingAggregate.js';

const FALLBACK_RATE = 1450;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtUsd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtKrw = (usd, rate) => `₩${Math.round((Number(usd) || 0) * rate).toLocaleString()}`;

/** 실 epoch → KST 날짜 라벨 "2026-06-09 (월)". */
function ymdKST(ms) {
  const d = new Date(ms + 9 * 3600 * 1000); // KST 벽시계 (UTC fields)
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd} (${wd})`;
}

function buildMessage(agg, rate, failedSections) {
  const { revenue, byProduct, aiPlanner, newUsers, meta, window } = agg;
  const lines = [
    '☀️ <b>코코트립 모닝 브리핑</b>',
    `📅 ${ymdKST(window.yStartMs)} · 어제 실적 (KST 00:00~24:00)`,
    '',
    '━━━ 📋 예약 매출(실) ━━━',
    `건수 <b>${revenue.count}건</b> · 매출 <b>${fmtUsd(revenue.usd)}</b> (${fmtKrw(revenue.usd, rate)})`,
  ];
  const productLines = Object.entries(byProduct).filter(([, v]) => v.count > 0)
    .map(([k, v]) => `  · ${esc(k)} ${v.count}건 ${fmtUsd(v.usd)}`);
  if (productLines.length) lines.push(...productLines);

  lines.push('', '━━━ 🤖 AI 플래너 ━━━',
    `유료 완성 <b>${aiPlanner.paidCount}건</b> · 수수료 <b>${fmtUsd(aiPlanner.feeUsd)}</b> (${fmtKrw(aiPlanner.feeUsd, rate)})`);
  lines.push('', '━━━ 👤 신규 가입 ━━━', `어제 신규 회원 <b>${newUsers}명</b>`);

  const footer = [`환율 ₩${rate.toLocaleString()}/$`, `제외 ${meta.excludedBypass + meta.excludedCanceled}건(테스트·취소)`];
  if (failedSections.length) footer.push(`⚠️ 조회실패: ${failedSections.join(',')}`);
  lines.push('', `<i>${footer.join(' · ')}</i>`, '🌐 cocotripkr.com/admin');
  return lines.join('\n');
}

async function morningBriefingTask() {
  const db = initAdminDb();
  if (!db) {
    await notifyOperatorLong('todo', '⚠️ <b>모닝 브리핑</b>\nFirestore 연결 안 됨 (env 확인 필요).', { skipPrefix: true }).catch(() => {});
    return { statusCode: 200, body: 'no-db' };
  }

  const now = new Date();
  const { yStartMs, todayStartMs } = kstYesterdayWindow(now);
  const since = Timestamp.fromMillis(yStartMs);
  const until = Timestamp.fromMillis(todayStartMs);

  // 3 쿼리 병렬 — 한 컬렉션 실패해도 나머지 섹션 발송 (graceful).
  const [bk, pl, us] = await Promise.allSettled([
    db.collection('bookings').where('createdAt', '>=', since).where('createdAt', '<', until).get(),
    db.collection('plans').where('createdAtMs', '>=', yStartMs).where('createdAtMs', '<', todayStartMs).get(),
    db.collection('users').where('createdAt', '>=', since).where('createdAt', '<', until).get(),
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
  }, { now });

  let rate = FALLBACK_RATE;
  try { const r = await getUsdToKrwRaw(); if (Number.isFinite(r) && r > 0) rate = r; } catch { /* fallback */ }

  const msg = buildMessage(agg, rate, failed);
  const result = await notifyOperatorLong('todo', msg, { skipPrefix: true });
  if (!result.ok) {
    console.error('[morning-briefing] 텔레그램 발송 실패:', result.error);
    return { statusCode: 500, body: `send-fail:${result.error || 'unknown'}` };
  }
  return { statusCode: 200, body: `sent (rev ${agg.revenue.count}건, ai ${agg.aiPlanner.paidCount}건, 가입 ${agg.newUsers}명)` };
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
