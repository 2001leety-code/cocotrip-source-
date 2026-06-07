/**
 * GET /api/promo-config — 배너 설정 공개 읽기 (인증 불필요).
 *
 * 프론트엔드 PromoBanner.tsx 가 마운트 시 호출. 배너 표시값(enabled/copy/ctaText/ctaHref/endDate)만 반환.
 * 에러 / Firestore 없으면 DEFAULT_PROMO_CONFIG 반환 (배너 항상 표시 보장).
 *
 * 보안:
 *   - GET만 (쓰기 불가). 배너 표시값 외 내부 데이터 미노출.
 *   - CORS: 공개 wildcard — 파트너 임베드 지원 (cors.js 주석 참고, public endpoints 는 wildcard 유지).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { getPromoConfig } from './_shared/promo-config.js';

export const config = { runtime: 'nodejs' };

const PUBLIC_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      ...PUBLIC_HEADERS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, PUBLIC_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }

  const db = initAdminDb('promo-config');
  const promoConfig = await getPromoConfig(db);
  res.writeHead(200, PUBLIC_HEADERS);
  return res.end(JSON.stringify({ ok: true, config: promoConfig }));
}
