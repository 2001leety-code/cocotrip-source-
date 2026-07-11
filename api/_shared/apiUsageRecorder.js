// 사용량 트래커 — Gemini 호출별 토큰·예상비용을 Firestore api_usage 에 기록.
// ⚠️ fire-and-forget + 완전 guard: 절대 plan 생성 흐름을 막거나 throw 하지 않는다.
//    트래커 실패 = 조용히 skip(본 흐름 영향 0). 일부 write 유실은 허용(best-effort).
import { initAdminDb } from './firebase-admin.js';
import { estimateGeminiCostUsd } from './apiPricing.js';

function kstDayStr(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Gemini 사용량 1건 기록. 비동기지만 호출자는 await 하지 않는다(fire-and-forget).
 * @param {{stage:string, model:string, cm:{total:number,output:number,cached:number}}} p
 */
/**
 * SDK 응답 객체에서 usageMetadata를 뽑아 바로 기록 (편의 헬퍼, 2026-07-09 비용 가시화).
 * 사용: recordUsageFromResponse('chat', 'gemini-2.5-flash', result.response)
 * fire-and-forget — 호출자는 await 불필요, 어떤 실패도 본 흐름 영향 0.
 */
export function recordUsageFromResponse(stage, model, response) {
  try {
    const um = response && response.usageMetadata;
    if (!um) return;
    recordGeminiUsage({
      stage,
      model,
      cm: {
        total: Number(um.promptTokenCount) || 0,
        cached: Number(um.cachedContentTokenCount) || 0,
        output: Number(um.candidatesTokenCount) || 0,
      },
    });
  } catch { /* ignore */ }
}

export async function recordGeminiUsage({ stage, model, cm } = {}) {
  try {
    if (!cm || (!cm.total && !cm.output)) return;
    const db = initAdminDb();
    if (!db) return;
    const ms = Date.now();
    await db.collection('api_usage').add({
      service: 'gemini',
      model: String(model || 'unknown'),
      stage: String(stage || ''),
      input_tokens: Number(cm.total) || 0,
      cached_tokens: Number(cm.cached) || 0,
      output_tokens: Number(cm.output) || 0,
      cost_usd: estimateGeminiCostUsd(model, cm),
      ms,
      day: kstDayStr(ms),
    });
  } catch (e) {
    console.warn('[api-usage] record skip:', e && e.message);
  }
}
