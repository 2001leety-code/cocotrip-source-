/**
 * CocoTripKR — Track B Trend Cron: VisitKorea attractions meta scanner.
 *
 * 매월 1일 20:00 UTC (= 2일 05:00 KST) 실행. vercel.json crons → cron-runner.js 가
 * dispatch. 월간 갱신.
 *
 * 목적
 *   한국관광공사 (data.go.kr) Tour API 의 관광지 (type 12) meta 수집 → 운영시간 /
 *   입장료 / 외국어 안내 가능 여부 / 위경도 → Firestore 저장. zone_courses
 *   placeholder 채우는 데이터 자산 누적.
 *
 * 환경변수
 *   VISITKORAE_SERVICE_KEY 또는 VISITKOREA_SERVICE_KEY (둘 다 fallback)
 *   data.go.kr 에서 무료 발급. 부재 시 fail-safe skip.
 *
 * Firestore schema
 *   attractions_meta/{contentId} = {
 *     contentId, contentTypeId (12), name (title), region (areaCode→string),
 *     sigungu, address, lat, lng, tel, homepage, overview,
 *     scanned_at, raw: { areaCode, sigunguCode, mapx, mapy }
 *   }
 *
 * API
 *   GET http://apis.data.go.kr/B551011/EngService1/areaBasedList1
 *     serviceKey + numOfRows=100 + pageNo + MobileOS=ETC + MobileApp=cocotrip
 *     + arrange=A (default) + contentTypeId=12 + areaCode (1~39, KR areaCode 표)
 *
 *   ENG endpoint 사용 — 영어 안내 가능 attraction 우선. 한국어 endpoint 는 후속.
 *
 * Region
 *   areaCode 1=Seoul, 6=Busan, 39=Jeju, ... (data.go.kr 표 참조). 11 region.
 *
 * Rate-limit
 *   data.go.kr free 1,000 req/일. region 11 × pageNo ~3 = 33 호출 — 안전.
 *
 * 운영자 manual trigger
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://cocotripkr.com/api/cron-runner?job=scan-visitkorea-attractions"
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { sendErrorAlert } from '../_telegram.js';
import { captureError } from '../_shared/sentry.js';

const VISITKOREA_BASE = 'http://apis.data.go.kr/B551011/EngService1/areaBasedList1';
const FETCH_TIMEOUT_MS = 12000;
const PER_REQUEST_SLEEP_MS = 500;
const NUM_PER_PAGE = 100;
const MAX_PAGES_PER_REGION = 3; // 100 × 3 = 300 attraction/region

// data.go.kr KR areaCode 매핑 (공식 코드 표 일부).
const AREA_MAP = {
  1:  'seoul',
  2:  'incheon',
  3:  'daejeon',
  4:  'daegu',
  5:  'gwangju',
  6:  'busan',
  7:  'ulsan',
  8:  'sejong',
  31: 'gyeonggi',
  32: 'gangwon',
  33: 'chungbuk',
  34: 'chungnam',
  35: 'gyeongbuk',
  36: 'gyeongnam',
  37: 'jeonbuk',
  38: 'jeonnam',
  39: 'jeju',
};
const AREA_CODES = Object.keys(AREA_MAP).map(Number);

// ── 헬퍼 ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 단일 page fetch — areaCode + pageNo. */
async function fetchPage({ serviceKey, areaCode, pageNo }) {
  const url = new URL(VISITKOREA_BASE);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('numOfRows', String(NUM_PER_PAGE));
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('MobileOS', 'ETC');
  url.searchParams.set('MobileApp', 'cocotrip');
  url.searchParams.set('arrange', 'A');
  url.searchParams.set('contentTypeId', '12'); // 관광지
  url.searchParams.set('areaCode', String(areaCode));
  url.searchParams.set('_type', 'json');

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[scan-visitkorea] area=${areaCode} page=${pageNo} HTTP ${res.status}`);
      return { ok: false, items: [], total: 0, error: `http_${res.status}` };
    }
    const data = await res.json();
    // VisitKorea 응답 shape: { response: { header: {...}, body: { items: { item: [...] }, totalCount, ... } } }
    const body = data?.response?.body;
    const total = Number(body?.totalCount || 0);
    const rawItems = body?.items?.item || [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    return { ok: true, items, total };
  } catch (err) {
    console.warn(`[scan-visitkorea] fetch error area=${areaCode} page=${pageNo}: ${err.message}`);
    return { ok: false, items: [], total: 0, error: err.message };
  }
}

async function persistAttraction(db, { item, region, scannedAt }) {
  const contentId = String(item?.contentid || '').trim();
  if (!contentId) return { stored: false, reason: 'no_content_id' };

  const docRef = db.collection('attractions_meta').doc(contentId);
  await docRef.set(
    {
      contentId,
      contentTypeId: 12,
      name: String(item.title || '').slice(0, 300),
      region,
      sigungu: String(item.sigungucode || ''),
      address: String(item.addr1 || '').slice(0, 500),
      address2: String(item.addr2 || '').slice(0, 200),
      lat: item.mapy ? Number(item.mapy) : null,
      lng: item.mapx ? Number(item.mapx) : null,
      tel: String(item.tel || '').slice(0, 100),
      firstimage: String(item.firstimage || '').slice(0, 500),
      scanned_at: scannedAt,
      raw: {
        areaCode: String(item.areacode || ''),
        sigunguCode: String(item.sigungucode || ''),
        mapx: item.mapx ? Number(item.mapx) : null,
        mapy: item.mapy ? Number(item.mapy) : null,
        cat1: String(item.cat1 || ''),
        cat2: String(item.cat2 || ''),
        cat3: String(item.cat3 || ''),
      },
    },
    { merge: true }
  );
  return { stored: true };
}

// ── Vercel handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // data.go.kr key 는 운영자 발급 환경마다 변수명 표기가 흔들리니 둘 다 허용.
  const serviceKey =
    (process.env.VISITKOREA_SERVICE_KEY || process.env.VISITKORAE_SERVICE_KEY || '').trim();
  if (!serviceKey) {
    console.warn('[scan-visitkorea] VISITKOREA_SERVICE_KEY missing — skipping');
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'api_key_missing',
      hint: 'Set VISITKOREA_SERVICE_KEY (data.go.kr — 한국관광공사 TourAPI).',
    });
  }

  const db = initAdminDb('cron/scan-visitkorea-attractions');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[scan-visitkorea]', msg);
    try { await sendErrorAlert('scan-visitkorea-attractions', new Error(msg)); } catch {}
    return res.status(503).json({ ok: false, error: msg });
  }

  const scannedAt = new Date().toISOString();
  const perRegion = [];
  let totalStored = 0;
  let totalFetched = 0;
  let totalErrors = 0;

  try {
    for (const areaCode of AREA_CODES) {
      const region = AREA_MAP[areaCode];
      let stored = 0;
      let fetched = 0;
      for (let pageNo = 1; pageNo <= MAX_PAGES_PER_REGION; pageNo++) {
        const r = await fetchPage({ serviceKey, areaCode, pageNo });
        if (!r.ok) {
          totalErrors += 1;
          await sleep(PER_REQUEST_SLEEP_MS);
          break;
        }
        fetched += r.items.length;
        for (const item of r.items) {
          try {
            const persisted = await persistAttraction(db, { item, region, scannedAt });
            if (persisted.stored) stored += 1;
          } catch (err) {
            totalErrors += 1;
            console.warn(`[scan-visitkorea] persist error area=${areaCode} content=${item?.contentid}: ${err.message}`);
          }
        }
        await sleep(PER_REQUEST_SLEEP_MS);
        if (r.items.length < NUM_PER_PAGE) break; // 다음 page 없음
      }
      perRegion.push({ region, areaCode, fetched, stored });
      totalFetched += fetched;
      totalStored += stored;
    }

    console.log(
      `[scan-visitkorea] done: areas=${AREA_CODES.length} fetched=${totalFetched} stored=${totalStored} errors=${totalErrors}`
    );
    return res.status(200).json({
      ok: true,
      scannedAt,
      areas: AREA_CODES.length,
      fetched: totalFetched,
      stored: totalStored,
      errors: totalErrors,
      perRegion,
    });
  } catch (err) {
    console.error('[scan-visitkorea] handler error:', err.message);
    try { await sendErrorAlert('scan-visitkorea-attractions', err); } catch {}
    await captureError(err, { route: 'cron/scan-visitkorea-attractions' });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
