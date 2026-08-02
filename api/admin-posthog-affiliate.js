/**
 * Vercel API Route: 관리자 제휴 노출·클릭 성과
 * GET /api/admin-posthog-affiliate?days=30
 *
 * PostHog에 이미 쌓이는 affiliate_impression / affiliate_click만 읽는다.
 * 새 추적 저장소를 만들지 않아 Firestore 쓰기 비용과 공개 쓰기 공격면을 늘리지 않는다.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import {
  buildAffiliatePerformanceSQL,
  formatPosthogError,
  resolvePosthogQueryHost,
} from './_shared/posthog-host.js';
import { aggregateAffiliateRows } from './_shared/affiliatePerformance.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';
const HOST = resolvePosthogQueryHost(process.env.POSTHOG_HOST);

/** 관리자 API 공통 CORS를 적용해 JSON을 반환한다. */
function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

/** 운영자 본인 트래픽을 제휴 성과에서 제외할 이메일을 찾는다. */
function adminEmailToExclude() {
  if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL.toLowerCase().trim();
  const list = (process.env.ADMIN_BYPASS_EMAILS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return list.length > 0 ? list[0].toLowerCase() : null;
}

/** PostHog Query API에 HogQL을 실행하고 행 배열만 반환한다. */
async function posthogQuery({ apiKey, projectId, sql }) {
  const response = await fetch(`${HOST}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(formatPosthogError('affiliate query', response.status, detail));
  }
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

/** 인증된 운영자에게 운영 도메인의 제휴 성과만 반환한다. */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }
  if (req.method !== 'GET') {
    return json(req, res, 405, { ok: false, error: 'GET only', code: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });
  }

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) {
    return json(req, res, 503, {
      ok: false,
      error: 'PostHog 미연결 — Vercel Production의 POSTHOG_PERSONAL_API_KEY와 POSTHOG_PROJECT_ID를 확인하세요.',
      code: 'POSTHOG_DISABLED',
    });
  }

  const url = new URL(req.url, 'http://localhost');
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get('days')) || 30));

  try {
    const rows = await posthogQuery({
      apiKey,
      projectId,
      sql: buildAffiliatePerformanceSQL(days, adminEmailToExclude()),
    });
    return json(req, res, 200, {
      ok: true,
      data: {
        days,
        ...aggregateAffiliateRows(rows),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[admin-posthog-affiliate]', error);
    return json(req, res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'PostHog 조회 실패',
      code: 'POSTHOG_QUERY_FAILED',
    });
  }
}
