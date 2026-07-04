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
 *         origin?, destination?, waypoints?(string[] | "A|B") }
 *   - origin/destination 이 있으면 경로 기반 거리/톨비 추가요금 반영.
 *   - 없으면 거리/톨비 0 (시간 단가 base 만).
 *
 * 성공 시 notifyOperator 텔레그램 알림 (best-effort). 영수증은 화면 뷰로 대체(이메일 발송 없음, 2026-07-03).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeMoodTotalKRW, isValidServiceType, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import { computeRoute } from './_shared/mood-route.js';
import { notify } from './_shared/notify.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;       // YYYY-MM-DD
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm (00:00 ~ 23:59)

/** body.waypoints 정규화 — 배열 또는 "A|B" 문자열 둘 다 허용. */
function normalizeWaypoints(wp) {
  if (Array.isArray(wp)) return wp.map((w) => String(w || '').trim()).filter(Boolean);
  if (typeof wp === 'string') return wp.split('|').map((w) => w.trim()).filter(Boolean);
  return [];
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
    const isAdmin = isAdminEmail(allowlist, email);
    if (!isAdmin && clientId !== allowlist.clientId) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '본인 회사만 예약 가능' }));
    }

    // ── 4) 경로 계산 (origin/destination 있을 때만) ─────────
    // 클라이언트가 보낸 km/tollKRW 는 무시 — 백엔드에서 Naver 로 직접 측정.
    let km = 0;
    let tollKRW = 0;
    if (origin && destination && !isFixedPrice) {
      const route = await computeRoute({ origin, destination, waypoints });
      if (route.ok) {
        km = route.km;
        tollKRW = route.tollKRW;
      } else {
        // 경로 계산 실패 = 비치명적 → base-only(km=0, tollKRW=0) 로 진행.
        // UI 가 "경로 실패 시 거리 추가요금 제외하고 예약 가능" 이라 약속하므로 일치시킨다
        // (외상 "막지 않는다" 철학과도 일관). breakdown 에 origin/destination 은 남아 추적 가능.
        console.warn('[mood-book] computeRoute failed → base-only:', route.error, route.detail || '');
      }
    }

    // ── 5) 백엔드 금액 재계산 (body.amountKRW 무시) ─────────
    const priced = computeMoodTotalKRW({ serviceType, durationHours: hours, km, tollKRW });
    if (!priced.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: priced.error }));
    }
    const { amountKRW, baseKRW, ratePerHour, distanceSurchargeKRW } = priced;
    // 예약 doc 에 저장할 breakdown (mood-data 차감 리스트에서 노출).
    const breakdown = {
      baseKRW,
      distanceSurchargeKRW,
      tollKRW: priced.tollKRW,
      km: priced.km,
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
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) {
        return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      }
      const clientData = clientSnap.data() || {};
      const balanceKRW = Number(clientData.balanceKRW) || 0;

      // 외상 허용 — 잔액 부족해도 차단하지 않고 항상 차감 (newBalance 음수 가능, 운영자 정책).
      const newBalance = balanceKRW - amountKRW;
      // 🟡 신용한도 가드 (opt-in): client doc 에 creditLimitKRW(양수) 가 설정돼 있으면
      // 그만큼까지만 외상 허용. 미설정 = 무한 외상(기본 정책 유지). 폭주(토큰탈취/재시도
      // 루프/버그)로 잔액이 -수억까지 내려가는 걸 운영자가 회사별로 막는 안전장치.
      const creditLimitKRW = Number(clientData.creditLimitKRW);
      if (Number.isFinite(creditLimitKRW) && creditLimitKRW > 0 && newBalance < -creditLimitKRW) {
        return { ok: false, status: 409, error: 'CREDIT_LIMIT_EXCEEDED', creditLimitKRW, balanceKRW };
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
        ratePerHour,
        amountKRW,
        breakdown,
        balanceAfterKRW: newBalance, // 이 예약 후 잔액 (외상 추적용)
        status: 'confirmed',
        createdByEmail: email,
        createdAt,
      });

      // 잔액 차감 (같은 트랜잭션)
      tx.update(clientRef, { balanceKRW: newBalance });

      return {
        ok: true,
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

    // ── 7) 텔레그램 알림 (best-effort — 실패해도 예약은 확정됨) ──
    const fmt = (n) => Number(n).toLocaleString('ko-KR');
    const SERVICE_LABELS = { vehicle: '차량', airport: '공항', manager: '매니저' };
    const serviceLabel = SERVICE_LABELS[serviceType] || serviceType;
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
      data: {
        bookingId: txResult.bookingId,
        amountKRW: txResult.amountKRW,
        ratePerHour: txResult.ratePerHour,
        balanceKRW: txResult.newBalance,
        breakdown,
      },
    }));
  } catch (err) {
    // 내부 예외 메시지(Firestore 인덱스 URL·경로·자격증명 힌트)를 클라이언트에 노출하지 않음.
    console.error('[mood-book] failed:', err.message);
    await captureError(err, { route: '/api/mood-book', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
