/**
 * GET /api/mood-data?clientId=... — MOOD 포털 조회
 *
 * 잔액 카드 + 공유 캘린더 + 차감 리스트(ledger)용 데이터를 반환.
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.emails 에 없으면 403.
 *   - admins 여부도 함께 반환 → 프론트가 "충전" UI 노출 분기.
 *
 * v1 단일 client 가정: mood_config/allowlist.clientId 에 기본 client 1개.
 *   - query clientId 가 오면 그걸 우선 사용하되, 광고사 직원은 allowlist.clientId
 *     (자기 회사) 만 조회 가능하도록 제한 (admin 은 임의 clientId 조회 허용).
 *
 * 차감 리스트(ledger): 각 예약의 breakdown(시급/거리추가/톨비/km/경로) + 그 예약
 *   직후 running 잔액(runningBalanceKRW) 을 최신순으로 반환. 직원/운영자가
 *   "얼마 빠졌고 잔액 얼마" 를 한눈에 본다 (외상 = 음수 잔액 포함).
 *
 * 반환: { client: { name, balanceKRW }, bookings: [...ledger], isAdmin, clientId }
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
    const currentBalanceKRW = Number(clientData.balanceKRW) || 0;

    // 캘린더 + 차감 리스트용 예약 목록 — 해당 client, 최근순.
    // ⚠️ where(clientId ==) + orderBy(createdAt) 는 복합 인덱스 필요(자동 인덱스 X).
    //    firestore.indexes.json: mood_bookings (clientId ASC, createdAt DESC).
    const bookingsSnap = await db.collection('mood_bookings')
      .where('clientId', '==', clientId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    // running 잔액(예약 직후 잔액):
    //   - 예약 doc 에 balanceAfterKRW 가 저장돼 있으면(신규 예약) 그대로 사용 = 정확.
    //   - 없으면(레거시) null. 충전(topup) 이력은 이 컬렉션에 없어 역산에 반영 못 하므로
    //     amountKRW 만으로 거슬러 올라가면 충전액만큼 틀어진다 → 틀린 숫자 대신 null
    //     (프론트가 '잔액' 줄을 숨김 = 빈칸). 정확값 필요하면 백필로 balanceAfterKRW 채울 것.
    const bookings = bookingsSnap.docs.map((d) => {
      const b = d.data() || {};
      const amount = Number(b.amountKRW) || 0;
      const runningBalanceKRW = typeof b.balanceAfterKRW === 'number' ? b.balanceAfterKRW : null;
      return {
        id: d.id,
        date: b.date,
        startTime: b.startTime,
        durationHours: b.durationHours,
        serviceType: b.serviceType,
        amountKRW: amount,
        ratePerHour: typeof b.ratePerHour === 'number' ? b.ratePerHour : null, // 영수증 산식 표기용 (2026-07-04)
        breakdown: b.breakdown || null, // { baseKRW, distanceSurchargeKRW, tollKRW, km, origin, destination, waypoints }
        runningBalanceKRW,               // 이 예약 직후 잔액 (외상 = 음수 가능)
        status: b.status,
        // 운행 종료 정산(completed) — 실제시간·최종금액·조정액 (mood-settle.js)
        actualHours: typeof b.actualHours === 'number' ? b.actualHours : null,
        finalAmountKRW: typeof b.finalAmountKRW === 'number' ? b.finalAmountKRW : null,
        adjustmentKRW: typeof b.adjustmentKRW === 'number' ? b.adjustmentKRW : null,
        note: typeof b.note === 'string' && b.note ? b.note : null, // 예약 메모 (항공편 등, 2026-07-05)
        createdByEmail: b.createdByEmail,
        createdAt: b.createdAt,
      };
    });

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        clientId,
        client: { name: clientData.name || clientId, balanceKRW: currentBalanceKRW },
        bookings,
        isAdmin: admin,
      },
    }));
  } catch (err) {
    console.error('[mood-data] failed:', err.message);
    await captureError(err, { route: '/api/mood-data', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
