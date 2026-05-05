/**
 * CocoTripKR — 주간 Quality 리포트 (L Tier 3-F)
 *
 * 매주 월요일 새벽 KST 9 AM (= UTC 0 AM 월요일) 실행.
 * vercel.json crons 항목에서 cron-runner.js 가 dispatch.
 *
 * 데이터 소스 (지난 7일):
 *   1. plan_complaints — 사용자 plan 신고 (5개 reason enum)
 *   2. cs_tickets      — CS 티켓 (status / priority)
 *   3. error_log       — 에러 로그 (Tier 2-E 머지 후 활성, 없으면 graceful skip)
 *   4. plans           — qualityScore 보유 plan 의 metric 집계
 *
 * 처리 단계:
 *   1. Firestore 4-query (Promise.allSettled — 일부 실패해도 진행)
 *   2. aggregateSummary() — count + 평균 score + 최악 area + top metric
 *   3. Gemini 2.5 Flash 호출 → "가장 시급한 3가지 문제 + 권장 조치"
 *   4. Telegram 발송 (sendLongMessage, HTML)
 *   5. weekly_quality_reports 컬렉션에 보관
 *
 * 인증:
 *   - Vercel cron 자동 호출 시 x-vercel-cron 헤더 또는 query?token=$CRON_SECRET
 *   - cron-runner.js 가 호출되므로 별도 인증은 dispatcher 단에서 처리. 여기서는
 *     ENV 가 없는 로컬 호출도 허용 (CRON_SECRET 미설정 시 통과).
 *
 * 운영자 manual trigger:
 *   curl "https://cocotripkr.com/api/cron-runner?job=weekly-quality-report&token=$CRON_SECRET"
 *
 * 참고:
 *   - 한국어 admin only — i18n 키 추가 X
 *   - 실패 시 sendErrorAlert + Sentry captureError, 응답은 항상 JSON
 *   - Gemini / Firestore / Telegram 모두 graceful failsafe
 */

import { initAdminDb } from '../_shared/firebase-admin.js';
import { sendLongMessage, sendErrorAlert } from '../_telegram.js';
import { captureError } from '../_shared/sentry.js';

// ── 상수 ──────────────────────────────────────────────────────────────
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const REASON_LABELS_KO = {
  wrong_address:     '주소 오류',
  closed_restaurant: '폐업·운영 종료',
  inefficient_route: '동선 비효율',
  wrong_timing:      '시간 부정확',
  other:             '기타',
};

const METRIC_KEYS = [
  'dietary_violation',
  'unverified_restaurant',
  'field_completeness',
  'route_failure',
  'bad_address_prefix',
  'language_mismatch',
  'duplicate_stops',
  'tight_schedule',
  'loose_schedule',
];

const METRIC_LABELS_KO = {
  dietary_violation:     '식이제한 위반',
  unverified_restaurant: '미검증 식당',
  field_completeness:    '필드 누락',
  route_failure:         '경로 실패',
  bad_address_prefix:    '주소 prefix 오류',
  language_mismatch:     '언어 불일치',
  duplicate_stops:       '중복 stop',
  tight_schedule:        '빡빡한 일정',
  loose_schedule:        '느슨한 일정',
};

// ── 유틸: createdAt → ms 변환 (Timestamp / number / string 모두 대응) ──
function toMs(ts) {
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts && typeof ts._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts === 'string') {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// ── 집계 헬퍼 ────────────────────────────────────────────────────────
function computeTopReasons(complaints) {
  const counts = {};
  for (const c of complaints) {
    const key = c.reason || 'other';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([reason, count]) => ({ reason, label: REASON_LABELS_KO[reason] || reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function computeTopErrors(errors) {
  const counts = {};
  for (const e of errors) {
    const key = e.errorKey || e.code || e.route || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function computeTopMetrics(plans) {
  const counts = {};
  for (const key of METRIC_KEYS) counts[key] = 0;
  for (const p of plans) {
    const m = p.qualityScore?.metrics || {};
    for (const key of METRIC_KEYS) {
      counts[key] += (m[key]?.count || 0);
    }
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([metric, count]) => ({ metric, label: METRIC_LABELS_KO[metric] || metric, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function planArea(p) {
  return (p.input?.area || p.area || 'unknown').toString().toLowerCase().trim() || 'unknown';
}

function computeWorstAreas(plans) {
  const agg = new Map(); // area → { count, sumScore, perMetric }
  for (const p of plans) {
    const area = planArea(p);
    let cur = agg.get(area);
    if (!cur) {
      cur = { count: 0, sumScore: 0, perMetric: {} };
      for (const k of METRIC_KEYS) cur.perMetric[k] = 0;
      agg.set(area, cur);
    }
    cur.count += 1;
    cur.sumScore += p.qualityScore?.score || 0;
    const m = p.qualityScore?.metrics || {};
    for (const k of METRIC_KEYS) {
      cur.perMetric[k] += (m[k]?.count || 0);
    }
  }
  const out = [];
  for (const [area, cur] of agg.entries()) {
    let worstMetric = null;
    let worstCount = 0;
    for (const k of METRIC_KEYS) {
      if (cur.perMetric[k] > worstCount) {
        worstCount = cur.perMetric[k];
        worstMetric = k;
      }
    }
    out.push({
      area,
      count: cur.count,
      avgScore: Math.round((cur.sumScore / cur.count) * 10) / 10,
      worstMetric,
      worstMetricLabel: worstMetric ? METRIC_LABELS_KO[worstMetric] : null,
      worstMetricCount: worstCount,
    });
  }
  // 평균 score 낮은 순 (3개 이상인 area 만), 동률은 worstMetricCount 큰 순
  return out
    .filter((a) => a.count >= 1)
    .sort((a, b) => a.avgScore - b.avgScore || b.worstMetricCount - a.worstMetricCount)
    .slice(0, 3);
}

// ── 메인 집계 ───────────────────────────────────────────────────────
export function aggregateSummary({ complaints, tickets, errors, plans }) {
  const avgQualityScore = plans.length > 0
    ? Math.round(plans.reduce((s, p) => s + (p.qualityScore?.score || 0), 0) / plans.length * 10) / 10
    : 0;

  return {
    totalComplaints: complaints.length,
    totalTickets: tickets.length,
    totalErrors: errors.length,
    plansGenerated: plans.length,
    avgQualityScore,
    topComplaintReasons: computeTopReasons(complaints),
    topErrorKeys: computeTopErrors(errors),
    topMetrics: computeTopMetrics(plans),
    worstAreas: computeWorstAreas(plans),
  };
}

// ── Gemini 프롬프트 ──────────────────────────────────────────────────
export function buildGeminiPrompt(summary) {
  const reasons = summary.topComplaintReasons.length > 0
    ? summary.topComplaintReasons.map((r) => `${r.label} ${r.count}건`).join(', ')
    : '없음';
  const errorKeys = summary.topErrorKeys.length > 0
    ? summary.topErrorKeys.map((e) => `${e.key} ${e.count}건`).join(', ')
    : '없음';
  const metrics = summary.topMetrics.length > 0
    ? summary.topMetrics.map((m) => `${m.label} ${m.count}건`).join(', ')
    : '없음';
  const areas = summary.worstAreas.length > 0
    ? summary.worstAreas.map((a) => `${a.area}(score ${a.avgScore}, ${a.worstMetricLabel || '-'} ${a.worstMetricCount}건)`).join(', ')
    : '없음';

  return `너는 CocoTripKR 운영팀 데이터 분석가야. 지난 1주 데이터:

- 사용자 plan 신고: ${summary.totalComplaints}건 (top 3 사유: ${reasons})
- CS 티켓: ${summary.totalTickets}건
- 에러 로그: ${summary.totalErrors}건 (top 3 키: ${errorKeys})
- 생성된 plan: ${summary.plansGenerated}건, 평균 quality score: ${summary.avgQualityScore}/100
- 최악 area: ${areas}
- 가장 빈번한 약점: ${metrics}

다음 형식으로 한국어 답변:

🔴 가장 시급한 문제 3가지:
1. [문제명] — [근거 데이터] — [권장 조치]
2. ...
3. ...

📊 이번 주 핵심 지표: 한 줄 요약

답변은 한국어, 600자 이내, 간결하게.`;
}

// ── Telegram 메시지 조립 ─────────────────────────────────────────────
export function formatTelegramReport({ summary, geminiSummary, sinceMs, untilMs }) {
  const sinceDate = new Date(sinceMs);
  const untilDate = new Date(untilMs);
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

  const reasonLine = summary.topComplaintReasons.length > 0
    ? summary.topComplaintReasons.map((r) => `${r.label} ${r.count}`).join(', ')
    : '없음';
  const metricLine = summary.topMetrics.slice(0, 3).length > 0
    ? summary.topMetrics.slice(0, 3).map((m) => `${m.label} ${m.count}`).join(', ')
    : '없음';
  const areaLine = summary.worstAreas.length > 0
    ? summary.worstAreas.map((a) => `${a.area}(${a.avgScore})`).join(', ')
    : '없음';

  const stats = [
    `📊 <b>주간 Quality 리포트</b> (${fmt(sinceDate)} ~ ${fmt(untilDate)})`,
    ``,
    `생성된 plan: <b>${summary.plansGenerated}건</b>`,
    `평균 quality score: <b>${summary.avgQualityScore}/100</b>`,
    `사용자 신고: <b>${summary.totalComplaints}건</b> (${reasonLine})`,
    `CS 티켓: <b>${summary.totalTickets}건</b>`,
    `에러 로그: <b>${summary.totalErrors}건</b>`,
    ``,
    `📍 빈번한 약점: ${metricLine}`,
    `📍 최악 area: ${areaLine}`,
    ``,
  ].join('\n');

  const ai = geminiSummary && geminiSummary.trim()
    ? geminiSummary.trim()
    : '(Gemini 요약 실패 — Vercel 로그 확인)';

  return `${stats}━━━ 🤖 AI 요약 ━━━\n${ai}\n\n🌐 cocotripkr.com/admin`;
}

// ── Gemini 호출 (lazy import + failsafe) ─────────────────────────────
async function callGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[weekly-quality] GEMINI_API_KEY 미설정 — AI 요약 스킵');
    return '';
  }
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    return (result.response.text() || '').trim();
  } catch (e) {
    console.warn('[weekly-quality] Gemini failed:', e.message);
    await captureError(e, { route: 'cron/weekly-quality-report', step: 'gemini' });
    return '';
  }
}

// ── Firestore 데이터 fetch ───────────────────────────────────────────
async function fetchWeekData(db, sinceMs) {
  const sinceDate = new Date(sinceMs);

  // plan_complaints — createdAt 은 serverTimestamp (Firestore Timestamp)
  const complaintsP = db.collection('plan_complaints')
    .where('createdAt', '>=', sinceDate)
    .get()
    .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
    .catch((e) => { console.warn('[weekly-quality] plan_complaints query failed:', e.message); return []; });

  // cs_tickets — createdAt 은 serverTimestamp
  const ticketsP = db.collection('cs_tickets')
    .where('createdAt', '>=', sinceDate)
    .get()
    .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
    .catch((e) => { console.warn('[weekly-quality] cs_tickets query failed:', e.message); return []; });

  // error_log — Tier 2-E 머지 후 활성. 컬렉션 없거나 인덱스 없으면 빈 배열.
  const errorsP = db.collection('error_log')
    .where('createdAt', '>=', sinceDate)
    .get()
    .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
    .catch((e) => {
      console.warn('[weekly-quality] error_log query failed (Tier 2-E 미머지?):', e.message);
      return [];
    });

  // plans — createdAtMs (number) 인덱스 사용 (admin-quality-summary 와 동일 패턴).
  // 인덱스 누락 시 fallback: 최근 limit fetch 후 클라이언트 필터.
  const plansP = (async () => {
    try {
      const snap = await db.collection('plans')
        .where('createdAtMs', '>=', sinceMs)
        .orderBy('createdAtMs', 'desc')
        .limit(500)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn('[weekly-quality] plans indexed query failed, using fallback:', e.message);
      try {
        const snap = await db.collection('plans')
          .orderBy('createdAtMs', 'desc')
          .limit(500)
          .get();
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => {
            const ms = toMs(p.createdAtMs ?? p.createdAt);
            return ms != null && ms >= sinceMs;
          });
      } catch (e2) {
        console.warn('[weekly-quality] plans fallback also failed:', e2.message);
        return [];
      }
    }
  })();

  const [complaints, tickets, errors, plansAll] = await Promise.all([complaintsP, ticketsP, errorsP, plansP]);

  // qualityScore 보유 plan 만 집계 대상
  const plans = plansAll.filter((p) => p.qualityScore && p.qualityScore.metrics && typeof p.qualityScore.score === 'number');

  return { complaints, tickets, errors, plans };
}

// ── Vercel handler ───────────────────────────────────────────────────
const weeklyQualityReportTask = async () => {
  console.log('[weekly-quality-report] 주간 리포트 시작');
  const now = Date.now();
  const sinceMs = now - WEEK_MS;

  const db = initAdminDb('cron/weekly-quality-report');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[weekly-quality-report]', msg);
    try { await sendErrorAlert('weekly-quality-report', new Error(msg)); } catch {}
    return { statusCode: 503, body: { ok: false, error: msg } };
  }

  try {
    const { complaints, tickets, errors, plans } = await fetchWeekData(db, sinceMs);
    console.log(`[weekly-quality-report] fetched: complaints=${complaints.length} tickets=${tickets.length} errors=${errors.length} plans=${plans.length}`);

    const summary = aggregateSummary({ complaints, tickets, errors, plans });

    // Gemini 요약 (failsafe)
    const prompt = buildGeminiPrompt(summary);
    const geminiSummary = await callGemini(prompt);

    // Telegram 발송
    const telegramMsg = formatTelegramReport({ summary, geminiSummary, sinceMs, untilMs: now });
    try {
      await sendLongMessage(telegramMsg);
    } catch (e) {
      console.warn('[weekly-quality-report] Telegram 발송 실패:', e.message);
      await captureError(e, { route: 'cron/weekly-quality-report', step: 'telegram' });
    }

    // Firestore 보관
    try {
      await db.collection('weekly_quality_reports').add({
        generatedAt: now,
        window: { sinceMs, untilMs: now },
        summary,
        geminiSummary: geminiSummary || null,
      });
    } catch (e) {
      console.warn('[weekly-quality-report] weekly_quality_reports save failed:', e.message);
    }

    console.log('[weekly-quality-report] 완료');
    return {
      statusCode: 200,
      body: {
        ok: true,
        summary,
        geminiSummaryLength: geminiSummary.length,
        window: { sinceMs, untilMs: now },
      },
    };
  } catch (err) {
    console.error('[weekly-quality-report] 오류:', err.message);
    try { await sendErrorAlert('weekly-quality-report', err); } catch {}
    await captureError(err, { route: 'cron/weekly-quality-report' });
    return { statusCode: 500, body: { ok: false, error: err.message } };
  }
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 선택적 인증: CRON_SECRET 설정 시 token 또는 vercel cron 헤더 검증
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const token = req.query?.token || req.headers['x-cron-token'];
    const isVercelCron = !!req.headers['x-vercel-cron'] || !!req.headers['x-vercel-cron-signature'];
    if (!isVercelCron && token !== cronSecret) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized cron' }));
    }
  }

  try {
    const r = await weeklyQualityReportTask();
    res.statusCode = r.statusCode || 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(r.body));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}
