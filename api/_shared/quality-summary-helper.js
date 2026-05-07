/**
 * api/_shared/quality-summary-helper.js — Quality 리포트 공통 helper
 *
 * PR-D (2026-05-07): admin-quality-summary.js + _crons/weekly-quality-report.js 가
 * 동일한 Firestore 컬렉션 카운트 + 집계 로직을 재사용하기 위해 추출.
 *
 * 노출 함수:
 *   - collectQualityCounts(db, sinceMs)  → { complaints, tickets, errors, plans, _collectionMissing[] }
 *   - aggregateSummary({...})            → 주간/Admin 동일 spec 의 요약 객체
 *   - hasSufficientDataForLLM(summary)   → LLM 호출 조건 (plans>=5 && (tickets+errors+complaints)>=3)
 *
 * silent fail 금지 — 컬렉션 미존재(혹은 인덱스 누락)는 _collectionMissing 배열에 명시적으로 노출.
 * 운영자가 admin 대시보드 + 주간 리포트에서 데이터 수집 경로 미작동을 즉시 인지할 수 있도록.
 *
 * 컬렉션 존재 확인 패턴:
 *   - .where('createdAt', '>=', sinceDate) 쿼리 시도
 *   - 빈 컬렉션 + 미존재 컬렉션 모두 size 0 으로 반환되므로 limit(1) 추가 fallback 으로
 *     "정말 미존재" 인지 판별 (에러 발생 = 미존재 가능성, size 0 빈 결과 = 비어 있음)
 *   - 한 번 더 catch 후 미존재로 분기.
 */

// ── 컬렉션 이름 (운영 코드와 일치) ──────────────────────────────────────
// ⚠️ 변경 시 firestore.rules + 문서(docs/quality-metrics.md) 동시 업데이트 필요.
export const QUALITY_COLLECTIONS = Object.freeze({
  complaints: 'plan_complaints',  // 사용자 plan 신고 (= "user_reports" 역할)
  tickets:    'cs_tickets',       // CS 티켓
  errors:     'error_log',        // 에러 로그 (= "error_logs" 역할, Tier 2-E)
});

// ── 9-metric 키 (qualityScore.metrics) ───────────────────────────────────
export const METRIC_KEYS = Object.freeze([
  'dietary_violation',
  'unverified_restaurant',
  'field_completeness',
  'route_failure',
  'bad_address_prefix',
  'language_mismatch',
  'duplicate_stops',
  'tight_schedule',
  'loose_schedule',
]);

// ── metric → 측정 단위 (대시보드 라벨용) ────────────────────────────────
export const METRIC_UNITS = Object.freeze({
  dietary_violation:     'per stop',
  unverified_restaurant: 'per stop',
  field_completeness:    'per stop',
  route_failure:         'per stop',
  bad_address_prefix:    'per stop',
  language_mismatch:     'per stop',
  duplicate_stops:       'per duplicate',
  tight_schedule:        'per segment',
  loose_schedule:        'per segment',
});

export const METRIC_LABELS_KO = Object.freeze({
  dietary_violation:     '식이제한 위반',
  unverified_restaurant: '미검증 식당',
  field_completeness:    '필드 누락',
  route_failure:         '경로 실패',
  bad_address_prefix:    '주소 prefix 오류',
  language_mismatch:     '언어 불일치',
  duplicate_stops:       '중복 stop',
  tight_schedule:        '빡빡한 일정',
  loose_schedule:        '느슨한 일정',
});

const REASON_LABELS_KO = Object.freeze({
  wrong_address:     '주소 오류',
  closed_restaurant: '폐업·운영 종료',
  inefficient_route: '동선 비효율',
  wrong_timing:      '시간 부정확',
  other:             '기타',
});

// ── LLM 임계값 (PR-D 가드) ──────────────────────────────────────────────
// plans >= 5 AND (csTickets+errorLogs+userReports) >= 3 일 때만 LLM 호출.
// 미달 시 정적 fallback (비용 + 신뢰도 — 데이터 부족 시 hallucination 방지).
export const LLM_MIN_PLANS = 5;
export const LLM_MIN_SIGNALS = 3;

// ── createdAt → ms (Timestamp / number / string 모두 대응) ──────────────
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

function planArea(p) {
  return (p.input?.area || p.area || 'unknown').toString().toLowerCase().trim() || 'unknown';
}

// ── 컬렉션 fetch + 존재 여부 검증 ───────────────────────────────────────
// 반환: { docs: [...], missing: bool, error?: string }
async function fetchCollectionWithExistenceProbe(db, name, sinceDate) {
  try {
    const snap = await db.collection(name)
      .where('createdAt', '>=', sinceDate)
      .get();
    return { docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), missing: false };
  } catch (e) {
    // 인덱스 미빌드 또는 컬렉션 미존재 — limit(1) 으로 정확히 분기.
    try {
      const probe = await db.collection(name).limit(1).get();
      // 빈 컬렉션 (size 0) 이지만 쿼리 자체는 성공 → 컬렉션 존재 + 인덱스 문제로 추정.
      // 인덱스 문제는 createdAt 단일 인덱스가 자동 생성되므로 사실상 미존재로 봄.
      if (probe.empty) {
        // 빈 컬렉션은 missing 으로 처리 (운영자 명시적 인지 목적).
        return { docs: [], missing: true, error: `empty collection: ${e.message}` };
      }
      return { docs: [], missing: false, error: e.message };
    } catch (probeErr) {
      return { docs: [], missing: true, error: probeErr.message };
    }
  }
}

/**
 * Firestore 4-collection 데이터 수집 + 미존재 컬렉션 명시.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {number} sinceMs
 * @returns {Promise<{
 *   complaints: any[],
 *   tickets: any[],
 *   errors: any[],
 *   plans: any[],
 *   _collectionMissing: string[],
 *   _collectionErrors: Record<string, string>
 * }>}
 */
export async function collectQualityCounts(db, sinceMs) {
  const sinceDate = new Date(sinceMs);
  const _collectionMissing = [];
  const _collectionErrors = {};

  // ── 3 카운트 컬렉션 (plan_complaints / cs_tickets / error_log) ──
  const [complaintsR, ticketsR, errorsR] = await Promise.all([
    fetchCollectionWithExistenceProbe(db, QUALITY_COLLECTIONS.complaints, sinceDate),
    fetchCollectionWithExistenceProbe(db, QUALITY_COLLECTIONS.tickets,    sinceDate),
    fetchCollectionWithExistenceProbe(db, QUALITY_COLLECTIONS.errors,     sinceDate),
  ]);

  if (complaintsR.missing) _collectionMissing.push(QUALITY_COLLECTIONS.complaints);
  if (ticketsR.missing)    _collectionMissing.push(QUALITY_COLLECTIONS.tickets);
  if (errorsR.missing)     _collectionMissing.push(QUALITY_COLLECTIONS.errors);

  if (complaintsR.error) _collectionErrors[QUALITY_COLLECTIONS.complaints] = complaintsR.error;
  if (ticketsR.error)    _collectionErrors[QUALITY_COLLECTIONS.tickets]    = ticketsR.error;
  if (errorsR.error)     _collectionErrors[QUALITY_COLLECTIONS.errors]     = errorsR.error;

  // ── plans (createdAtMs 인덱스 + fallback) ─────────────────────────────
  let plansAll = [];
  try {
    const snap = await db.collection('plans')
      .where('createdAtMs', '>=', sinceMs)
      .orderBy('createdAtMs', 'desc')
      .limit(500)
      .get();
    plansAll = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap = await db.collection('plans')
        .orderBy('createdAtMs', 'desc')
        .limit(500)
        .get();
      plansAll = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => {
          const ms = toMs(p.createdAtMs ?? p.createdAt);
          return ms != null && ms >= sinceMs;
        });
    } catch (e2) {
      _collectionMissing.push('plans');
      _collectionErrors.plans = e2.message;
    }
  }

  // qualityScore 보유 plan 만 집계
  const plans = plansAll.filter(
    (p) => p.qualityScore && p.qualityScore.metrics && typeof p.qualityScore.score === 'number',
  );

  return {
    complaints: complaintsR.docs,
    tickets:    ticketsR.docs,
    errors:     errorsR.docs,
    plans,
    _collectionMissing,
    _collectionErrors,
  };
}

// ── 집계 helpers ─────────────────────────────────────────────────────────
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
    .map(([metric, count]) => ({
      metric,
      label: METRIC_LABELS_KO[metric] || metric,
      unit: METRIC_UNITS[metric] || 'per stop',
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function computeWorstAreas(plans) {
  const agg = new Map();
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
  return out
    .filter((a) => a.count >= 1)
    .sort((a, b) => a.avgScore - b.avgScore || b.worstMetricCount - a.worstMetricCount)
    .slice(0, 3);
}

/**
 * 주간/Admin 공통 요약 객체 빌더.
 * @param {{ complaints:any[], tickets:any[], errors:any[], plans:any[] }} input
 */
export function aggregateSummary({ complaints, tickets, errors, plans }) {
  const avgQualityScore = plans.length > 0
    ? Math.round(plans.reduce((s, p) => s + (p.qualityScore?.score || 0), 0) / plans.length * 10) / 10
    : 0;

  return {
    totalComplaints: complaints.length,
    totalTickets:    tickets.length,
    totalErrors:     errors.length,
    plansGenerated:  plans.length,
    avgQualityScore,
    topComplaintReasons: computeTopReasons(complaints),
    topErrorKeys:        computeTopErrors(errors),
    topMetrics:          computeTopMetrics(plans),
    worstAreas:          computeWorstAreas(plans),
  };
}

/**
 * LLM 호출 임계값 가드 (PR-D).
 *  - plans >= 5 AND (csTickets+errorLogs+userReports) >= 3 일 때만 LLM 호출.
 *  - 미달 시 호출 측이 정적 fallback 텍스트 사용.
 */
export function hasSufficientDataForLLM(summary) {
  const signals = (summary.totalTickets || 0)
    + (summary.totalErrors || 0)
    + (summary.totalComplaints || 0);
  return (summary.plansGenerated || 0) >= LLM_MIN_PLANS && signals >= LLM_MIN_SIGNALS;
}

/**
 * 정적 fallback 텍스트 (한국어 / 영어) — LLM 호출 미달 시 안내.
 */
export function llmFallbackText(summary, lang = 'ko') {
  const n = summary.plansGenerated || 0;
  if (lang === 'en') {
    return `Insufficient data for trend analysis this week (plans: ${n}). Recommend reviewing data collection paths.`;
  }
  return `이번 주 데이터가 부족해 트렌드 분석이 어렵습니다 (plans: ${n}건). 데이터 수집 경로 점검을 권장합니다.`;
}
