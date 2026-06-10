/**
 * 📣 마케팅 직원 — 모닝 브리핑용 PostHog 어제 지표 (방문자·전환).
 *
 * 2026-06-10: 자가운영 에이전시 배치 A. AI 0(HogQL=SQL). graceful — 키 없거나 실패해도
 * {skipped:true} 반환 → cron 이 나머지 3섹션 정상 발송. (메모리: prod VITE_POSTHOG_KEY 미설정 시
 * 프론트 이벤트 0건일 수 있음 → 0이면 "수집 중" 표기, 에러 아님.)
 *
 * 재사용: posthog-host.js (resolvePosthogQueryHost). env: POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID / POSTHOG_HOST.
 */
import { resolvePosthogQueryHost } from './posthog-host.js';

/** epoch ms → 'YYYY-MM-DD HH:MM:SS' (UTC, PostHog timestamp 비교용). 완전 통제값 = injection 무. */
function utcDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 어제 방문자(uniq person) + 전환(payment_completed) HogQL. */
export function buildMarketingSQL(yStartMs, todayStartMs) {
  const a = utcDateTime(yStartMs);
  const b = utcDateTime(todayStartMs);
  return `SELECT count(DISTINCT person_id) AS visitors, countIf(event = 'payment_completed') AS conversions `
    + `FROM events WHERE timestamp >= toDateTime('${a}') AND timestamp < toDateTime('${b}')`;
}

/** PostHog query 응답 results([[visitors, conversions]]) → 정규화. 순수 = 단위 테스트. */
export function normalizeMarketing(results) {
  const row = Array.isArray(results) && results.length ? results[0] : [];
  return { visitors: Number(row && row[0]) || 0, conversions: Number(row && row[1]) || 0 };
}

/**
 * 어제 마케팅 지표 fetch. 네트워크 — graceful.
 * @returns {Promise<{skipped:boolean, reason?:string, visitors?:number, conversions?:number}>}
 */
export async function fetchMarketingMetrics(yStartMs, todayStartMs) {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId || process.env.POSTHOG_DISABLED === 'true') {
    return { skipped: true, reason: 'not_configured' };
  }
  try {
    const HOST = resolvePosthogQueryHost(process.env.POSTHOG_HOST);
    const r = await fetch(`${HOST}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: buildMarketingSQL(yStartMs, todayStartMs) } }),
    });
    if (!r.ok) return { skipped: true, reason: `http_${r.status}` };
    const data = await r.json();
    return { skipped: false, ...normalizeMarketing(data && data.results) };
  } catch (e) {
    return { skipped: true, reason: (e && e.message) || 'fetch_error' };
  }
}
