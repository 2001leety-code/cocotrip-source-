/**
 * GET /api/mood-data?clientId=... — MOOD 포털 조회
 *
 * 잔액 카드 + 공유 캘린더용 데이터를 반환.
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.emails 에 없으면 403.
 *   - admins 여부도 함께 반환 → 프론트가 "충전" UI 노출 분기.
 *
 * v1 단일 client 가정: mood_config/allowlist.clientId 에 기본 client 1개.
 *   - query clientId 가 오면 그걸 우선 사용하되, 광고사 직원은 allowlist.clientId
 *     (자기 회사) 만 조회 가능하도록 제한 (admin 은 임의 clientId 조회 허용).
 *
 * 반환: { client: { name, balanceKRW }, bookings: [...], isAdmin, clientId }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail } from './_shared/mood-allowlist.js';

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

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;

  try {
    const db = initAdminDb('mood-data');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음' }));
    }
    const admin = isAdminEmail(allowlist, email);

    const url = new URL(req.url, `https://${req.headers.host}`);
    const queryClientId = (url.searchParams.get('clientId') || '').trim();

    // 광고사 직원: allowlist.clientId (자기 회사) 로 강제. admin: query 우선.
    let clientId = allowlist.clientId;
    if (admin && queryClientId) {
      clientId = queryClientId;
    } else if (!admin && queryClientId && queryClientId !== allowlist.clientId) {
      // 비-admin 이 다른 회사 clientId 를 보려 하면 거부 (IDOR 방지).
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '본인 회사 데이터만 조회 가능' }));
    }

    if (!clientId) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'clientId 미지정 (mood_config/allowlist.clientId 설정 필요)' }));
    }

    const clientSnap = await db.collection('mood_clients').doc(clientId).get();
    if (!clientSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: `CLIENT_NOT_FOUND: ${clientId}` }));
    }
    const clientData = clientSnap.data() || {};

    // 캘린더용 예약 목록 — 해당 client, 최근순. (인덱스 회피: clientId equality +
    // createdAt desc 단일 필드 정렬은 자동 인덱스로 충분.)
    const bookingsSnap = await db.collection('mood_bookings')
      .where('clientId', '==', clientId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const bookings = bookingsSnap.docs.map((d) => {
      const b = d.data() || {};
      return {
        id: d.id,
        date: b.date,
        startTime: b.startTime,
        durationHours: b.durationHours,
        serviceType: b.serviceType,
        amountKRW: b.amountKRW,
        status: b.status,
        createdByEmail: b.createdByEmail,
        createdAt: b.createdAt,
      };
    });

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        clientId,
        client: { name: clientData.name || clientId, balanceKRW: Number(clientData.balanceKRW) || 0 },
        bookings,
        isAdmin: admin,
      },
    }));
  } catch (err) {
    console.error('[mood-data] failed:', err.message);
    await captureError(err, { route: '/api/mood-data', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
