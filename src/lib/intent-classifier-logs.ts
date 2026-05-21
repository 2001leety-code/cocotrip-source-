// ─────────────────────────────────────────────────────────────────────────────
// intent-classifier-logs.ts — admin-side CRUD for `intent_classifier_logs/{logId}`
// (P130, 2026-05-21).
//
// 컬렉션: `intent_classifier_logs/{logId}` — admin only (firestore.rules).
// 작성자: 서버 `api/ai-planner-modify.js` (fire-and-forget add).
// 읽기:   admin dashboard `/admin/intent-classifier` 뷰.
//
// 모든 read 호출은 Firebase ID token 으로 인증되며 firestore.rules 가 admin email
// 만 허용 → public read 차단 (raw_text 등 사용자 입력 + 분류 결과 누설 방지).
//
// fetchRecentLogs(limit)        — ts desc, 최대 200건.
// fetchWeeklyStats()            — 지난 7일 집계 (intent 분포 + 폴백률 + 실패율).
// fetchHighFallbackSamples(n)   — confidence < 0.5 OR used_llm_fallback=true sample.
//
// 추후 시각화 컴포넌트 (`AdminIntentClassifier.tsx`) 는 이 모듈만 의존.
// ─────────────────────────────────────────────────────────────────────────────
import {
  collection,
  query,
  where,
  orderBy,
  limit as fsLimit,
  getDocs,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** 로그 1건 — 서버가 ai-planner-modify.js 에서 fire-and-forget 으로 add. */
export interface IntentClassifierLog {
  _docId: string;
  ts: string;                          // ISO timestamp (created at server)
  uid?: string | null;                 // 사용자 uid (없으면 guest email)
  email?: string | null;
  plan_id?: string | null;
  raw_text: string;
  language?: string | null;            // 'ko' / 'en' / 'ja' / 'zh' / null
  rule_intent: string;
  rule_confidence: number;
  used_llm_fallback: boolean;
  llm_intent?: string | null;
  llm_confidence?: number | null;
  final_intent: string;
  final_confidence?: number | null;
  classifier_source?: 'rule' | 'llm';  // mirror of api response classifierSource
  mutator_success: boolean;
  mutator_error?: string | null;
  mutator_code?: string | null;
  elapsed_ms?: number | null;
}

const COLLECTION = 'intent_classifier_logs';

function normalize(docId: string, data: DocumentData): IntentClassifierLog {
  // ts 는 string ISO 우선 — 서버가 new Date().toISOString() 으로 저장. 호환을 위해
  // Timestamp 형도 받아서 toDate().toISOString() 변환.
  let tsIso = '';
  if (typeof data.ts === 'string') tsIso = data.ts;
  else if (data.ts && typeof (data.ts as Timestamp).toDate === 'function') {
    try { tsIso = (data.ts as Timestamp).toDate().toISOString(); } catch { tsIso = ''; }
  }
  return {
    _docId: docId,
    ts: tsIso,
    uid: typeof data.uid === 'string' ? data.uid : null,
    email: typeof data.email === 'string' ? data.email : null,
    plan_id: typeof data.plan_id === 'string' ? data.plan_id : null,
    raw_text: typeof data.raw_text === 'string' ? data.raw_text : '',
    language: typeof data.language === 'string' ? data.language : null,
    rule_intent: typeof data.rule_intent === 'string' ? data.rule_intent : 'no_change',
    rule_confidence: Number.isFinite(data.rule_confidence) ? Number(data.rule_confidence) : 0,
    used_llm_fallback: !!data.used_llm_fallback,
    llm_intent: typeof data.llm_intent === 'string' ? data.llm_intent : null,
    llm_confidence: Number.isFinite(data.llm_confidence) ? Number(data.llm_confidence) : null,
    final_intent: typeof data.final_intent === 'string' ? data.final_intent : 'no_change',
    final_confidence: Number.isFinite(data.final_confidence) ? Number(data.final_confidence) : null,
    classifier_source: data.classifier_source === 'llm' ? 'llm' : 'rule',
    mutator_success: !!data.mutator_success,
    mutator_error: typeof data.mutator_error === 'string' ? data.mutator_error : null,
    mutator_code: typeof data.mutator_code === 'string' ? data.mutator_code : null,
    elapsed_ms: Number.isFinite(data.elapsed_ms) ? Number(data.elapsed_ms) : null,
  };
}

/**
 * 최근 N건 로그. ts desc. limit 200 cap (UI table burst 방지 + Firestore read 비용).
 *
 * 사용 예:
 *   const recent = await fetchRecentLogs(100);
 */
export async function fetchRecentLogs(limit = 100): Promise<IntentClassifierLog[]> {
  const cap = Math.max(1, Math.min(200, Number(limit) || 100));
  const q = query(
    collection(db, COLLECTION),
    orderBy('ts', 'desc'),
    fsLimit(cap),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalize(d.id, d.data()));
}

/** 통계 결과 — 이번 주 / 지난 주 비교. */
export interface WeeklyStats {
  windowStart: string;                 // ISO
  windowEnd: string;                   // ISO
  totalRequests: number;
  intentDistribution: Record<string, number>;  // final_intent → count
  llmFallbackCount: number;
  llmFallbackRate: number;             // 0..1
  mutatorFailureCount: number;
  mutatorFailureRate: number;
  avgElapsedMs: number | null;
  avgRuleConfidence: number | null;
  avgFinalConfidence: number | null;
  languageBreakdown: Record<string, number>;
}

function buildEmptyStats(windowStart: string, windowEnd: string): WeeklyStats {
  return {
    windowStart,
    windowEnd,
    totalRequests: 0,
    intentDistribution: {},
    llmFallbackCount: 0,
    llmFallbackRate: 0,
    mutatorFailureCount: 0,
    mutatorFailureRate: 0,
    avgElapsedMs: null,
    avgRuleConfidence: null,
    avgFinalConfidence: null,
    languageBreakdown: {},
  };
}

function aggregateStats(logs: IntentClassifierLog[], windowStart: string, windowEnd: string): WeeklyStats {
  const stats = buildEmptyStats(windowStart, windowEnd);
  if (logs.length === 0) return stats;

  let elapsedSum = 0;
  let elapsedCount = 0;
  let ruleConfSum = 0;
  let ruleConfCount = 0;
  let finalConfSum = 0;
  let finalConfCount = 0;

  for (const log of logs) {
    stats.totalRequests += 1;
    stats.intentDistribution[log.final_intent] = (stats.intentDistribution[log.final_intent] || 0) + 1;
    if (log.used_llm_fallback) stats.llmFallbackCount += 1;
    if (!log.mutator_success) stats.mutatorFailureCount += 1;
    if (typeof log.elapsed_ms === 'number') {
      elapsedSum += log.elapsed_ms;
      elapsedCount += 1;
    }
    if (typeof log.rule_confidence === 'number') {
      ruleConfSum += log.rule_confidence;
      ruleConfCount += 1;
    }
    if (typeof log.final_confidence === 'number') {
      finalConfSum += log.final_confidence;
      finalConfCount += 1;
    }
    const lang = log.language || 'unknown';
    stats.languageBreakdown[lang] = (stats.languageBreakdown[lang] || 0) + 1;
  }

  stats.llmFallbackRate = stats.totalRequests > 0 ? stats.llmFallbackCount / stats.totalRequests : 0;
  stats.mutatorFailureRate = stats.totalRequests > 0 ? stats.mutatorFailureCount / stats.totalRequests : 0;
  stats.avgElapsedMs = elapsedCount > 0 ? elapsedSum / elapsedCount : null;
  stats.avgRuleConfidence = ruleConfCount > 0 ? ruleConfSum / ruleConfCount : null;
  stats.avgFinalConfidence = finalConfCount > 0 ? finalConfSum / finalConfCount : null;

  return stats;
}

/**
 * 지난 7일 통계 + 지난 주 (7-14일 이전) 비교. weekly cron 도 동일 로직 사용
 * (api/_crons/intent-classifier-summary.js).
 */
export async function fetchWeeklyStats(): Promise<{
  thisWeek: WeeklyStats;
  lastWeek: WeeklyStats;
}> {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const thisWeekStart = new Date(now - 7 * oneDay).toISOString();
  const thisWeekEnd = new Date(now).toISOString();
  const lastWeekStart = new Date(now - 14 * oneDay).toISOString();
  const lastWeekEnd = thisWeekStart;

  // Firestore query — ts >= cutoff, ts asc 가 아닌 desc 로 가져온 후 client filter.
  // weekly 단위 = 최대 ~수백건 — 모두 in-memory 처리 안전.
  const cutoff = lastWeekStart;
  const q = query(
    collection(db, COLLECTION),
    where('ts', '>=', cutoff),
    orderBy('ts', 'desc'),
    fsLimit(2000),
  );
  const snap = await getDocs(q);
  const logs = snap.docs.map((d) => normalize(d.id, d.data()));

  const thisWeekLogs = logs.filter((l) => l.ts >= thisWeekStart && l.ts < thisWeekEnd);
  const lastWeekLogs = logs.filter((l) => l.ts >= lastWeekStart && l.ts < lastWeekEnd);

  return {
    thisWeek: aggregateStats(thisWeekLogs, thisWeekStart, thisWeekEnd),
    lastWeek: aggregateStats(lastWeekLogs, lastWeekStart, lastWeekEnd),
  };
}

/**
 * confidence < 0.5 또는 used_llm_fallback=true 인 sample. rule classifier 정확도
 * 개선용 — 운영자가 keyword 추가하는 데이터 자료.
 *
 * 정렬: 최근 우선 (ts desc).
 */
export async function fetchHighFallbackSamples(limit = 30): Promise<IntentClassifierLog[]> {
  const cap = Math.max(1, Math.min(100, Number(limit) || 30));
  // 단일 쿼리로 used_llm_fallback=true 가져오기 — 가장 유효한 폴백 sample.
  // confidence < 0.5 OR fallback=true 둘 다 잡고 싶으면 두 쿼리 + merge 필요하지만
  // Firestore composite query 비용 + index 추가 부담. fallback=true 만 잡는 게 효율적.
  const q = query(
    collection(db, COLLECTION),
    where('used_llm_fallback', '==', true),
    orderBy('ts', 'desc'),
    fsLimit(cap),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalize(d.id, d.data()));
}
