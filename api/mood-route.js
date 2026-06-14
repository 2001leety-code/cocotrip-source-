/**
 * GET /api/mood-route?origin=&destination=&waypoints=A|B — MOOD 경로 견적
 *
 * MOOD 포털 직원이 예약 전 출발지→목적지(경유지 선택) 의 실제 도로 거리(km)·톨비·
 * 소요시간을 미리 본다. 프론트는 이 km/tollKRW 로 예상 금액(표시용) 을 계산.
 *
 * 🔴 표시 전용: 실제 청구는 api/mood-book.js 가 동일 origin/destination 으로
 *     computeRoute 를 다시 호출해 백엔드에서 재계산한다 (이 응답값은 신뢰 안 함).
 *
 * 인증: Authorization: Bearer <Firebase ID token> + mood allowlist 게이트.
 *   - allowlist 에 없는 email → 403 (mood-data.js 동일 패턴).
 *
 * Query:
 *   - origin (필수)      : 출발지 주소/장소명
 *   - destination (필수) : 목적지 주소/장소명
 *   - waypoints (선택)   : 경유지, "|" 로 구분 (예: "수원역|판교역")
 *
 * 반환: { ok:true, data:{ km, tollKRW, durationMin } } | { ok:false, error }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail } from './_shared/mood-allowlist.js';
import { computeRoute } from './_shared/mood-route.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }

  // ── 1) 인증 ──────────────────────────────────────────────
  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;

  // ── 2) query 파싱 ────────────────────────────────────────
  const url = new URL(req.url, `https://${req.headers.host}`);
  const origin = (url.searchParams.get('origin') || '').trim();
  const destination = (url.searchParams.get('destination') || '').trim();
  const waypointsRaw = (url.searchParams.get('waypoints') || '').trim();
  const waypoints = waypointsRaw ? waypointsRaw.split('|').map((w) => w.trim()).filter(Boolean) : [];

  if (!origin || !destination) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'origin·destination 필수' }));
  }

  try {
    const db = initAdminDb('mood-route');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // ── 3) allowlist 게이트 (mood-data.js 동일 패턴) ─────────
    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음' }));
    }

    // ── 4) 경로 계산 ──────────────────────────────────────
    const route = await computeRoute({ origin, destination, waypoints });
    if (!route.ok) {
      res.writeHead(route.status || 502, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: route.error, ...(route.detail ? { detail: route.detail } : {}) }));
    }

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      // path/points = 지도에 실제 경로 선 + 출발/경유/도착 마커 그리기용 (가격은 km/tollKRW 그대로).
      data: {
        km: route.km, tollKRW: route.tollKRW, durationMin: route.durationMin,
        path: route.path || [], points: route.points || [],
      },
    }));
  } catch (err) {
    console.error('[mood-route] failed:', err.message);
    await captureError(err, { route: '/api/mood-route', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
