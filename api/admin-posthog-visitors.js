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
 *   POSTHOG_PERSONAL_API_KEY  — PostHog Personal API Key
 *   POSTHOG_PROJECT_ID         — PostHog Project ID
 *   POSTHOG_HOST               — 기본 https://us.i.posthog.com
 *   ADMIN_EMAIL                — 운영자 본인 이메일 (필터 제외 대상)
 *
 * 미설정 시 503 — UI 가 "PostHog 미연결" 로 fallback.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });
const CORS_METHODS = 'GET, OPTIONS';
const HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

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

async function posthogTrend({ apiKey, projectId, dateFrom, dateTo, excludeEmail }) {
  const body = {
    insight: 'TRENDS',
    events: [{ id: '$pageview', type: 'events', math: 'dau' }],
    date_from: dateFrom,
    ...(dateTo ? { date_to: dateTo } : {}),
    interval: 'day',
    ...(excludeEmail ? {
      properties: [
        { key: 'email', value: excludeEmail, operator: 'is_not', type: 'person' },
      ],
    } : {}),
  };
  const r = await fetch(`${HOST}/api/projects/${projectId}/insights/trend/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`PostHog trend ${r.status}`);
  const data = await r.json();
  const series = data?.result?.[0]?.data || [];
  const total = series.reduce((s, n) => s + (Number(n) || 0), 0);
  return { uniqueVisitors: total, pageviews: total, perDay: series };
}

async function posthogTopPages({ apiKey, projectId, dateFrom, excludeEmail }) {
  const body = {
    insight: 'TRENDS',
    events: [{ id: '$pageview', type: 'events', math: 'total' }],
    breakdown: '$pathname',
    breakdown_type: 'event',
    date_from: dateFrom,
    interval: 'day',
    ...(excludeEmail ? {
      properties: [
        { key: 'email', value: excludeEmail, operator: 'is_not', type: 'person' },
      ],
    } : {}),
  };
  const r = await fetch(`${HOST}/api/projects/${projectId}/insights/trend/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`PostHog breakdown ${r.status}`);
  const data = await r.json();
  const results = data?.result || [];
  return results
    .map((r) => ({ path: r.breakdown_value || '(unknown)', pageviews: r.aggregated_value || 0 }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 5);
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
      posthogTrend({ apiKey, projectId, dateFrom: '-1d', excludeEmail }),
      posthogTrend({ apiKey, projectId, dateFrom: '-7d', excludeEmail }),
      posthogTrend({ apiKey, projectId, dateFrom: '-30d', excludeEmail }),
      posthogTopPages({ apiKey, projectId, dateFrom: '-7d', excludeEmail }),
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
