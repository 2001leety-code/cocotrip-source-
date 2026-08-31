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
 *   - CRON_SECRET Bearer 또는 운영자 Firebase 토큰만 허용한다.
 *   - cron-runner.js 경유와 직접 함수 호출 모두 같은 검증기를 사용한다.
 *
 * 운영자 manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://cocotripkr.com/api/cron-runner?job=weekly-quality-report"
 *
 * 참고:
 *   - 한국어 admin only — i18n 키 추가 X
 *   - 실패 시 sendErrorAlert + Sentry captureError, 응답은 항상 JSON
 *   - Gemini / Firestore / Telegram 모두 graceful failsafe
 */

import { initAdminDb } from '../_shared/firebase-admin.js';
import { verifyCronRequest } from '../_shared/cron-auth.js';
import { sendLongMessage, sendErrorAlert } from '../_telegram.js';
import { captureError } from '../_shared/sentry.js';
import {
  collectQualityCounts,
  aggregateSummary,
  hasSufficientDataForLLM,
  llmFallbackText,
} from '../_shared/quality-summary-helper.js';

// PR-D (2026-05-07): 컬렉션 fetch + 집계 + 임계값 가드는 _shared/quality-summary-helper.js
// 로 추출. admin-quality-summary 와 동일 spec 으로 단일 진실 원천 유지.

// 본 파일은 cron flow 만 담당:
//   1. helper.collectQualityCounts(db, sinceMs)  — 4 collection fetch + missing 표기
//   2. helper.aggregateSummary({...})            — 요약 객체
//   3. hasSufficientDataForLLM(summary)          — Gemini 호출 임계값 가드 (PR-D)
//   4. callGemini(prompt) 또는 llmFallbackText() — LLM or 정적
//   5. formatTelegramReport()                    — Telegram HTML
//   6. Firestore weekly_quality_reports 보관

// ── 상수 ──────────────────────────────────────────────────────────────
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// helper 에 동일 keys/labels 가 있지만 로컬 코드 호환 위해 export 유지.
export { aggregateSummary };

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
export function formatTelegramReport({
  summary, geminiSummary, sinceMs, untilMs,
  collectionMissing = [],
}) {
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

  // PR-D: 수집 미작동 컬렉션이 있으면 메시지 상단에 명시 (운영자 즉시 인지)
  const missingPrefix = (collectionMissing && collectionMissing.length > 0)
    ? `⚠️ <b>수집 미작동 컬렉션</b>: ${collectionMissing.join(', ')}\n  → 데이터 수집 경로 점검 필요\n\n`
    : '';

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

  return `${missingPrefix}${stats}━━━ 🤖 AI 요약 ━━━\n${ai}\n\n🌐 cocotripkr.com/admin`;
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
    // PR-D: helper 로 fetch + missing 감지 (silent fail 금지)
    const {
      complaints, tickets, errors, plans,
      _collectionMissing, _collectionErrors,
    } = await collectQualityCounts(db, sinceMs);
    console.log(
      `[weekly-quality-report] fetched: complaints=${complaints.length} tickets=${tickets.length} ` +
      `errors=${errors.length} plans=${plans.length} missing=[${(_collectionMissing || []).join(',')}]`,
    );

    const summary = aggregateSummary({ complaints, tickets, errors, plans });

    // PR-D 임계값 가드 — plans>=5 AND signals>=3 일 때만 Gemini 호출.
    // 미달 시 정적 fallback 사용 (비용 + hallucination 방지).
    let geminiSummary = '';
    let geminiSkipReason = null;
    if (hasSufficientDataForLLM(summary)) {
      const prompt = buildGeminiPrompt(summary);
      geminiSummary = await callGemini(prompt);
      if (!geminiSummary) {
        geminiSkipReason = 'gemini_failed';
        geminiSummary = '(Gemini 요약 실패 — Vercel 로그 확인)';
      }
    } else {
      geminiSkipReason = 'insufficient_data';
      geminiSummary = llmFallbackText(summary, 'ko');
      console.log('[weekly-quality-report] LLM 임계값 미달 → 정적 fallback 사용', {
        plans: summary.plansGenerated,
        signals: summary.totalTickets + summary.totalErrors + summary.totalComplaints,
      });
    }

    // Telegram 발송 (missing 알림 prefix 추가 — 운영자 수집 미작동 인지)
    const telegramMsg = formatTelegramReport({
      summary,
      geminiSummary,
      sinceMs,
      untilMs: now,
      collectionMissing: _collectionMissing,
    });
    try {
      await sendLongMessage(telegramMsg);
    } catch (e) {
      console.warn('[weekly-quality-report] Telegram 발송 실패:', e.message);
      await captureError(e, { route: 'cron/weekly-quality-report', step: 'telegram' });
    }

    // Firestore 보관 (missing 정보 + skip reason 함께 저장)
    try {
      await db.collection('weekly_quality_reports').add({
        generatedAt: now,
        window: { sinceMs, untilMs: now },
        summary,
        geminiSummary: geminiSummary || null,
        geminiSkipReason: geminiSkipReason || null,
        collectionMissing: _collectionMissing || [],
        collectionErrors: _collectionErrors || {},
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
        geminiSkipReason,
        collectionMissing: _collectionMissing,
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

  const auth = await verifyCronRequest(req);
  if (!auth.ok) {
    res.statusCode = auth.status;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, code: 'AUTH_REQUIRED', error: auth.error }));
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
