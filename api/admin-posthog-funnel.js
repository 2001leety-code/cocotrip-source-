/**
 * Vercel API Route: PostHog Funnel for AdminAnalytics ConversionFunnel
 * GET /api/admin-posthog-funnel?days=30
 *
 * 4단계 퍼널:
 *   1. $pageview (path = /planner)
 *   2. plan_generated
 *   3. payment_started
 *   4. payment_completed
 *
 * 보안:
 *   - Firebase ID token (verifyAdminToken) 필수
 *   - 어드민 이메일만 통과
 *
 * ENV:
 *   POSTHOG_PERSONAL_API_KEY  — PostHog 개인 API 키 (Settings → Personal API Keys)
 *                                ※ project_api_key (이벤트 ingest 용) 와 다름.
 *   POSTHOG_PROJECT_ID        — PostHog 프로젝트 ID (URL에서 확인)
 *   POSTHOG_HOST              — 기본 https://us.posthog.com
 *                                ※ A1-2 (2026-05-24): ingestion us.i.posthog.com 가
 *                                  query API 403 거부. private query host 는 us.posthog.com.
 *
 * PostHog 미설정 시 503 응답 — ConversionFunnel.tsx가 Firestore-only로 폴백.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { resolvePosthogQueryHost, formatPosthogError } from './_shared/posthog-host.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

const HOST = resolvePosthogQueryHost(process.env.POSTHOG_HOST);

const FUNNEL_STEPS = [
  { id: 'pageview', label: '플래너 페이지 진입', event: '$pageview', filter: { properties: [{ key: '$pathname', value: '/planner', operator: 'icontains' }] } },
  { id: 'plan_generated', label: 'AI 일정 생성 완료', event: 'plan_generated' },
  { id: 'payment_started', label: '예약/결제창 진입', event: 'payment_started' },
  { id: 'payment_completed', label: '결제 완료', event: 'payment_completed' },
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') return json(req, res, 405, _err('GET only', 'METHOD_NOT_ALLOWED'));

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) {
    return json(req, res, 503, _err('PostHog not configured', 'POSTHOG_DISABLED'));
  }

  const url = new URL(req.url, 'http://localhost');
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  // PostHog Funnel insight 생성 후 결과 조회
  // 간편화를 위해 events 카운트만 별도 query 4번 (PostHog 동시 요청 OK)
  try {
    const dateFrom = `-${days}d`;
    const counts = await Promise.all(
      FUNNEL_STEPS.map(async (step) => {
        const body = {
          insight: 'TRENDS',
          events: [{ id: step.event, type: 'events', math: 'dau', ...(step.filter || {}) }],
          date_from: dateFrom,
          interval: 'day',
        };
        const r = await fetch(`${HOST}/api/projects/${projectId}/insights/trend/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(formatPosthogError(`funnel:${step.id}`, r.status, text));
        }
        const data = await r.json();
        // result[0].count = 합계
        const total = data.result?.[0]?.count || 0;
        return { id: step.id, label: step.label, count: total };
      }),
    );

    return json(req, res, 200, _ok({ days, steps: counts, host: HOST, projectId }));
  } catch (err) {
    console.error('[admin-posthog-funnel] error:', err);
    return json(req, res, 500, _err(err.message, 'POSTHOG_ERROR'));
  }
}
