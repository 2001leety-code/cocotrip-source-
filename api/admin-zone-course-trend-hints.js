/**
 * Vercel API Route: Admin Zone-Course Trend Hints (Track C, 2026-05-21)
 *
 * GET /api/admin-zone-course-trend-hints?city=seoul&zone=Jongno
 * Headers: Authorization: Bearer <Firebase-ID-token>  (admin only)
 *
 * Returns:
 *   {
 *     ok: true,
 *     data: {
 *       rising:    RisingSpotHint[]  (top 10 by rating_delta desc)
 *       painpoints PainpointHint[]   (top 5 by score desc, city tag matched)
 *       notices:   string[]          (collection missing / partial fail 안내)
 *     }
 *   }
 *
 * Firestore sources:
 *   rising_spots/{region}/spots/{spotId}   ← Track B (PR #511)
 *   user_painpoints/{painpointId}          ← Track B (PR #511)
 *
 * Track B cron 결과가 아직 없거나 컬렉션 자체가 없을 수도 있음 (PR #511 머지
 * 전 / 첫 cron 실행 전). 그런 경우 빈 배열 + notices 로 안내 (silent fail 금지).
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { wrapHandler, captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

const ALLOWED_CITIES = new Set([
  'seoul', 'busan', 'jeju', 'gyeongju', 'jeonju',
  'gangneung', 'sokcho', 'andong', 'suwon',
  'incheon', 'daegu', 'gwangju', 'daejeon', 'ulsan',
]);

async function fetchRising(db, city, notices) {
  try {
    // rising_spots/{region}/spots/{spotId} — Track B (PR #511) schema
    const snap = await db
      .collection('rising_spots')
      .doc(city)
      .collection('spots')
      .orderBy('rating_delta', 'desc')
      .limit(10)
      .get();

    if (snap.empty) {
      // Try reviewCount_delta 정렬 fallback
      try {
        const altSnap = await db
          .collection('rising_spots')
          .doc(city)
          .collection('spots')
          .orderBy('reviewCount_delta', 'desc')
          .limit(10)
          .get();
        if (altSnap.empty) return [];
        return altSnap.docs.map((d) => ({ spotId: d.id, ...d.data() }));
      } catch {
        return [];
      }
    }
    return snap.docs.map((d) => ({ spotId: d.id, ...d.data() }));
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('NOT_FOUND') || msg.includes('Missing or insufficient permissions')) {
      notices.push(`rising_spots 컬렉션 미생성 — Track B trend cron (PR #511) 머지 + 첫 실행 후 노출.`);
      return [];
    }
    if (msg.toLowerCase().includes('index')) {
      notices.push(`rising_spots 인덱스 빌드 중 — Firestore 인덱스 deploy 권장.`);
      return [];
    }
    notices.push(`rising_spots fetch 실패: ${msg}`);
    return [];
  }
}

async function fetchPainpoints(db, city, notices) {
  try {
    // user_painpoints/{painpointId} — Track B schema (detected_regions[] = ['seoul', ...])
    // Firestore 'array-contains' + orderBy(score desc) → 인덱스 필요.
    const snap = await db
      .collection('user_painpoints')
      .where('detected_regions', 'array-contains', city)
      .orderBy('score', 'desc')
      .limit(5)
      .get();

    if (snap.empty) return [];
    return snap.docs.map((d) => ({ reddit_post_id: d.id, ...d.data() }));
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('NOT_FOUND') || msg.includes('Missing or insufficient permissions')) {
      notices.push(`user_painpoints 컬렉션 미생성 — Track B Reddit cron (PR #511) 머지 + 첫 실행 후 노출.`);
      return [];
    }
    if (msg.toLowerCase().includes('index')) {
      notices.push(`user_painpoints 인덱스 빌드 중 — (detected_regions array-contains + score desc) 인덱스 deploy 권장.`);
      return [];
    }
    notices.push(`user_painpoints fetch 실패: ${msg}`);
    return [];
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }
  if (req.method !== 'GET') {
    return json(req, res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });
  }

  const city = String(req.query?.city || '').toLowerCase().trim();
  if (!city || !ALLOWED_CITIES.has(city)) {
    return json(req, res, 400, {
      ok: false,
      error: `city 파라미터 필요 (${[...ALLOWED_CITIES].join(', ')})`,
      code: 'INVALID_CITY',
    });
  }

  const db = initAdminDb('admin-zone-course-trend-hints');
  if (!db) {
    return json(req, res, 500, {
      ok: false,
      error: 'Firestore unavailable — FIREBASE_* env vars 확인 필요',
      code: 'FIRESTORE_UNAVAILABLE',
    });
  }

  const notices = [];

  try {
    const [rising, painpoints] = await Promise.all([
      fetchRising(db, city, notices),
      fetchPainpoints(db, city, notices),
    ]);
    return json(req, res, 200, {
      ok: true,
      data: { rising, painpoints, notices },
    });
  } catch (err) {
    await captureError(err, { route: '/api/admin-zone-course-trend-hints', city });
    return json(req, res, 500, {
      ok: false,
      error: err?.message || 'Unexpected error',
      code: 'TREND_HINTS_FAILED',
    });
  }
}

export default wrapHandler(handler);
