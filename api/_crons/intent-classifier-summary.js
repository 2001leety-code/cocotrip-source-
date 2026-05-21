/**
 * CocoTripKR — Weekly Intent Classifier Summary (P130, 2026-05-21)
 *
 * 매주 화요일 06:00 KST (= UTC 21:00 월요일) 실행. vercel.json crons → cron-runner.js
 * 가 dispatch. 인증은 dispatcher (verifyCronRequest) 가 처리.
 *
 * 목적
 *   지난 7일간 `intent_classifier_logs/{logId}` 집계 → rule classifier 정확도 추적.
 *   threshold 위반 시 telegram admin alert (`throttledTelegramAlert` 패턴 P67).
 *   정상 시 weekly digest (운영자 informative).
 *
 * 임계값 (위반 시 alert)
 *   LLM_FALLBACK_RATE_THRESHOLD     = 0.30  — rule classifier 정확도 하락 의심
 *   MUTATOR_FAILURE_RATE_THRESHOLD  = 0.10  — 수정 시스템 회귀 의심
 *   AVG_ELAPSED_MS_THRESHOLD        = 5000  — 분류 지연 회귀 (LLM 호출 폭증)
 *
 * Firestore 컬렉션
 *   intent_classifier_logs/{logId} — read.
 *
 * Telegram alert key
 *   intent-classifier-fallback-high     — LLM 폴백률 threshold 위반
 *   intent-classifier-mutator-fail-high — mutator 실패율 threshold 위반
 *   intent-classifier-elapsed-high      — 평균 elapsed threshold 위반
 *   intent-classifier-weekly-digest     — 정상 운영 시 weekly informative
 *
 * 실패 모드
 *   - logs 컬렉션 비어있음 → 200 OK + { skipped: true, reason: 'no_logs' }.
 *     dedup-친화적 alert 차단 — 새 modify endpoint 활성 1-2주 동안 정상.
 *   - Firestore 미초기화 → 503 + ok:false.
 *
 * 운영자 manual trigger
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://cocotripkr.com/api/cron-runner?job=intent-classifier-summary"
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { sendErrorAlert } from '../_telegram.js';
import { captureError } from '../_shared/sentry.js';

const COLLECTION = 'intent_classifier_logs';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LLM_FALLBACK_RATE_THRESHOLD = 0.30;
const MUTATOR_FAILURE_RATE_THRESHOLD = 0.10;
const AVG_ELAPSED_MS_THRESHOLD = 5000;
// minimum sample size before triggering threshold alerts — 5건 미만이면 분포 의미 X.
const MIN_SAMPLE_FOR_ALERT = 10;

// ─────────────────────────────────────────────────────────────────────
// 집계 helper (src/lib/intent-classifier-logs.ts 의 aggregateStats 미러)
// ─────────────────────────────────────────────────────────────────────

function aggregateLogs(logs, windowStart, windowEnd) {
  const stats = {
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
    languageBreakdown: {},
  };
  if (logs.length === 0) return stats;

  let elapsedSum = 0;
  let elapsedCount = 0;
  let ruleConfSum = 0;
  let ruleConfCount = 0;

  for (const log of logs) {
    stats.totalRequests += 1;
    const finalIntent = log.final_intent || 'no_change';
    stats.intentDistribution[finalIntent] = (stats.intentDistribution[finalIntent] || 0) + 1;
    if (log.used_llm_fallback === true) stats.llmFallbackCount += 1;
    if (log.mutator_success === false) stats.mutatorFailureCount += 1;
    if (Number.isFinite(log.elapsed_ms)) {
      elapsedSum += log.elapsed_ms;
      elapsedCount += 1;
    }
    if (Number.isFinite(log.rule_confidence)) {
      ruleConfSum += log.rule_confidence;
      ruleConfCount += 1;
    }
    const lang = log.language || 'unknown';
    stats.languageBreakdown[lang] = (stats.languageBreakdown[lang] || 0) + 1;
  }
  stats.llmFallbackRate = stats.totalRequests > 0 ? stats.llmFallbackCount / stats.totalRequests : 0;
  stats.mutatorFailureRate = stats.totalRequests > 0 ? stats.mutatorFailureCount / stats.totalRequests : 0;
  stats.avgElapsedMs = elapsedCount > 0 ? Math.round(elapsedSum / elapsedCount) : null;
  stats.avgRuleConfidence = ruleConfCount > 0 ? Number((ruleConfSum / ruleConfCount).toFixed(3)) : null;
  return stats;
}

// ─────────────────────────────────────────────────────────────────────
// Firestore fetch — 지난 14일 (this week + last week 비교용)
// ─────────────────────────────────────────────────────────────────────

async function fetchLogs(db, sinceIso) {
  // ts >= sinceIso, ts desc. Limit 2000 — weekly 단위 정상 운영 시 < 수백.
  try {
    const snap = await db
      .collection(COLLECTION)
      .where('ts', '>=', sinceIso)
      .orderBy('ts', 'desc')
      .limit(2000)
      .get();
    return snap.docs.map((d) => d.data() || {});
  } catch (err) {
    // Index 미배포 등 — graceful degrade. timestamp filter 없이 limit 2000 만.
    console.warn(`[intent-classifier-summary] indexed query failed (${err.message}) — falling back to unfiltered limit query`);
    const snap = await db
      .collection(COLLECTION)
      .orderBy('ts', 'desc')
      .limit(2000)
      .get();
    return snap.docs.map((d) => d.data() || {}).filter((d) => typeof d.ts === 'string' && d.ts >= sinceIso);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Telegram alert 메시지 빌더
// ─────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPercent(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

function buildIntentDistributionLine(distribution) {
  const entries = Object.entries(distribution || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '없음';
  return entries.map(([k, v]) => `${escapeHtml(k)}=${v}`).join(' · ');
}

function buildDigestMessage(thisWeek, lastWeek) {
  const intentLine = buildIntentDistributionLine(thisWeek.intentDistribution);
  const langLine = buildIntentDistributionLine(thisWeek.languageBreakdown);
  const deltaTotal = thisWeek.totalRequests - lastWeek.totalRequests;
  const deltaSymbol = deltaTotal > 0 ? '↑' : (deltaTotal < 0 ? '↓' : '·');
  return `🧭 <b>Intent Classifier 주간 요약</b>
이번 주 (지난 7일):
• 총 modify 요청: <b>${thisWeek.totalRequests}건</b> (지난주 ${lastWeek.totalRequests}건 ${deltaSymbol}${Math.abs(deltaTotal)})
• Intent 분포: ${intentLine}
• LLM 폴백률: <b>${formatPercent(thisWeek.llmFallbackRate)}</b> (${thisWeek.llmFallbackCount}/${thisWeek.totalRequests})
• Mutator 실패율: <b>${formatPercent(thisWeek.mutatorFailureRate)}</b> (${thisWeek.mutatorFailureCount}/${thisWeek.totalRequests})
• 평균 elapsed: <b>${thisWeek.avgElapsedMs == null ? '-' : thisWeek.avgElapsedMs}ms</b>
• 평균 rule confidence: <b>${thisWeek.avgRuleConfidence == null ? '-' : thisWeek.avgRuleConfidence}</b>
• 언어 분포: ${langLine}

운영자 액션:
- 상세 분석: <a href="https://cocotripkr.com/admin/intent-classifier">/admin/intent-classifier</a>
- 폴백률 30%+ 시 rule classifier keyword 추가 권장.`;
}

function buildFallbackAlert(thisWeek) {
  return `🟡 <b>Intent classifier LLM 폴백률 ${formatPercent(thisWeek.llmFallbackRate)}</b>
rule classifier 정확도 하락 의심 — 임계 ${formatPercent(LLM_FALLBACK_RATE_THRESHOLD)} 초과.

지난 7일:
• 총 요청: ${thisWeek.totalRequests}건
• 폴백 발생: ${thisWeek.llmFallbackCount}건
• 평균 rule confidence: ${thisWeek.avgRuleConfidence == null ? '-' : thisWeek.avgRuleConfidence}
• Intent 분포: ${buildIntentDistributionLine(thisWeek.intentDistribution)}

조치: <a href="https://cocotripkr.com/admin/intent-classifier">/admin/intent-classifier</a> 의 "training data" 패널에서 폴백 sample 확인 후 src/ai_planner/intent-classifier.ts 의 BLOCK_SWAP_KEYWORDS / STOP_ADD_TRIGGERS 등에 신규 keyword 추가.`;
}

function buildMutatorFailureAlert(thisWeek) {
  return `🔴 <b>Intent classifier mutator 실패율 ${formatPercent(thisWeek.mutatorFailureRate)}</b>
수정 시스템 회귀 의심 — 임계 ${formatPercent(MUTATOR_FAILURE_RATE_THRESHOLD)} 초과.

지난 7일:
• 총 요청: ${thisWeek.totalRequests}건
• mutator 실패: ${thisWeek.mutatorFailureCount}건
• Intent 분포: ${buildIntentDistributionLine(thisWeek.intentDistribution)}

조치: <a href="https://cocotripkr.com/admin/intent-classifier">/admin/intent-classifier</a> 에서 mutator_code 분포 확인 (BLOCK_NOT_FOUND / STOP_NOT_FOUND / DIETARY_UNSATISFIED 등).`;
}

function buildElapsedAlert(thisWeek) {
  return `🟠 <b>Intent classifier 평균 elapsed ${thisWeek.avgElapsedMs}ms</b>
분류 지연 회귀 — 임계 ${AVG_ELAPSED_MS_THRESHOLD}ms 초과.

지난 7일:
• 총 요청: ${thisWeek.totalRequests}건
• 평균 elapsed: ${thisWeek.avgElapsedMs}ms
• LLM 폴백률: ${formatPercent(thisWeek.llmFallbackRate)} (LLM 호출 증가 시 elapsed 같이 상승)

조치: Vercel 함수 cold-start / Gemini API latency 확인. 폴백률 같이 상승했으면 rule classifier 보강 우선.`;
}

// ─────────────────────────────────────────────────────────────────────
// Vercel handler
// ─────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = initAdminDb('cron/intent-classifier-summary');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[intent-classifier-summary]', msg);
    try { await sendErrorAlert('intent-classifier-summary', new Error(msg)); } catch {}
    return res.status(503).json({ ok: false, error: msg });
  }

  const now = Date.now();
  const thisWeekStartMs = now - WEEK_MS;
  const lastWeekStartMs = now - 2 * WEEK_MS;
  const thisWeekStartIso = new Date(thisWeekStartMs).toISOString();
  const lastWeekStartIso = new Date(lastWeekStartMs).toISOString();
  const nowIso = new Date(now).toISOString();

  try {
    const logs = await fetchLogs(db, lastWeekStartIso);

    if (logs.length === 0) {
      console.log('[intent-classifier-summary] no logs in window — skipping');
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'no_logs',
        windowStart: lastWeekStartIso,
        windowEnd: nowIso,
      });
    }

    const thisWeekLogs = logs.filter((l) => typeof l.ts === 'string' && l.ts >= thisWeekStartIso);
    const lastWeekLogs = logs.filter((l) => typeof l.ts === 'string' && l.ts >= lastWeekStartIso && l.ts < thisWeekStartIso);

    const thisWeek = aggregateLogs(thisWeekLogs, thisWeekStartIso, nowIso);
    const lastWeek = aggregateLogs(lastWeekLogs, lastWeekStartIso, thisWeekStartIso);

    // ── threshold 위반 alert (각각 독립 dedup key — 동시에 여러 alert 가능)
    const alerts = [];
    if (
      thisWeek.totalRequests >= MIN_SAMPLE_FOR_ALERT &&
      thisWeek.llmFallbackRate > LLM_FALLBACK_RATE_THRESHOLD
    ) {
      alerts.push(
        throttledTelegramAlert({
          key: 'intent-classifier-fallback-high',
          channel: 'error',
          severity: 'medium',
          message: buildFallbackAlert(thisWeek),
          context: {
            errorCode: 'INTENT_FALLBACK_HIGH',
            reason: `rate=${formatPercent(thisWeek.llmFallbackRate)}, total=${thisWeek.totalRequests}`,
          },
        }).catch((e) => console.warn('[intent-classifier-summary] fallback alert failed:', e?.message))
      );
    }
    if (
      thisWeek.totalRequests >= MIN_SAMPLE_FOR_ALERT &&
      thisWeek.mutatorFailureRate > MUTATOR_FAILURE_RATE_THRESHOLD
    ) {
      alerts.push(
        throttledTelegramAlert({
          key: 'intent-classifier-mutator-fail-high',
          channel: 'error',
          severity: 'high',
          message: buildMutatorFailureAlert(thisWeek),
          context: {
            errorCode: 'INTENT_MUTATOR_FAIL_HIGH',
            reason: `rate=${formatPercent(thisWeek.mutatorFailureRate)}, total=${thisWeek.totalRequests}`,
          },
        }).catch((e) => console.warn('[intent-classifier-summary] mutator alert failed:', e?.message))
      );
    }
    if (
      thisWeek.totalRequests >= MIN_SAMPLE_FOR_ALERT &&
      thisWeek.avgElapsedMs &&
      thisWeek.avgElapsedMs > AVG_ELAPSED_MS_THRESHOLD
    ) {
      alerts.push(
        throttledTelegramAlert({
          key: 'intent-classifier-elapsed-high',
          channel: 'error',
          severity: 'medium',
          message: buildElapsedAlert(thisWeek),
          context: {
            errorCode: 'INTENT_ELAPSED_HIGH',
            reason: `avg=${thisWeek.avgElapsedMs}ms, total=${thisWeek.totalRequests}`,
          },
        }).catch((e) => console.warn('[intent-classifier-summary] elapsed alert failed:', e?.message))
      );
    }

    // ── threshold 안 걸렸으면 weekly digest 발송 (informative — throttle 보호)
    const hasThresholdAlert = alerts.length > 0;
    if (!hasThresholdAlert && thisWeek.totalRequests > 0) {
      alerts.push(
        throttledTelegramAlert({
          key: 'intent-classifier-weekly-digest',
          channel: 'admin',
          severity: 'low',
          message: buildDigestMessage(thisWeek, lastWeek),
          context: { errorCode: 'WEEKLY_DIGEST' },
        }).catch((e) => console.warn('[intent-classifier-summary] digest send failed:', e?.message))
      );
    }
    await Promise.all(alerts);

    console.log(
      `[intent-classifier-summary] done: totalLogs=${logs.length} thisWeek=${thisWeek.totalRequests} lastWeek=${lastWeek.totalRequests} fallback=${thisWeek.llmFallbackCount} muFail=${thisWeek.mutatorFailureCount}`,
    );
    return res.status(200).json({
      ok: true,
      thisWeek,
      lastWeek,
      thresholds: {
        llmFallbackRate: LLM_FALLBACK_RATE_THRESHOLD,
        mutatorFailureRate: MUTATOR_FAILURE_RATE_THRESHOLD,
        avgElapsedMs: AVG_ELAPSED_MS_THRESHOLD,
        minSampleForAlert: MIN_SAMPLE_FOR_ALERT,
      },
      alertsFired: hasThresholdAlert ? alerts.length : 0,
    });
  } catch (err) {
    console.error('[intent-classifier-summary] handler error:', err.message);
    try { await sendErrorAlert('intent-classifier-summary', err); } catch {}
    await captureError(err, { route: 'cron/intent-classifier-summary' });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
