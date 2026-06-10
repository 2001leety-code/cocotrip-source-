/**
 * 수정팀(운영 감시원) cron — 매일 KST 08:45, 어제 데이터를 재검산해 이상을 의사결정 큐로.
 * 자가운영 에이전시 P2 심화. 모닝브리핑 동형(순수체크 분리 + cron 은 fetch+라우팅만). AI 0=$0.
 *
 * 🔒 안전: OPS_WATCHDOG_ENABLED='true' 일 때만. 🔴 **발견·분류만 자동, 수정/환불/배포 절대 자동 X**
 *   (코드에 update/refund/git/deploy 호출 0 — 유일한 prod 쓰기 = enqueueDecision 카드). 읽기전용 감사.
 *   critical = 즉시 텔레그램 / warning = 결정큐(+다음 아침 브리핑 📥) / blindspot = 카운트만.
 *
 * cron-runner JOBS + vercel.json("45 23 * * *" = KST 08:45, 모닝브리핑 직후).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Timestamp } from 'firebase-admin/firestore';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { notifyOperatorLong } from '../_shared/operator-alerts.js';
import { enqueueDecision } from '../_shared/decisionQueue.js';
import { kstYesterdayWindow } from '../_shared/morningBriefingAggregate.js';
import { checkPaymentInvariants, checkStuckStreamingPlans, checkErrorSurge, checkTransitService } from '../_shared/opsWatchdogChecks.js';
import { TRANSIT_SERVICES, CALLS_PER_PLAN, activeServiceKey } from '../_shared/transitServiceConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 어제 KST 날짜 라벨 (dedupeKey 용). */
function ymd(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** finding → 의사결정 큐 카드 (멱등 dedupeKey). */
function cardFor(f, dateLabel) {
  if (f.kind === 'plan-stuck') return { type: 'plan-stuck', title: `🚨 결제 후 plan 미생성 — ${f.ageMin}분+`, summary: esc(f.msg), dedupeKey: `plan-stuck-${f.planId}` };
  if (f.kind === 'overcharge') return { type: 'payment-audit', title: `결제 금액 초과 — ${esc(f.productType)}`, summary: esc(f.msg), dedupeKey: `overcharge-${f.orderID}` };
  if (f.kind === 'integrity') return { type: 'payment-audit', title: `결제액 이상 — ${esc(f.productType)}`, summary: esc(f.msg), dedupeKey: `integrity-${f.orderID}` };
  if (f.kind === 'error-surge') return { type: 'error-surge', title: `에러 폭증 — ${esc(f.key)}`, summary: esc(f.msg), dedupeKey: `error-surge-${f.key}-${dateLabel}` };
  if (f.kind === 'transit-expiry') return { type: 'transit', title: '🚦 교통 서비스 만료 임박', summary: esc(f.msg), dedupeKey: `transit-expiry-${f.severity}` };       // severity별 1회(만료까지 지속)
  if (f.kind === 'transit-quota') return { type: 'transit', title: '🚦 교통 API 한도 임박', summary: esc(f.msg), dedupeKey: `transit-quota-${dateLabel}` };               // 일별
  return { type: 'ops', title: esc(f.msg || '점검 필요'), summary: esc(f.msg || ''), dedupeKey: `ops-${f.kind}-${dateLabel}` };
}

async function opsWatchdogTask() {
  if (process.env.OPS_WATCHDOG_ENABLED !== 'true') {
    return { statusCode: 200, body: 'disabled (OPS_WATCHDOG_ENABLED 미설정)' };
  }
  const db = initAdminDb('cron/ops-watchdog');
  if (!db) return { statusCode: 200, body: 'no-db' };

  let SPEC = null;
  try { SPEC = JSON.parse(readFileSync(join(__dirname, '../_pricing_spec.json'), 'utf-8')); } catch (e) { console.error('[ops-watchdog] SPEC 로드 실패:', e && e.message); }

  const now = new Date();
  const { yStartMs, todayStartMs } = kstYesterdayWindow(now);
  const dateLabel = ymd(yStartMs);
  const sinceY = Timestamp.fromMillis(yStartMs);
  const untilY = Timestamp.fromMillis(todayStartMs);

  const [bk, pl, er, pc] = await Promise.allSettled([
    db.collection('bookings').where('createdAt', '>=', sinceY).where('createdAt', '<', untilY).get(),  // 어제 결제(상태는 체크가 필터)
    db.collection('plans').where('status', '==', 'streaming').limit(100).get(),                         // stuck(시점 무관)
    db.collection('error_log').where('createdAt', '>=', yStartMs).where('createdAt', '<', todayStartMs).get(), // number
    db.collection('plans').where('createdAtMs', '>=', yStartMs).where('createdAtMs', '<', todayStartMs).get(), // 어제 플랜수(교통 한도 추정)
  ]);

  const failed = [];
  const docs = (r, label) => {
    if (r.status === 'fulfilled') return r.value.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.error(`[ops-watchdog] ${label} 조회 실패:`, r.reason && r.reason.message);
    failed.push(label);
    return [];
  };

  const pay = SPEC ? checkPaymentInvariants(docs(bk, '결제'), SPEC, {}) : { findings: [], blindspot: 0, audited: 0 };
  const stuck = checkStuckStreamingPlans(docs(pl, 'plan'), { nowMs: now.getTime() });
  const errs = checkErrorSurge(docs(er, '오류'), {});
  const plansYesterday = pc.status === 'fulfilled' ? pc.value.size : 0;
  const transit = checkTransitService(TRANSIT_SERVICES, { nowMs: now.getTime(), activeKey: activeServiceKey(), plansYesterday, callsPerPlan: CALLS_PER_PLAN });

  const findings = [...pay.findings, ...stuck.findings, ...errs.findings, ...transit.findings];

  // 결정큐 카드 (멱등). 발견만 — 수정/환불 자동 X.
  let enq = 0;
  for (const f of findings) {
    const r = await enqueueDecision(db, { ...cardFor(f, dateLabel), link: '/admin/decisions' }).catch(() => ({ ok: false }));
    if (r && r.added) enq++;
  }

  // critical 즉시 텔레그램 (operator-alerts VALID_CATEGORIES='todo').
  const crit = findings.filter((f) => f.severity === 'critical');
  if (crit.length > 0) {
    const lines = ['🛠️ <b>수정팀 — 즉시 확인 필요</b>', `📅 ${dateLabel} 감사`, ''];
    for (const f of crit.slice(0, 8)) lines.push(`🔴 ${esc(f.msg)}`);
    lines.push('', `<i>총 ${crit.length}건 critical · 감사 ${pay.audited}건 · 사각지대 ${pay.blindspot}건</i>`, '🌐 cocotripkr.com/admin/decisions');
    await notifyOperatorLong('todo', lines.join('\n'), { skipPrefix: true }).catch((e) => console.error('[ops-watchdog] 텔레그램:', e && e.message));
  }

  return { statusCode: 200, body: `findings ${findings.length}(crit ${crit.length}) enq ${enq} · 감사 ${pay.audited} 사각 ${pay.blindspot}${failed.length ? ' · 실패 ' + failed.join(',') : ''}` };
}

export default async function vercelHandler(req, res) {
  if (req && req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await opsWatchdogTask();
    return res.status(r.statusCode || 200).json({ ok: (r.statusCode || 200) < 400, body: r.body });
  } catch (e) {
    console.error('[ops-watchdog] 실패:', e && e.message);
    return res.status(500).json({ error: e && e.message });
  }
}
