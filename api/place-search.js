/**
 * GET /api/place-search?query=롯데호텔&limit=10&lang=en
 *
 * Naver Local Search API proxy — 사용자 자유 입력 → 비즈니스/장소 후보 반환.
 * 사용처: src/components/charter/AddressAutocomplete.tsx — 차터 위저드의 출발/도착 주소 자동완성.
 *
 * 정확도 우선 — Naver Local Search 는 한국 비즈니스 색인이 가장 풍부하다 (구글/카카오 대비).
 * 응답 좌표: 현행 API 는 WGS84 × 1e7 정수, 구형은 TM128 (KATEC) × 10 —
 * naverCoordToWgs84 가 포맷을 감지해 WGS84 (lat/lng) 로 변환해서 전달한다.
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
 * "모두 시도"는 요청 레벨: 앞 순위 키가 등록돼 있어도 Naver 가 401/403 으로
 * 거부하면 (만료·앱 삭제) 다음 키쌍으로 재시도한다. 성공한 키쌍은 module scope
 * 에 기억해 cold start 후 첫 요청만 폴백 비용을 낸다.
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

import { initAdminDb } from './_shared/firebase-admin.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { stripTags, naverCoordToWgs84, resolveCredentialCandidates, searchWithCredentialFallback } from './_shared/naverLocalSearch.js';
const _rateDb = initAdminDb('place-search');

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// 2026-11-16: 장소 검색 도우미는 공용 모듈(_shared/naverLocalSearch.js)로 옮겼다 — 예전 이름 그대로 다시 내보낸다.
export { naverCoordToWgs84, resolveCredentialCandidates, searchWithCredentialFallback };

// 마지막으로 성공한 키쌍 source — warm instance 는 죽은 앞순위 키를 건너뛴다.
let lastGoodSource = null;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
  }

  // 비용 DoS: 무인증 + Naver Local Search(호출당 비용). per-IP 시간당 30건. db 없으면 fail-open.
  const _rate = await checkIpRateLimit({ db: _rateDb, ip: getClientIp(req), collection: 'place_search_rate_limits', maxRequests: 30, errorLabel: 'searches' });
  if (!_rate.ok) {
    res.writeHead(_rate.status, { ...JSON_CORS, 'Retry-After': String(_rate.retryAfterSec) });
    return res.end(JSON.stringify({ error: _rate.error, code: 'RATE_LIMITED' }));
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

  const candidates = resolveCredentialCandidates();
  if (!candidates.length) {
    console.error('[place-search] no credentials — checked NAVER_LOCAL_SEARCH_*, NAVER_DEVELOPERS_*, NAVER_CLIENT_*, NCP_CLIENT_*');
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify({ error: 'CREDENTIALS_NOT_CONFIGURED' }));
  }

  // ── Naver Local Search API ──────────────────────────────────────────────
  // https://openapi.naver.com/v1/search/local.json
  // 파라미터: query (필수), display (1-30, 기본 5), sort=random|comment
  const url = 'https://openapi.naver.com/v1/search/local.json';
  try {
    const doRequest = (creds) => axios.get(url, {
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

    const { upstream, source, rejected } = await searchWithCredentialFallback(candidates, doRequest, lastGoodSource);
    for (const r of rejected) {
      console.error(`[place-search] auth error ${r.status} from ${r.source} — trying next key pair:`, r.data);
    }

    if (!upstream) {
      res.writeHead(401, JSON_CORS);
      return res.end(JSON.stringify({
        error: 'AUTH_FAILED',
        detail: `${rejected.map((r) => r.source).join(', ')} all rejected — check Naver Developers Local Search key registration`,
      }));
    }

    if (source !== lastGoodSource) {
      // 운영자가 로그에서 살아있는 키 / 죽은 키를 식별할 수 있도록 남긴다.
      console.log(`[place-search] source=${source}${rejected.length ? ` (fell back past: ${rejected.map((r) => r.source).join(', ')})` : ''}`);
      lastGoodSource = source;
    }

    if (upstream.status !== 200) {
      console.error(`[place-search] upstream ${upstream.status}:`, upstream.data);
      res.writeHead(502, JSON_CORS);
      return res.end(JSON.stringify({ error: 'UPSTREAM_ERROR', status: upstream.status }));
    }

    const items = Array.isArray(upstream.data?.items) ? upstream.data.items : [];
    const rawOut = [];
    for (const it of items) {
      const coord = naverCoordToWgs84(it.mapx, it.mapy);
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
