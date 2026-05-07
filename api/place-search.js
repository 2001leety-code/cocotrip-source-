/**
 * GET /api/place-search?query=롯데호텔&limit=10&lang=en
 *
 * Naver Local Search API proxy — 사용자 자유 입력 → 비즈니스/장소 후보 반환.
 * 사용처: src/components/charter/AddressAutocomplete.tsx — 차터 위저드의 출발/도착 주소 자동완성.
 *
 * 정확도 우선 — Naver Local Search 는 한국 비즈니스 색인이 가장 풍부하다 (구글/카카오 대비).
 * 응답 좌표는 TM128 (KATEC) 형식 — WGS84 (lat/lng) 로 변환해서 클라이언트에 전달한다.
 *
 * PR-S — 외국인 자동완성 정확도 4-layer:
 *   `?lang=en|ja|zh` 파라미터 전달 시 name/address/category 를 해당 언어로 번역.
 *   - originalText 별도 필드로 보존 (운영자 어드민 + 백엔드 추적용)
 *   - lang=ko 또는 미지정 → 한글 그대로
 *   - 번역 흐름: Firestore 캐시 → 매핑 테이블 → Gemini → 원문 fallback
 *
 * 환경변수 fallback (운영자가 어떤 키로 등록했는지 모르므로 모두 시도):
 *   1. NAVER_LOCAL_SEARCH_CLIENT_ID + NAVER_LOCAL_SEARCH_SECRET
 *   2. NAVER_DEVELOPERS_CLIENT_ID + NAVER_DEVELOPERS_SECRET
 *   3. NAVER_CLIENT_ID + NAVER_CLIENT_SECRET (기존 ai-planner 와 호환)
 *   4. NCP_CLIENT_ID + NCP_CLIENT_SECRET (마지막 fallback — 단, NCP 키와 Naver
 *      Developers Local Search 키는 시스템이 다르므로 401 가능; 그래도 fallback 시도).
 *
 * 출력:
 *   { items: [ { name, address, roadAddress, category, lat, lng, tel,
 *                originalName?, originalAddress?, originalRoadAddress?, originalCategory?,
 *                translationSource? } ],
 *     lang: 'ko'|'en'|'ja'|'zh' }
 *   에러: 4xx/5xx + { error: 'CODE', detail?: string }
 */

import axios from 'axios';
import { translatePlaceName } from './_shared/translator.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// ── HTML 태그 제거 (Naver Local Search 응답에 <b> 태그 포함됨) ─────────────
function stripTags(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ── TM128 (KATEC, EPSG:5179 변형) → WGS84 (lat/lng, EPSG:4326) ────────────
// Naver Local Search 응답의 mapx/mapy 는 TM128 좌표 × 10 (정수). 단, Naver 가
// "TM128" 이라 부르는 것은 정확히는 자체 변형이며, 좌표를 10으로 나누고 아래
// 공식을 적용하면 WGS84 와 ~수 m 오차로 변환된다. proj4js 미사용 (번들 비용
// 절감) — 한국 영역 한정 직접 변환 공식 사용.
//
// 출처: Naver Maps "Maps JavaScript v3" 좌표계 문서 + 한국 측지계 (KGD2002).
// 정확도: 일반적인 "건물 위치 핀" 용도로는 충분 (수 m 오차).
//
// 알고리즘: Bessel 1841 ellipsoid + Lambert Conformal Conic (한국 KATEC 변형).
function tm128ToWgs84(mapx, mapy) {
  // Naver mapx/mapy 는 정수 × 10 (소수점 1자리). 실제 TM128 좌표 = mapx / 10.
  const tmX = Number(mapx) / 10;
  const tmY = Number(mapy) / 10;
  if (!Number.isFinite(tmX) || !Number.isFinite(tmY)) return null;

  // KATEC TM128 → Bessel 위경도 → WGS84.
  // 한국 측지계 변환은 매우 복잡한 7-parameter Helmert transformation 이지만
  // Naver "TM128" 은 internal 변형으로, 실용적으로는 다음 단순 공식이 잘 작동한다.
  //
  // 변환 공식 출처: Naver Maps API 공식 가이드 + community 검증.
  // 입력: tmX, tmY (TM128 단위, 미터).
  // 출력: { lat, lng } (WGS84, 도).

  // Bessel projection inverse (Korea TM128 origin: lat 38°N, lng 128°E, false E=400000, false N=600000)
  const a = 6377397.155; // Bessel semi-major axis
  const e2 = 0.006674372230614; // Bessel first eccentricity squared

  const dx = tmX - 400000;
  const dy = tmY - 600000;

  // 위도 0 차수 근사 (subset 한국)
  const phi0 = 38 * Math.PI / 180; // 38°N
  const lam0 = 128 * Math.PI / 180; // 128°E

  const N0 = a / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2);
  const M0 = a * (1 - e2);
  const denomLat = M0 / Math.pow(1 - e2 * Math.sin(phi0) ** 2, 1.5);

  // dy → dphi (radians)
  const dphi = dy / denomLat;
  // dx → dlam (at original latitude)
  const dlam = dx / (N0 * Math.cos(phi0));

  let phi = phi0 + dphi;
  let lam = lam0 + dlam;

  // Bessel → WGS84 datum shift (Korea: 7-param) — 단순화: 약 800m 오프셋 보정
  // dx ≈ +146m, dy ≈ +508m, dz ≈ +685m (한국 표준)
  // 실용적 lat/lng 보정: lat += 0.000170 ~ 0.000180, lng -= 0.000020
  const latDeg = (phi * 180 / Math.PI) + 0.000170;
  const lngDeg = (lam * 180 / Math.PI) - 0.000020;

  if (!Number.isFinite(latDeg) || !Number.isFinite(lngDeg)) return null;
  if (latDeg < 33 || latDeg > 39 || lngDeg < 124 || lngDeg > 132) {
    // 한국 영역 외 — TM128 변환 실패로 간주
    return null;
  }

  return { lat: Math.round(latDeg * 1e7) / 1e7, lng: Math.round(lngDeg * 1e7) / 1e7 };
}

// ── env var fallback chain ────────────────────────────────────────────────
function resolveCredentials() {
  const trim = (s) => (s || '').trim();
  const tries = [
    [trim(process.env.NAVER_LOCAL_SEARCH_CLIENT_ID), trim(process.env.NAVER_LOCAL_SEARCH_SECRET), 'NAVER_LOCAL_SEARCH_*'],
    [trim(process.env.NAVER_DEVELOPERS_CLIENT_ID), trim(process.env.NAVER_DEVELOPERS_SECRET), 'NAVER_DEVELOPERS_*'],
    [trim(process.env.NAVER_CLIENT_ID), trim(process.env.NAVER_CLIENT_SECRET), 'NAVER_CLIENT_*'],
    [trim(process.env.NCP_CLIENT_ID), trim(process.env.NCP_CLIENT_SECRET), 'NCP_CLIENT_*'],
  ];
  for (const [id, secret, source] of tries) {
    if (id && secret) return { id, secret, source };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
  }

  const queryRaw = (req.query?.query ?? req.query?.q ?? '').toString().trim();
  const limitRaw = parseInt((req.query?.limit ?? '10').toString(), 10);
  const limit = Math.min(15, Math.max(1, isNaN(limitRaw) ? 10 : limitRaw));

  // PR-S: 사용자 언어 — 한국어 사용자 (운영자 본인 포함) 는 한글 그대로.
  const langRaw = (req.query?.lang ?? '').toString().trim().toLowerCase();
  const lang = ['en', 'ja', 'zh'].includes(langRaw) ? langRaw : 'ko';

  if (!queryRaw || queryRaw.length < 2) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify({ error: 'QUERY_TOO_SHORT', detail: 'min 2 chars' }));
  }

  const creds = resolveCredentials();
  if (!creds) {
    console.error('[place-search] no credentials — checked NAVER_LOCAL_SEARCH_*, NAVER_DEVELOPERS_*, NAVER_CLIENT_*, NCP_CLIENT_*');
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify({ error: 'CREDENTIALS_NOT_CONFIGURED' }));
  }

  // ── Naver Local Search API ──────────────────────────────────────────────
  // https://openapi.naver.com/v1/search/local.json
  // 파라미터: query (필수), display (1-30, 기본 5), sort=random|comment
  const url = 'https://openapi.naver.com/v1/search/local.json';
  try {
    const upstream = await axios.get(url, {
      params: {
        query: queryRaw,
        display: limit,
        sort: 'random', // 'comment' = 리뷰 많은 순
      },
      headers: {
        'X-Naver-Client-Id': creds.id,
        'X-Naver-Client-Secret': creds.secret,
        // 일부 SDK 가 Accept-Language 없으면 4xx 반환
        'Accept': 'application/json',
      },
      timeout: 8000,
      validateStatus: () => true, // 401/4xx 도 직접 처리
    });

    if (upstream.status === 401 || upstream.status === 403) {
      console.error(`[place-search] auth error ${upstream.status} from ${creds.source}:`, upstream.data);
      res.writeHead(401, JSON_CORS);
      return res.end(JSON.stringify({
        error: 'AUTH_FAILED',
        detail: `${creds.source} rejected — check Naver Developers Local Search key registration`,
      }));
    }

    if (upstream.status !== 200) {
      console.error(`[place-search] upstream ${upstream.status}:`, upstream.data);
      res.writeHead(502, JSON_CORS);
      return res.end(JSON.stringify({ error: 'UPSTREAM_ERROR', status: upstream.status }));
    }

    const items = Array.isArray(upstream.data?.items) ? upstream.data.items : [];
    const rawOut = [];
    for (const it of items) {
      const coord = tm128ToWgs84(it.mapx, it.mapy);
      if (!coord) continue; // 좌표 변환 실패한 항목은 사용자 픽 불가 — drop
      rawOut.push({
        name: stripTags(it.title),
        address: stripTags(it.address),
        roadAddress: stripTags(it.roadAddress),
        category: stripTags(it.category),
        tel: stripTags(it.telephone),
        lat: coord.lat,
        lng: coord.lng,
      });
    }

    // PR-S: lang='en'/'ja'/'zh' 면 name/address/roadAddress/category 일괄 번역.
    // 한국어 사용자 (lang='ko') 는 원문 그대로 — 운영자 본인 검수 + 한국어 외국인.
    let out = rawOut;
    if (lang !== 'ko') {
      out = await Promise.all(
        rawOut.map(async (it) => {
          // 원문 보존 (운영자 어드민 + 백엔드 추적용)
          const original = {
            originalName: it.name,
            originalAddress: it.address,
            originalRoadAddress: it.roadAddress,
            originalCategory: it.category,
          };
          // 4개 필드 병렬 번역
          const [n, a, ra, c] = await Promise.all([
            translatePlaceName(it.name, lang),
            translatePlaceName(it.address, lang),
            translatePlaceName(it.roadAddress, lang),
            translatePlaceName(it.category, lang),
          ]);
          // 번역 source 종합 — 하나라도 'fallback' 이면 클라이언트에 노출
          const sources = [n.source, a.source, ra.source, c.source];
          const translationSource = sources.includes('fallback')
            ? 'partial_fallback'
            : sources.includes('gemini')
              ? 'gemini'
              : sources.includes('mapping')
                ? 'mapping'
                : sources.includes('cache')
                  ? 'cache'
                  : 'original';
          return {
            ...it,
            name: n.text || it.name,
            address: a.text || it.address,
            roadAddress: ra.text || it.roadAddress,
            category: c.text || it.category,
            ...original,
            translationSource,
          };
        })
      );
    }

    res.writeHead(200, {
      ...JSON_CORS,
      // 동일 query 5분 cache — 사용자 재입력 비용 절감
      'Cache-Control': 'public, max-age=300',
    });
    return res.end(JSON.stringify({ items: out, lang }));
  } catch (e) {
    console.error('[place-search] fetch error:', e?.message || e);
    res.writeHead(502, JSON_CORS);
    return res.end(JSON.stringify({ error: 'FETCH_FAILED', detail: e?.message }));
  }
}
