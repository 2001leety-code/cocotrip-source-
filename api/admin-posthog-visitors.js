/**
 * Vercel API Route: PostHog 방문자 통계
 * GET /api/admin-posthog-visitors
 *
 * 응답:
 *   {
 *     today:   { uniqueVisitors, pageviews },
 *     week:    { uniqueVisitors, pageviews },
 *     month:   { uniqueVisitors, pageviews },
 *     topPages: [{ path, pageviews }] (최근 7일 TOP 5),
 *     excludedAdmin: <admin email> | null
 *   }
 *
 * 운영자 본인 (process.env.ADMIN_EMAIL 또는 ADMIN_BYPASS_EMAILS 첫 entry) 의
 * distinct_id 필터링 — PostHog properties.distinct_id != admin email.
 *
 * 보안: verifyAdminToken (admin email 매칭) 필수.
 *
 * Env:
 *   POSTHOG_PERSONAL_API_KEY  — PostHog Personal API Key (Settings → Personal API Keys)
 *                                ※ project_api_key (이벤트 ingest 용) 와 다름. query API
 *                                  는 personal key 만 통과.
 *   POSTHOG_PROJECT_ID         — PostHog Project ID (Settings → Project URL 의 숫자)
 *   POSTHOG_HOST               — 기본 https://us.posthog.com
 *                                ※ US Cloud query/private endpoint host. ingestion 용
 *                                  us.i.posthog.com 과 다름. EU 는 eu.posthog.com.
 *                                  잘못 설정 시 query API 403/4xx (A1-2 root cause).
 *   ADMIN_EMAIL                — 운영자 본인 이메일 (필터 제외 대상)
 *
 * 미설정 시 503 — UI 가 "PostHog 미연결" 로 fallback.
 *
 * A1-2 (2026-05-24): 이전 default `https://us.i.posthog.com` (ingestion host) 는 query
 *   API 거부 → 403. PostHog docs: "US Cloud, public endpoints us.i.posthog.com /
 *   private endpoints us.posthog.com." Insight/Trend 는 private endpoint.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { resolvePosthogQueryHost, formatPosthogError, buildVisitorSQL, buildTopPagesSQL } from './_shared/posthog-host.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });
const CORS_METHODS = 'GET, OPTIONS';

// A1-2: query API host. ingestion host (us.i.posthog.com) 와 분리.
const HOST = resolvePosthogQueryHost(process.env.POSTHOG_HOST);

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

function adminEmailToExclude() {
  // 1) ADMIN_EMAIL 명시
  if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL.toLowerCase().trim();
  // 2) ADMIN_BYPASS_EMAILS 의 첫 entry (쉼표 구분)
  const list = (process.env.ADMIN_BYPASS_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length > 0 ? list[0].toLowerCase() : null;
}

// A1-2 후속 (2026-06-03): PostHog 신규 계정은 legacy insight endpoint 차단
//   ("Legacy insight endpoints are not available for this user") → 신 Query API(HogQL) 로 전환.
//   SQL 빌더(buildVisitorSQL/buildTopPagesSQL)는 _shared/posthog-host.js (순수 모듈, 테스트 가능).

/** PostHog 신 Query API (HogQL). 응답 data.results = 행 배열(각 행 = 컬럼값 배열). */
async function posthogQuery({ apiKey, projectId, sql }) {
  const r = await fetch(`${HOST}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(formatPosthogError('query', r.status, detail));
  }
  const data = await r.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function posthogTrend({ apiKey, projectId, days, excludeEmail }) {
  const rows = await posthogQuery({ apiKey, projectId, sql: buildVisitorSQL(days, excludeEmail) });
  const row = rows[0] || [0, 0];
  return { uniqueVisitors: Number(row[0]) || 0, pageviews: Number(row[1]) || 0 };
}

async function posthogTopPages({ apiKey, projectId, days, excludeEmail }) {
  const rows = await posthogQuery({ apiKey, projectId, sql: buildTopPagesSQL(days, excludeEmail) });
  return rows.map((row) => ({ path: row[0] || '(unknown)', pageviews: Number(row[1]) || 0 }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') return json(req, res, 405, _err('GET only', 'METHOD_NOT_ALLOWED'));

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, _err(auth.error, 'AUTH_FAILED'));

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) {
    return json(req, res, 503, _err('PostHog 미연결 — POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID env 등록 필요', 'POSTHOG_DISABLED'));
  }

  const excludeEmail = adminEmailToExclude();

  try {
    const [today, week, month, topPages] = await Promise.all([
      posthogTrend({ apiKey, projectId, days: 1, excludeEmail }),
      posthogTrend({ apiKey, projectId, days: 7, excludeEmail }),
      posthogTrend({ apiKey, projectId, days: 30, excludeEmail }),
      posthogTopPages({ apiKey, projectId, days: 7, excludeEmail }),
    ]);

    return json(req, res, 200, _ok({
      today, week, month, topPages,
      excludedAdmin: excludeEmail,
      generatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.error('[admin-posthog-visitors]', err);
    return json(req, res, 500, _err(err.message, 'POSTHOG_QUERY_FAILED'));
  }
}
