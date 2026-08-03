/**
 * Vercel API Route: Admin Quality Summary (Tier 2-D follow-up)
 * GET /api/admin-quality-summary?days=30&limit=100
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * PR #261 (ff0bf14) 가 plan 마다 9-metric qualityScore 를 측정해
 * `plans/{id}.qualityScore = { metrics, score, computedAt }` 로 저장한다.
 * 본 endpoint 는 최근 N 일 / N 건의 plan 을 집계해 area / zone 별 약점,
 * DB 보강 우선순위, worst-plan top 10 을 admin 대시보드용으로 노출한다.
 *
 * PR-D (2026-05-07): plans 외 3개 카운트 컬렉션 추가 — `plan_complaints`,
 * `cs_tickets`, `error_log`. 컬렉션 미존재 시 `_collectionMissing` 배열에
 * 명시적 노출 (silent fail 금지 — 운영자가 수집 미작동 즉시 인지).
 *
 * 응답 스키마 (admin-only):
 *   {
 *     window: { days, limit, sinceISO, scannedTotal, scoredCount },
 *     overall: { avgScore, minScore, maxScore },
 *     metricFrequency: {
 *       <metric_key>: { stops: <total>, violations: <count>, avgRate: <0..1> },
 *       ...
 *     },
 *     byArea: {
 *       <area>: {
 *         count, avgScore,
 *         worstMetric: <metric_key>|null,
 *         worstMetricCount: <int>,
 *       }, ...
 *     },
 *     worstPlans: [
 *       {
 *         id, score, area, createdAt,
 *         topMetrics: [{ metric, count, total }, ...] // 상위 3
 *       }, ...
 *     ],
 *     // PR-D 신규
 *     csTicketCount,
 *     errorLogCount,
 *     userReportCount,        // = plan_complaints 컬렉션 카운트
 *     _collectionMissing: ['error_log', ...],
 *     _collectionErrors: { error_log: '...', ... },
 *     generatedAt,
 *   }
 *
 * 호환성:
 *   - qualityScore 가 없는 기존 plan 은 자동 제외 (`if (p.qualityScore?.metrics)`).
 *   - admin 인증: 기존 verifyAdminToken 패턴 재사용 (admin-sales.js 와 동일).
 *   - Sentry: 핸들러 throw 시 wrapHandler 가 captureError + 500 응답.
 *
 * 사용자 미노출 — 한국어 admin 정책 준수, i18n 키 없음.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { wrapHandler, captureError } from './_shared/sentry.js';
import { collectQualityCounts, keepCustomerPlans } from './_shared/quality-summary-helper.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
// 치명 오류 판정 SSOT — 점수 가중치와 같은 파일에서 온다(따로 정의하면 갈라진다).
import { hasCriticalIssue, CRITICAL_METRICS } from './_ai_core/qualityMetrics.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, OPTIONS';

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

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

function planCreatedMs(p) {
  if (typeof p.createdAtMs === 'number') return p.createdAtMs;
  if (p.createdAt && typeof p.createdAt.toDate === 'function') return p.createdAt.toDate().getTime();
  if (typeof p.createdAt === 'string') {
    const t = Date.parse(p.createdAt);
    return Number.isFinite(t) ? t : null;
  }
  if (p.createdAt?._seconds) return p.createdAt._seconds * 1000;
  return null;
}

function planArea(p) {
  return (p.input?.area || p.area || 'unknown').toString().toLowerCase().trim() || 'unknown';
}

function topMetrics(metrics, n = 3) {
  const list = [];
  for (const key of METRIC_KEYS) {
    const m = metrics?.[key];
    if (!m) continue;
    if ((m.count || 0) > 0) {
      list.push({ metric: key, count: m.count, total: m.total || 0 });
    }
  }
  list.sort((a, b) => b.count - a.count);
  return list.slice(0, n);
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') {
    return json(req, res, 405, { error: 'Method Not Allowed' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });
  }

  const days  = Math.min(Math.max(parseInt(req.query?.days  || '30',  10), 1), 365);
  const limit = Math.min(Math.max(parseInt(req.query?.limit || '100', 10), 1), 500);

  const db = initAdminDb('admin-quality-summary');
  if (!db) {
    return json(req, res, 500, { error: 'Firestore unavailable — check FIREBASE_* env vars' });
  }

  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const sinceISO = new Date(sinceMs).toISOString();

  try {
    // createdAtMs (number) 가 모든 plan 에 있으므로 단순 where + orderBy.
    // 인덱스 누락 시 catch 에서 fallback (sub-set fetch + 클라이언트 정렬).
    let snap;
    try {
      snap = await db.collection('plans')
        .where('createdAtMs', '>=', sinceMs)
        .orderBy('createdAtMs', 'desc')
        .limit(limit)
        .get();
    } catch (idxErr) {
      // 인덱스가 아직 빌드 안 됐을 때 fallback — 최근 limit*3 만 fetch 후 필터.
      console.warn('[admin-quality-summary] indexed query failed, using fallback:', idxErr.message);
      const fallback = await db.collection('plans')
        .orderBy('createdAtMs', 'desc')
        .limit(Math.min(limit * 3, 1000))
        .get();
      snap = fallback;
    }

    const all = [];
    snap.forEach((doc) => {
      const p = doc.data();
      all.push({ id: doc.id, ...p });
    });

    // qualityScore 보유 + window 안의 plan 만 집계.
    const scoredAll = all.filter((p) => {
      const ms = planCreatedMs(p);
      if (ms == null || ms < sinceMs) return false;
      return p.qualityScore && p.qualityScore.metrics && typeof p.qualityScore.score === 'number';
    });
    // 🔴 2026-08-03: 운영자·CI 테스트 플랜을 빼야 "손님 품질" 이 된다.
    //   실측(24h 25건 · 7일 43건)이 **전부** admin-bypass 였다 — L3 모니터가 손님
    //   품질이라며 자기 스모크 테스트를 재고 있었다. 제외 건수는 응답에 그대로
    //   노출한다(조용히 0건이 되면 원인을 알 수 없다).
    const { customer: scored, excludedTestPlans } = keepCustomerPlans(scoredAll);

    // ── overall ─────────────────────────────────────────────────────────
    let sum = 0, min = Infinity, max = -Infinity;
    for (const p of scored) {
      const s = p.qualityScore.score;
      sum += s;
      if (s < min) min = s;
      if (s > max) max = s;
    }
    // 🔴 2026-07-28: 평균 점수만 보면 오류율이 묻힌다. 실측에서 평균 88.7 인데
    //   촉박한 일정이 73.5%, 중복 장소가 25.4% 였다. 그래서 "치명 오류가 하나도 없는
    //   플랜의 비율"을 핵심 지표로 함께 낸다 — 이 값은 평균처럼 가려지지 않는다.
    const cleanCount = scored.filter((p) => !hasCriticalIssue(p.qualityScore.metrics)).length;
    const overall = scored.length
      ? {
        avgScore: Math.round((sum / scored.length) * 10) / 10,
        minScore: min,
        maxScore: max,
        // 치명 오류(식이제한·촉박한 일정·경로 실패·중복 장소) 0 인 플랜 비율.
        cleanPlanCount: cleanCount,
        cleanPlanRate: Math.round((cleanCount / scored.length) * 1000) / 10,
        criticalMetrics: CRITICAL_METRICS,
      }
      : {
        avgScore: null, minScore: null, maxScore: null,
        cleanPlanCount: 0, cleanPlanRate: null, criticalMetrics: CRITICAL_METRICS,
      };

    // ── metricFrequency ─────────────────────────────────────────────────
    const metricFrequency = {};
    for (const key of METRIC_KEYS) {
      metricFrequency[key] = { stops: 0, violations: 0, avgRate: 0 };
    }
    for (const p of scored) {
      const m = p.qualityScore.metrics;
      for (const key of METRIC_KEYS) {
        const cell = m[key];
        if (!cell) continue;
        metricFrequency[key].stops      += cell.total || 0;
        metricFrequency[key].violations += cell.count || 0;
      }
    }
    for (const key of METRIC_KEYS) {
      const f = metricFrequency[key];
      f.avgRate = f.stops > 0 ? Math.round((f.violations / f.stops) * 1000) / 1000 : 0;
    }

    // ── byArea ──────────────────────────────────────────────────────────
    const areaAgg = new Map(); // area → { count, sumScore, perMetricViolations: {} }
    for (const p of scored) {
      const area = planArea(p);
      let agg = areaAgg.get(area);
      if (!agg) {
        agg = { count: 0, sumScore: 0, perMetric: {} };
        for (const key of METRIC_KEYS) agg.perMetric[key] = 0;
        areaAgg.set(area, agg);
      }
      agg.count += 1;
      agg.sumScore += p.qualityScore.score;
      for (const key of METRIC_KEYS) {
        agg.perMetric[key] += p.qualityScore.metrics[key]?.count || 0;
      }
    }
    const byArea = {};
    for (const [area, agg] of areaAgg.entries()) {
      let worstMetric = null;
      let worstMetricCount = 0;
      for (const key of METRIC_KEYS) {
        const c = agg.perMetric[key];
        if (c > worstMetricCount) {
          worstMetric = key;
          worstMetricCount = c;
        }
      }
      byArea[area] = {
        count: agg.count,
        avgScore: Math.round((agg.sumScore / agg.count) * 10) / 10,
        worstMetric,
        worstMetricCount,
      };
    }

    // ── worstPlans (top 10, 점수 낮은 순) ────────────────────────────────
    const worstPlans = scored
      .slice()
      .sort((a, b) => a.qualityScore.score - b.qualityScore.score)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        score: p.qualityScore.score,
        area: planArea(p),
        createdAt: p.createdAt || (planCreatedMs(p) ? new Date(planCreatedMs(p)).toISOString() : null),
        topMetrics: topMetrics(p.qualityScore.metrics, 3),
      }));

    // ── PR-D: 추가 컬렉션 카운트 (plan_complaints / cs_tickets / error_log) ──
    // helper 에서 plans 도 같이 fetch 하지만 우리는 위에서 days/limit 커스텀으로
    // 이미 처리했으니 counts 만 사용. _collectionMissing 도 plan 미포함 (이미 fetch 성공).
    const counts = await collectQualityCounts(db, sinceMs);
    const csTicketCount   = counts.tickets.length;
    const errorLogCount   = counts.errors.length;
    const userReportCount = counts.complaints.length;
    // plans 는 이미 위에서 처리했으므로 helper 의 plans 미존재 표기는 제외
    const _collectionMissing = (counts._collectionMissing || []).filter((c) => c !== 'plans');
    const _collectionErrors  = { ...(counts._collectionErrors || {}) };
    delete _collectionErrors.plans;

    return json(req, res, 200, {
      window: {
        days,
        limit,
        sinceISO,
        scannedTotal: all.length,
        scoredCount: scored.length,
        // 운영자·CI 테스트 플랜 제외 건수. scoredCount 가 0 인데 이 값이 크면
        // "품질 회귀" 가 아니라 "손님 트래픽 0" 이다.
        excludedTestPlans,
      },
      overall,
      metricFrequency,
      byArea,
      worstPlans,
      // PR-D 신규
      csTicketCount,
      errorLogCount,
      userReportCount,
      _collectionMissing,
      _collectionErrors,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    await captureError(err, { route: '/api/admin-quality-summary', method: 'GET' });
    console.error('[admin-quality-summary] error:', err);
    return json(req, res, 500, { error: err.message, code: 'QUALITY_SUMMARY_FAILED' });
  }
}

export default wrapHandler(handler);
