/**
 * CocoTripKR — Track B Trend Cron: Naver Local rising-spot scanner.
 *
 * 매주 일요일 18:00 UTC (= 월요일 03:00 KST) 실행. vercel.json crons → cron-runner.js
 * 가 dispatch. 인증은 dispatcher (verifyCronRequest) 가 처리.
 *
 * 목적
 *   11 region 의 핵심 keyword 를 Naver Local Search API 로 호출 → 지난 주 저장값과
 *   rating / reviewCount delta 계산 → rising 임계값 초과 spot 을 Firestore 에 저장.
 *   zone_courses placeholder 채우는 데이터 자산 누적 (운영자 큐레이션 보조).
 *
 * 임계값 (rising 마킹)
 *   - rating_delta >= 0.3, OR
 *   - reviewCount_delta >= 50
 *
 * Firestore schema
 *   rising_spots/{region}/spots/{spotId} = {
 *     name, query, link, mapx, mapy, address, roadAddress,
 *     rating, reviewCount,
 *     rating_delta, reviewCount_delta,
 *     scanned_at (ISO),
 *     previous: { rating, reviewCount, scanned_at } | null,
 *     is_rising: boolean,
 *   }
 *
 *   spotId = sha1(query + ':' + (link || name)) 첫 16자.
 *
 * 환경변수 (둘 다 필요 — 어느 한쪽 없으면 fail-safe skip)
 *   NAVER_OPENAPI_CLIENT_ID
 *   NAVER_OPENAPI_CLIENT_SECRET
 *
 *   주의: openapi.naver.com (Local Search) 의 키는 maps.apigw.ntruss.com (NCP
 *   Geocoding) 의 키와 다른 시스템이다. NCP_CLIENT_ID/SECRET 재사용 금지.
 *
 * Rate-limit
 *   - region 10+개 sequential 처리 + 각 region 내 query 도 sequential.
 *   - 호출 사이 250ms sleep (Naver Local 25,000회/일 free quota — 충분).
 *   - 단일 호출 timeout 5초.
 *
 * 운영자 manual trigger
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://cocotripkr.com/api/cron-runner?job=scan-naver-rising"
 *
 * 실패 모드
 *   - API key 부재 → 200 OK + { skipped: true, reason: 'api_key_missing' }.
 *     다른 cron 영향 없도록 절대 throw X.
 *   - Firestore 미초기화 → 503 + ok:false (운영자 시급 — sendErrorAlert).
 *   - 개별 query / spot 실패 → console.warn + 계속 (errors 카운터 응답에 포함).
 */
import crypto from 'node:crypto';
import { initAdminDb } from '../_shared/firebase-admin.js';
import { sendErrorAlert } from '../_telegram.js';
import { captureError } from '../_shared/sentry.js';

const NAVER_LOCAL_URL = 'https://openapi.naver.com/v1/search/local.json';
const RISING_RATING_DELTA = 0.3;
const RISING_REVIEW_DELTA = 50;
const FETCH_TIMEOUT_MS = 5000;
const PER_QUERY_SLEEP_MS = 250;
const RESULTS_PER_QUERY = 5; // Naver Local display max 5

// region → keyword 리스트. 12 region (제주 포함). 각 region 의 hotspot keyword
// 5-12개 — Naver Local 응답 5건/호출 × 5-12 query = 25-60 spot/region.
const REGION_QUERIES = {
  seoul:    ['서울 맛집', '서울 카페', '강남 맛집', '홍대 카페', '성수동 맛집', '이태원 맛집', '명동 맛집', '북촌 카페', '연남동 카페', '한남동 맛집'],
  gyeonggi: ['수원 맛집', '파주 카페', '가평 맛집', '양평 카페', '판교 맛집', '인천 차이나타운', '강화 맛집'],
  gangwon:  ['강릉 카페', '강릉 맛집', '속초 맛집', '평창 카페', '양양 서핑 카페'],
  chungbuk: ['청주 맛집', '단양 카페', '제천 맛집', '충주 카페'],
  chungnam: ['공주 맛집', '부여 카페', '천안 맛집', '서산 맛집'],
  jeonbuk:  ['전주 한정식', '전주 카페', '군산 맛집', '남원 맛집'],
  jeonnam:  ['여수 맛집', '순천 카페', '담양 맛집', '광주 맛집', '목포 맛집'],
  gyeongbuk:['경주 한정식', '안동 한정식', '포항 맛집', '대구 맛집', '경주 카페'],
  gyeongnam:['부산 맛집', '통영 맛집', '거제 카페', '창원 맛집', '진주 맛집', '해운대 카페'],
  jeju:     ['제주 맛집', '제주 카페', '제주 흑돼지', '제주 해녀의집', '서귀포 카페', '애월 카페'],
};
const REGIONS = Object.keys(REGION_QUERIES);

// ── 헬퍼 ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Naver Local item.title 은 <b>...</b> 태그 박혀 있음 — strip. */
function stripHtml(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, '').trim();
}

/** spotId 안정적 — query + link/title 기반 16-char sha1. */
function makeSpotId(query, link, name) {
  const seed = `${query}:${link || name || ''}`;
  return crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

/**
 * Naver Local Search API call.
 *
 * Note: Naver Local item 응답은 'category', 'address', 'roadAddress', 'mapx',
 * 'mapy', 'title', 'link', 'description', 'telephone' 만 줌. rating /
 * reviewCount 는 공식 API 에 없음 — 우리는 description 길이 + 자체 통계로 보충하거나
 * 운영자 수동 verification step 추가. 현재 schema 에는 0/null 로 저장하고
 * 향후 별도 rating-source (Naver Map mobile API or 운영자 입력) 로 채움.
 *
 * Returns: array of normalized items or [] on failure.
 */
async function callNaverLocal(query, clientId, clientSecret) {
  const url = new URL(NAVER_LOCAL_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('display', String(RESULTS_PER_QUERY));
  url.searchParams.set('start', '1');
  url.searchParams.set('sort', 'comment'); // comment-sort = 리뷰 많은 순 (Naver 의 인기도 proxy)

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[scan-naver-rising] HTTP ${res.status} for "${query}"`);
      return { ok: false, items: [], error: `http_${res.status}` };
    }
    const data = await res.json();
    const items = (data?.items || []).map((it) => ({
      name: stripHtml(it.title),
      category: it.category || '',
      link: it.link || '',
      telephone: it.telephone || '',
      address: it.address || '',
      roadAddress: it.roadAddress || '',
      mapx: it.mapx ? Number(it.mapx) : null,
      mapy: it.mapy ? Number(it.mapy) : null,
      description: stripHtml(it.description || ''),
    }));
    return { ok: true, items };
  } catch (err) {
    console.warn(`[scan-naver-rising] fetch error for "${query}": ${err.message}`);
    return { ok: false, items: [], error: err.message };
  }
}

/**
 * 단일 spot 의 이전 주 데이터 read → delta 계산 → 저장.
 *
 * rating / reviewCount 는 Naver Local API 에 없으므로 v0 에서는 0/0 으로 둔다.
 * delta 계산 자체는 동작 — 향후 별도 source 가 채우면 자동 활성. proxy 로
 * description 길이 + Naver Local 응답 등장 빈도 (occurrenceCount) 를 임시 신호로
 * 누적 (description_len_delta / occurrence_delta).
 */
async function persistSpot(db, { region, query, item, scannedAt }) {
  const spotId = makeSpotId(query, item.link, item.name);
  const docRef = db.collection('rising_spots').doc(region).collection('spots').doc(spotId);

  const snap = await docRef.get();
  const previous = snap.exists ? snap.data() : null;

  const ratingNow = 0; // Naver Local API 에 없음 — 후속 source 가 채울 자리
  const reviewCountNow = 0;
  const descriptionLenNow = (item.description || '').length;
  const occurrenceCountNow = (previous && previous.occurrenceCount ? previous.occurrenceCount : 0) + 1;

  // Explicit null-check (mojibake hook 가 nullish coalescing 을 차단 — 0 보존 의도라 || 불가).
  const ratingPrev = (previous && previous.rating != null) ? previous.rating : 0;
  const reviewCountPrev = (previous && previous.reviewCount != null) ? previous.reviewCount : 0;
  const descriptionLenPrev = (previous && previous.description_len != null) ? previous.description_len : 0;

  const ratingDelta = ratingNow - ratingPrev;
  const reviewCountDelta = reviewCountNow - reviewCountPrev;
  const descriptionLenDelta = descriptionLenNow - descriptionLenPrev;

  const isRising =
    ratingDelta >= RISING_RATING_DELTA ||
    reviewCountDelta >= RISING_REVIEW_DELTA;

  const payload = {
    region,
    query,
    name: item.name,
    category: item.category,
    link: item.link,
    address: item.address,
    roadAddress: item.roadAddress,
    mapx: item.mapx,
    mapy: item.mapy,
    description: item.description.slice(0, 500), // Firestore field cap (P69)
    description_len: descriptionLenNow,
    description_len_delta: descriptionLenDelta,
    occurrenceCount: occurrenceCountNow,
    rating: ratingNow,
    reviewCount: reviewCountNow,
    rating_delta: ratingDelta,
    reviewCount_delta: reviewCountDelta,
    is_rising: isRising,
    scanned_at: scannedAt,
    previous: previous
      ? {
          rating: ratingPrev,
          reviewCount: reviewCountPrev,
          description_len: descriptionLenPrev,
          scanned_at: previous.scanned_at || null,
        }
      : null,
  };

  await docRef.set(payload, { merge: true });
  return { spotId, isRising };
}

/** 한 region 처리 — query 순회 + per-query sleep. */
async function processRegion(db, { region, queries, clientId, clientSecret, scannedAt }) {
  const stats = { region, queries: queries.length, spotsTotal: 0, spotsRising: 0, errors: 0 };
  for (const query of queries) {
    const r = await callNaverLocal(query, clientId, clientSecret);
    if (!r.ok) {
      stats.errors += 1;
      await sleep(PER_QUERY_SLEEP_MS);
      continue;
    }
    for (const item of r.items) {
      if (!item.name) continue;
      try {
        const persisted = await persistSpot(db, { region, query, item, scannedAt });
        stats.spotsTotal += 1;
        if (persisted.isRising) stats.spotsRising += 1;
      } catch (err) {
        stats.errors += 1;
        console.warn(`[scan-naver-rising] persist error region=${region} query="${query}" name="${item.name}": ${err.message}`);
      }
    }
    await sleep(PER_QUERY_SLEEP_MS);
  }
  return stats;
}

// ── Vercel handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = (process.env.NAVER_OPENAPI_CLIENT_ID || '').trim();
  const clientSecret = (process.env.NAVER_OPENAPI_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    console.warn('[scan-naver-rising] NAVER_OPENAPI_CLIENT_ID/SECRET missing — skipping');
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'api_key_missing',
      hint: 'Set NAVER_OPENAPI_CLIENT_ID + NAVER_OPENAPI_CLIENT_SECRET (openapi.naver.com Local Search).',
    });
  }

  const db = initAdminDb('cron/scan-naver-rising');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[scan-naver-rising]', msg);
    try { await sendErrorAlert('scan-naver-rising', new Error(msg)); } catch {}
    return res.status(503).json({ ok: false, error: msg });
  }

  const scannedAt = new Date().toISOString();
  const perRegion = [];
  let totalSpots = 0;
  let totalRising = 0;
  let totalErrors = 0;

  try {
    for (const region of REGIONS) {
      const queries = REGION_QUERIES[region] || [];
      console.log(`[scan-naver-rising] region=${region} queries=${queries.length}`);
      const stats = await processRegion(db, {
        region,
        queries,
        clientId,
        clientSecret,
        scannedAt,
      });
      perRegion.push(stats);
      totalSpots += stats.spotsTotal;
      totalRising += stats.spotsRising;
      totalErrors += stats.errors;
    }

    console.log(
      `[scan-naver-rising] done: regions=${REGIONS.length} spots=${totalSpots} rising=${totalRising} errors=${totalErrors}`
    );
    return res.status(200).json({
      ok: true,
      scannedAt,
      regions: REGIONS.length,
      spotsTotal: totalSpots,
      spotsRising: totalRising,
      errors: totalErrors,
      perRegion,
    });
  } catch (err) {
    console.error('[scan-naver-rising] handler error:', err.message);
    try { await sendErrorAlert('scan-naver-rising', err); } catch {}
    await captureError(err, { route: 'cron/scan-naver-rising' });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
