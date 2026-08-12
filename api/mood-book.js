/**
 * POST /api/mood-book — MOOD 선불 예약 (잔액 차감, 외상 허용)
 *
 * MOOD B2B 포털: 광고사 직원이 매니저/차량을 예약. 선불 충전된 잔액에서 차감.
 *
 * 🔴 돈 원자성 (이 파일이 핵심):
 *   Firestore runTransaction 안에서 ① 잔액 읽기 ② 백엔드 금액 재계산
 *   ③ 예약 doc 생성 ④ 잔액 차감을 "한 트랜잭션" 으로 수행.
 *   (Firestore 트랜잭션은 read 한 doc 이 commit 전 변경되면 자동 재시도 → race-safe.
 *    동시 예약이 같은 잔액을 두 번 읽어 어긋나는 일 없음.)
 *
 * 🟡 외상(음수 잔액) 정책 (운영자 2026-06-12):
 *   잔액이 부족해도 예약을 막지 않는다. INSUFFICIENT_BALANCE 차단 제거 →
 *   항상 차감 (newBalance 가 음수가 될 수 있음 = 외상). 운영자가 차감 리스트
 *   (mood-data) 로 외상분을 확인하고 추후 정산.
 *
 * 🔴 클라이언트 금액 무시 (P311): body 로 amountKRW/km/tollKRW 가 와도 전부 무시.
 *   origin/destination 으로 computeRoute (Naver) → computeMoodTotalKRW 로 백엔드
 *   재계산. → 클라이언트가 금액/거리/톨비를 조작해도 무력화.
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.emails 에 없으면 403.
 *
 * Body: { clientId, date(YYYY-MM-DD), startTime(HH:mm), durationHours, serviceType,
 *         origin?, destination?, waypoints?(string[] | "A|B"),
 *         airportDirection?('pickup'|'sending'), airportCode?('ICN'|'GMP'),
 *         courseMoodPercentages?(integer[]), courseShareSchemaVersion?(2) }
 *   - origin/destination 이 있으면 경로 기반 거리/톨비 추가요금 반영.
 *   - 없으면 거리/톨비 0 (시간 단가 base 만).
 *   - courseMoodPercentages 는 출발·경유·도착 지점 수와 같고 각 값은 0~100 정수.
 *     구 쓰기 필드 coursePayers 는 400으로 거부한다.
 *
 * 성공 시 notifyOperator 텔레그램 알림 (best-effort). 영수증은 화면 뷰로 대체(이메일 발송 없음, 2026-07-03).
 */
import { createHash } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeMoodTotalKRW, isValidServiceType, fixedPriceFor, normalizeAirportCode, MOOD_AIRPORT_LABEL, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import { computeRoute } from './_shared/mood-route.js';
import { notify } from './_shared/notify.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
const COURSE_SHARE_SCHEMA_VERSION = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;       // YYYY-MM-DD
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm (00:00 ~ 23:59)

/** body.waypoints 정규화 — 배열 또는 "A|B" 문자열 둘 다 허용. */
function normalizeWaypoints(wp) {
  if (Array.isArray(wp)) return wp.map((w) => String(w || '').trim()).filter(Boolean);
  if (typeof wp === 'string') return wp.split('|').map((w) => w.trim()).filter(Boolean);
  return [];
}

function compactPath(path, limit = 600) {
  if (!Array.isArray(path) || path.length <= limit) return Array.isArray(path) ? path : [];
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

function isValidComputedRoute(route) {
  return Boolean(
    route
    && route.ok
    && typeof route.km === 'number'
    && Number.isFinite(route.km)
    && route.km >= 0
    && Number.isSafeInteger(route.tollKRW)
    && route.tollKRW >= 0
    && typeof route.durationMin === 'number'
    && Number.isFinite(route.durationMin)
    && route.durationMin >= 0,
  );
}

function isValidPricedResult(priced) {
  return Boolean(
    priced
    && priced.ok
    && [
      priced.amountKRW,
      priced.baseKRW,
      priced.ratePerHour,
      priced.distanceSurchargeKRW,
      priced.tollKRW,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
    && typeof priced.km === 'number'
    && Number.isFinite(priced.km)
    && priced.km >= 0,
  );
}

function legacyPayersForPercentages(percentages) {
  if (!percentages.every((percentage) => percentage === 0 || percentage === 100)) return null;
  return percentages.map((percentage) => percentage === 100 ? 'mood' : 'influencer');
}

function normalizeCourseMoodPercentages(raw, stopCount, requestedSchemaVersion) {
  if (
    requestedSchemaVersion !== undefined
    && requestedSchemaVersion !== COURSE_SHARE_SCHEMA_VERSION
  ) {
    return { ok: false, error: 'INVALID_COURSE_SHARE_SCHEMA_VERSION' };
  }
  if (raw === undefined) {
    return { ok: true, value: Array.from({ length: stopCount }, (_, index) => index === 0 ? 100 : 0) };
  }
  if (
    !Array.isArray(raw)
    || raw.length !== stopCount
    || raw.some((percentage) => !Number.isInteger(percentage) || percentage < 0 || percentage > 100)
  ) {
    return { ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' };
  }
  return { ok: true, value: raw.slice() };
}

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  // ── 1) 인증 ──────────────────────────────────────────────
  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  const email = auth.email;
  // 돈 변경 경계 — 미검증 이메일 토큰 차단 (defense-in-depth; Google 로그인은 항상 verified).
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }

  // ── 2) body 파싱 + 검증 ──────────────────────────────────
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { clientId, date, startTime, durationHours, serviceType } = body;
  const origin = String(body.origin || '').trim();
  const destination = String(body.destination || '').trim();
  const waypoints = normalizeWaypoints(body.waypoints);
  // 공항 픽업/샌딩 방향 — airport 일 때만 의미. 'pickup'(도착편) | 'sending'(출발편).
  //   가격엔 영향 없음(출발/도착 주소가 거리 결정). 기사·운영자용 메타.
  const airportDirection = serviceType === 'airport'
    ? (body.airportDirection === 'sending' ? 'sending' : 'pickup')
    : null;
  // 🔴 공항 코드 — 정액이 공항마다 다름(ICN 110,000 / GMP 80,000, 운영자 2026-07-27).
  //   금액에 직접 영향 → 정규화 필수. 알 수 없는 값/미지정은 전부 ICN(비싼 쪽) 으로 폴백해
  //   조작으로 싼 요금을 받는 경로를 막는다(과소청구 방지).
  const airportCode = serviceType === 'airport' ? normalizeAirportCode(body.airportCode) : null;
  // 예약 메모 (2026-07-05 PR3) — AI 예약이 항공편 정보(✈️ KE765 15:10) 자동 첨부. 표시용 메타,
  // 금액 계산과 무관. 상한 500자 (폭주 방지).
  const note = String(body.note || '').slice(0, 500).trim();
  const influencerName = String(body.influencerName || '').slice(0, 100).trim();
  const idempotencyKey = String(body.idempotencyKey || '').trim();

  if (!clientId || typeof clientId !== 'string') {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'clientId 필수' }));
  }
  if (!DATE_RE.test(String(date))) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'date 는 YYYY-MM-DD 형식' }));
  }
  if (!TIME_RE.test(String(startTime))) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'startTime 은 HH:mm 형식' }));
  }
  if (!isValidServiceType(serviceType)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: "serviceType 은 'vehicle' · 'airport' · 'manager' 중 하나" }));
  }
  // 정액 서비스(공항)는 시간 무관 → durationHours 검증 스킵(저장 0). 그 외만 검증.
  const isFixedPrice = fixedPriceFor(serviceType) !== null;
  const hours = isFixedPrice ? 0 : Number(durationHours);
  if (!isFixedPrice && (!Number.isFinite(hours) || hours <= 0 || hours > MOOD_MAX_DURATION_HOURS)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `durationHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }
  // origin/destination 은 같이 오거나 같이 비어야 함 (한쪽만 = 모호).
  if ((origin && !destination) || (!origin && destination)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'origin·destination 은 함께 입력' }));
  }
  if (waypoints.length > 5) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'WAYPOINT_LIMIT_EXCEEDED' }));
  }
  if (origin.length > 300 || destination.length > 300 || waypoints.some((waypoint) => waypoint.length > 300)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_ROUTE_INPUT' }));
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY' }));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'coursePayers')) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' }));
  }
  const courseMoodPercentagesResult = normalizeCourseMoodPercentages(
    body.courseMoodPercentages,
    origin && destination ? waypoints.length + 2 : 0,
    body.courseShareSchemaVersion,
  );
  if (!courseMoodPercentagesResult.ok) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: courseMoodPercentagesResult.error }));
  }
  const courseMoodPercentages = courseMoodPercentagesResult.value;
  const coursePayers = legacyPayersForPercentages(courseMoodPercentages);

  try {
    const db = initAdminDb('mood-book');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // ── 3) allowlist 게이트 ───────────────────────────────
    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음' }));
    }
    // 🔴 IDOR 방지 — 비-admin 은 자기 회사(allowlist.clientId) 만 예약 가능.
    // (mood-data.js 조회 가드와 동일 정책. 이게 없으면 직원이 body.clientId 로 타 회사
    //  잔액을 차감하는 예약을 만들 수 있음 — 외상 정책상 무제한 음수까지.)
    const requestPayload = {
      clientId, date, startTime, durationHours: hours, serviceType,
      origin, destination, waypoints, airportDirection, airportCode, note, influencerName,
      courseMoodPercentages,
      courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
    };
    const payloadHash = createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');
    const isAdmin = isAdminEmail(allowlist, email);
    if (!isAdmin && clientId !== allowlist.clientId) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '본인 회사만 예약 가능' }));
    }
    const idempotencyRef = db.collection('mood_idempotency')
      .doc(createHash('sha256').update(`book:${email}:${idempotencyKey}`).digest('hex'));

    // ── 4) 경로 계산 (origin/destination 있을 때만) ─────────
    // 클라이언트가 보낸 km/tollKRW 는 무시 — 백엔드에서 Naver 로 직접 측정.
    if (idempotencyRef) {
      const existingRequest = await idempotencyRef.get();
      if (existingRequest.exists) {
        const saved = existingRequest.data() || {};
        if (saved.payloadHash !== payloadHash || saved.operation !== 'book') {
          res.writeHead(409, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: false, error: 'IDEMPOTENCY_CONFLICT' }));
        }
        res.writeHead(200, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: true, data: saved.responseData }));
      }
    }

    let km = 0;
    let tollKRW = 0;
    let airportDetourKm = 0;
    let routeSnapshot = null;
    if (origin && destination) {
      if (isFixedPrice) {
        // 공항(정액) — 직행은 11만 그대로. 경유지가 있으면 "직행 대비 늘어난 거리"에만
        // 거리요금(2026-07-05 운영자). 경유포함 경로 − 직행 경로를 각각 측정해 우회분 산출.
        //   예: 집→공항 직행 50km / 집→용산역→공항 65km → 우회 15km × 600원.
        if (waypoints.length) {
          const [viaRoute, directRoute] = await Promise.all([
            computeRoute({ origin, destination, waypoints }),
            computeRoute({ origin, destination }), // 경유 제외 직행
          ]);
          if (isValidComputedRoute(viaRoute) && isValidComputedRoute(directRoute)) {
            airportDetourKm = Math.max(0, viaRoute.km - directRoute.km);
            routeSnapshot = {
              km: viaRoute.km,
              tollKRW: viaRoute.tollKRW,
              durationMin: viaRoute.durationMin,
              path: compactPath(viaRoute.path),
              points: viaRoute.points || [],
              calculatedAt: Date.now(),
            };
          } else {
            res.writeHead(422, JSON_HEADERS);
            return res.end(JSON.stringify({ ok: false, error: 'ROUTE_CALCULATION_FAILED' }));
          }
        } else {
          const directRoute = await computeRoute({ origin, destination });
          if (!isValidComputedRoute(directRoute)) {
            res.writeHead(422, JSON_HEADERS);
            return res.end(JSON.stringify({ ok: false, error: 'ROUTE_CALCULATION_FAILED' }));
          }
          routeSnapshot = {
            km: directRoute.km,
            tollKRW: directRoute.tollKRW,
            durationMin: directRoute.durationMin,
            path: compactPath(directRoute.path),
            points: directRoute.points || [],
            calculatedAt: Date.now(),
          };
        }
      } else {
        const route = await computeRoute({ origin, destination, waypoints });
        if (isValidComputedRoute(route)) {
          km = route.km;
          tollKRW = route.tollKRW;
          routeSnapshot = {
            km: route.km,
            tollKRW: route.tollKRW,
            durationMin: route.durationMin,
            path: compactPath(route.path),
            points: route.points || [],
            calculatedAt: Date.now(),
          };
        } else {
          res.writeHead(422, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: false, error: 'ROUTE_CALCULATION_FAILED' }));
        }
      }
    }

    // ── 5) 백엔드 금액 재계산 (body.amountKRW 무시) ─────────
    const priced = computeMoodTotalKRW({ serviceType, durationHours: hours, km, tollKRW, airportDetourKm, airportCode });
    if (!priced.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: priced.error }));
    }
    if (!isValidPricedResult(priced)) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_PRICING_RESULT' }));
    }
    const { amountKRW, baseKRW, ratePerHour, distanceSurchargeKRW } = priced;
    // 예약 doc 에 저장할 breakdown (mood-data 차감 리스트에서 노출).
    const breakdown = {
      baseKRW,
      distanceSurchargeKRW,
      tollKRW: priced.tollKRW,
      km: priced.km,
      routeKm: routeSnapshot ? routeSnapshot.km : priced.km,
      durationMin: routeSnapshot ? routeSnapshot.durationMin : null,
      origin: origin || null,
      destination: destination || null,
      waypoints: waypoints.length ? waypoints : null,
    };

    const clientRef = db.collection('mood_clients').doc(clientId);
    const bookingRef = db.collection('mood_bookings').doc(); // 새 doc id 미리 확보

    // ── 6) 🔴 원자적 잔액 차감 + 예약 생성 (외상 허용) ─────
    // runTransaction 안에서 read→write. balanceKRW 가 commit 전 변경되면 Firestore
    // 가 트랜잭션 전체를 재실행 → 동시 예약 더블카운트 불가.
    // 🟡 외상 정책: 잔액 부족해도 abort 하지 않고 항상 차감 (newBalance 음수 가능).
    const txResult = await db.runTransaction(async (tx) => {
      if (idempotencyRef) {
        const requestSnap = await tx.get(idempotencyRef);
        if (requestSnap.exists) {
          const saved = requestSnap.data() || {};
          if (saved.payloadHash !== payloadHash || saved.operation !== 'book') {
            return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
          }
          return { ok: true, replayed: true, responseData: saved.responseData };
        }
      }
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) {
        return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      }
      const clientData = clientSnap.data() || {};
      const balanceKRW = clientData.balanceKRW;
      if (!Number.isSafeInteger(balanceKRW)) {
        return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
      }

      // 외상 허용 — 잔액 부족해도 차단하지 않고 항상 차감 (newBalance 음수 가능, 운영자 정책).
      const newBalance = balanceKRW - amountKRW;
      if (!Number.isSafeInteger(newBalance)) {
        return { ok: false, status: 409, error: 'INVALID_CALCULATED_BALANCE' };
      }
      // 🟡 신용한도 가드 (opt-in): client doc 에 creditLimitKRW(양수) 가 설정돼 있으면
      // 그만큼까지만 외상 허용. 미설정 = 무한 외상(기본 정책 유지). 폭주(토큰탈취/재시도
      // 루프/버그)로 잔액이 -수억까지 내려가는 걸 운영자가 회사별로 막는 안전장치.
      const creditLimitKRW = clientData.creditLimitKRW;
      if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
        if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
          return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
        }
        if (newBalance < -creditLimitKRW) {
          return { ok: false, status: 409, error: 'CREDIT_LIMIT_EXCEEDED', creditLimitKRW, balanceKRW };
        }
      }
      const createdAt = Date.now();

      // 예약 doc 생성 (breakdown + 차감 후 잔액 running 포함)
      tx.set(bookingRef, {
        clientId,
        date,
        startTime,
        durationHours: hours,
        serviceType,
        airportDirection, // 공항 픽업/샌딩 (그 외 null)
        airportCode,      // 'ICN' | 'GMP' — 정액 단가 근거 (그 외 null)
        ratePerHour,
        amountKRW,
        breakdown,
        routeSnapshot,
        balanceAfterKRW: newBalance, // 이 예약 후 잔액 (외상 추적용)
        status: 'confirmed',
        revision: 0,
        influencerName: influencerName || null,
        courseMoodPercentages,
        courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
        coursePayers,
        note: note || null, // 예약 메모 (항공편 등 — 표시용)
        createdByEmail: email,
        createdAt,
      });

      // 잔액 차감 (같은 트랜잭션)
      tx.update(clientRef, { balanceKRW: newBalance });

      const responseData = {
        bookingId: bookingRef.id,
        amountKRW,
        ratePerHour,
        balanceKRW: newBalance,
        breakdown,
        revision: 0,
        courseMoodPercentages,
        courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
        coursePayers,
      };
      if (idempotencyRef) {
        tx.set(idempotencyRef, {
          operation: 'book',
          payloadHash,
          responseData,
          clientId,
          createdByEmail: email,
          createdAt,
        });
      }

      return {
        ok: true,
        responseData,
        bookingId: bookingRef.id,
        amountKRW,
        ratePerHour,
        newBalance,
        clientName: clientData.name || clientId,
      };
    });

    if (!txResult.ok) {
      res.writeHead(txResult.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: txResult.error }));
    }
    if (txResult.replayed) {
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: true, data: txResult.responseData }));
    }

    // ── 7) 텔레그램 알림 (best-effort — 실패해도 예약은 확정됨) ──
    const fmt = (n) => Number(n).toLocaleString('ko-KR');
    const SERVICE_LABELS = { vehicle: '차량', airport: '공항', manager: '매니저' };
    const serviceLabel = airportCode
      ? (MOOD_AIRPORT_LABEL[airportCode] || SERVICE_LABELS.airport)
      : (SERVICE_LABELS[serviceType] || serviceType);
    const directionLabel = airportDirection === 'pickup' ? ' (픽업)' : airportDirection === 'sending' ? ' (샌딩)' : '';
    const routeLine = origin && destination
      ? `\n${origin} → ${destination}${isFixedPrice ? '' : ` (${priced.km}km)`}`
      : '';
    const overdraftLine = txResult.newBalance < 0 ? ' ⚠️외상' : '';
    const msg =
      `<b>MOOD 예약</b>\n` +
      `${txResult.clientName} · ${date} ${startTime}\n` +
      `${serviceLabel}${directionLabel}${hours > 0 ? ` ${hours}시간` : ''} — ${fmt(txResult.amountKRW)}원${routeLine}\n` +
      `잔액 ${fmt(txResult.newBalance)}원${overdraftLine}\n` +
      `예약자: ${email}`;
    try {
      await notify('booking', msg);
    } catch (notifyErr) {
      // 알림 실패는 비치명적 — 로그만.
      console.warn('[mood-book] notify failed:', notifyErr?.message);
    }

    // 이메일 영수증 발송 제거(2026-07-03 운영자 결정) — 화면 영수증 뷰로 대체. 텔레그램 알림만 유지.

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: txResult.responseData,
    }));
  } catch (err) {
    // 내부 예외 메시지(Firestore 인덱스 URL·경로·자격증명 힌트)를 클라이언트에 노출하지 않음.
    console.error('[mood-book] failed:', err.message);
    await captureError(err, { route: '/api/mood-book', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
