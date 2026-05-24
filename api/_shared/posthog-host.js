/**
 * PostHog API host + error formatting helpers.
 *
 * A1-2 (2026-05-24): 어드민 외부 방문자 통계 카드가 "PostHog trend 403" 으로 가동 중단.
 * Root cause: HOST default `https://us.i.posthog.com` (ingestion-only public endpoint) 가
 * private query API (`/api/projects/<id>/insights/trend/`) 를 거부.
 *
 * PostHog docs (https://posthog.com/docs/api):
 *   - US Cloud public (ingest):   https://us.i.posthog.com
 *   - US Cloud private (query):   https://us.posthog.com
 *   - EU Cloud public (ingest):   https://eu.i.posthog.com
 *   - EU Cloud private (query):   https://eu.posthog.com
 *
 * 운영자가 ENV POSTHOG_HOST 를 ingestion host 로 잘못 입력 시 자동 교정 — silent 403 회피.
 */

/**
 * Resolve PostHog query API host (private endpoints).
 *
 * @param {string|undefined} rawHost - process.env.POSTHOG_HOST raw value
 * @returns {string} normalized query host (no trailing slash)
 */
export function resolvePosthogQueryHost(rawHost) {
  const trimmed = (rawHost || '').trim();
  if (!trimmed) return 'https://us.posthog.com';
  // 운영자가 실수로 ingestion host 입력 시 query host 로 교정
  if (/^https?:\/\/us\.i\.posthog\.com/i.test(trimmed)) return 'https://us.posthog.com';
  if (/^https?:\/\/eu\.i\.posthog\.com/i.test(trimmed)) return 'https://eu.posthog.com';
  return trimmed.replace(/\/$/, '');
}

/**
 * Format PostHog API error into operator-actionable message.
 *
 * 같은 raw "PostHog trend 403" 만으로는 personal key 인지 host 인지 project id 인지 모름.
 * 401/403/404 별 어느 ENV 를 손봐야 하는지 명시.
 *
 * @param {string} label - 호출 종류 (예: 'trend', 'breakdown', 'funnel:plan_generated')
 * @param {number} status - HTTP status
 * @param {string} detail - response body snippet (optional)
 * @returns {string} human-readable error message
 */
export function formatPosthogError(label, status, detail) {
  const snippet = (detail || '').slice(0, 200);
  if (status === 401) {
    return `PostHog ${label} 401 — POSTHOG_PERSONAL_API_KEY 갱신 필요 (Settings → Personal API Keys). ${snippet}`;
  }
  if (status === 403) {
    return `PostHog ${label} 403 — POSTHOG_PERSONAL_API_KEY 권한 부족 또는 POSTHOG_HOST 가 ingestion(us.i.posthog.com) 잘못 지정. query host 는 us.posthog.com. ${snippet}`;
  }
  if (status === 404) {
    return `PostHog ${label} 404 — POSTHOG_PROJECT_ID 가 잘못됨 (다른 프로젝트 id). ${snippet}`;
  }
  return `PostHog ${label} ${status}: ${snippet}`;
}
