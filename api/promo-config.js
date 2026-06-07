/**
 * GET /api/promo-config — 배너 + 팝업 설정 공개 읽기 (인증 불필요).
 *
 * 프론트엔드 PromoBanner.tsx / PromoPopup.tsx 가 마운트 시 호출.
 * 표시값만 반환: { banner: {...}, popup: {...} }
 * 에러 / Firestore 없으면 DEFAULT 반환 (배너/팝업 항상 안전 보장).
 *
 * 하위 호환: PromoBanner.tsx 는 json.config.banner 를 읽도록 업데이트됨.
 *
 * 보안:
 *   - GET만 (쓰기 불가). 표시값 외 내부 데이터 미노출.
 *   - CORS: 공개 wildcard — 파트너 임베드 지원.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { getPromoConfig, getPopupConfig } from './_shared/promo-config.js';

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
  // 배너 + 팝업 병렬 조회 (독립적, 한쪽 실패해도 다른 쪽 영향 없음)
  const [banner, popup] = await Promise.all([
    getPromoConfig(db),
    getPopupConfig(db),
  ]);
  res.writeHead(200, PUBLIC_HEADERS);
  // { banner, popup } 구조로 반환. PromoBanner/PromoPopup 모두 각 키 읽음.
  return res.end(JSON.stringify({ ok: true, banner, popup }));
}
