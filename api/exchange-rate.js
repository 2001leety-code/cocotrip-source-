/**
 * Vercel API Route: 현재 USD→KRW 환율 (운영자 대시보드용)
 * GET /api/exchange-rate
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * backend `_exchange-rate.js` 의 live rate (Firestore 6h 캐시 + 4-소스 폴백) 를
 * 운영자 정책 (floor 1450, sanity max 2000 — 2026-05-13) 적용해 단일 숫자로 반환.
 * 매출 대시보드(admin-sales)·결제(createPaypalOrder getUsdToKrwRaw)와 **동일 SSOT**.
 *
 * 용도: M8 월별 손익(ProfitSettlement) 환율 기본값을 실시간으로 채움 (운영자 편집 가능).
 *       이전엔 stale 1380 하드코딩 → 실시세/정책과 drift → 두 화면이 다른 환율 표시.
 *
 * 인증: admin only. FX 자체는 공개 정보지만 유일 소비자가 어드민이라 게이트해 외부 API 남용 차단.
 *       (getExchangeRate 는 6h 캐시 우선이라 외부 호출은 캐시 만료 시에만 — 비용 무시 수준.)
 *
 * Returns: { krwPerUsd: number, source: string, fetchedAt: ISO|null }
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { getExchangeRate, applyRatePolicy } from './_exchange-rate.js';

// 캐시 미스 시 외부 fetch 체인 (4 소스 × 4.5s timeout) 최악 ~18s 대비 여유.
export const maxDuration = 25;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') {
    return json(req, res, 405, { error: 'Method Not Allowed' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });
  }

  try {
    const { krwPerUsd, source, fetchedAt } = await getExchangeRate();
    const rate = applyRatePolicy(krwPerUsd); // floor 1450 / sanity max 2000 정책 적용
    return json(req, res, 200, {
      krwPerUsd: rate,
      source: source || 'unknown',
      fetchedAt: fetchedAt instanceof Date ? fetchedAt.toISOString() : (fetchedAt || null),
    });
  } catch (e) {
    console.error('[exchange-rate] handler error:', e?.message);
    return json(req, res, 500, { error: 'rate_unavailable', code: 'RATE_ERROR' });
  }
}
