/**
 * 게스트 예약 관리 토큰 (2026-10-23, 후속 ②a).
 *
 * 확인 메일의 "예약 관리(취소)" 링크(`/booking/manage#t=<token>`)에 실린다 — URL 쿼리·로그·Sentry 에 남지 않게
 * 프래그먼트로만 전달하고, 서버는 POST 본문으로만 받는다.
 *
 * payload { v:1, pur:'manage', oid, ver, env:'live'|'sandbox', dep, iat, exp }
 *   oid = bookings 문서 id · ver = bookings.manageTokenVersion(취소 성공 시 +1 → 기존 링크 전부 무효)
 *   env = 예약 결제 PayPal 환경 · dep = 발급 배포(VERCEL_ENV) — 프리뷰 토큰이 운영에서 통하지 않게.
 * 서명 = 공용 hmac-sign.js (비밀 BOOKING_MANAGE_SIGNING_SECRET → GOOGLE_SERVICE_ACCOUNT_KEY → FIREBASE_PRIVATE_KEY).
 */
import { createSignedToken, verifySignedToken } from './hmac-sign.js';

const SIGN_OPTS = { secretEnv: 'BOOKING_MANAGE_SIGNING_SECRET', label: 'booking manage signing' };
const TOKEN_RE = /^[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{20,200}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const GRACE_AFTER_TOUR_MS = 7 * DAY_MS;
const MAX_LIFETIME_MS = 400 * DAY_MS;
const CLOCK_SKEW_MS = 60_000;

/** 실제 달력 날짜(YYYY-MM-DD, Date 왕복 일치)만 허용. 무효면 null. */
function tourDateEndKstMs(tourDate) {
  const s = String(tourDate || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  // KST 23:59 = UTC 14:59 같은 날
  return Date.UTC(y, mo - 1, d, 23, 59, 0) - KST_OFFSET_MS;
}

function normEnv(paypalEnvironment) {
  return paypalEnvironment === 'sandbox' ? 'sandbox' : 'live';
}

/**
 * @returns {{token: string, expiresAtMs: number}} — tourDate 가 실제 날짜가 아니거나 비밀이 없으면 throw.
 */
export function createBookingManageToken({ orderID, version, paypalEnvironment, deployment, tourDate, nowMs = Date.now() } = {}) {
  if (!orderID || typeof orderID !== 'string') throw new Error('booking manage token: orderID required');
  const tourEnd = tourDateEndKstMs(tourDate);
  if (tourEnd === null) throw new Error('booking manage token: invalid tourDate');
  const ver = Number(version) || 0;
  if (!Number.isSafeInteger(ver) || ver < 0) throw new Error('booking manage token: invalid version');
  const expiresAtMs = Math.min(tourEnd + GRACE_AFTER_TOUR_MS, nowMs + MAX_LIFETIME_MS);
  const payload = {
    v: 1,
    pur: 'manage',
    oid: orderID,
    ver,
    env: normEnv(paypalEnvironment),
    dep: String(deployment || 'development'),
    iat: nowMs,
    exp: expiresAtMs,
  };
  return { token: createSignedToken(payload, SIGN_OPTS), expiresAtMs };
}

/**
 * 검증 순서: 형식 → 서명(timingSafeEqual) → v/pur/iat/exp → oid/ver/env/dep.
 * opts 의 각 대상(orderID/version/paypalEnvironment/deployment)은 **넘긴 것만** 비교한다 — 호출자가 서명·만료를 먼저
 * 확인하고(문서 조회 전), 문서를 읽은 뒤 나머지를 비교할 수 있게.
 * @returns {{ok: true, payload: object} | {ok: false, code: string}} — code 는 내부 구분용(응답은 동일 401).
 */
export function verifyBookingManageToken(token, opts = {}) {
  const nowMs = Number(opts.nowMs) || Date.now();
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return { ok: false, code: 'FORMAT' };
  const verified = verifySignedToken(token, SIGN_OPTS);
  if (!verified.ok) return { ok: false, code: verified.code };
  const p = verified.payload;
  if (p.v !== 1 || p.pur !== 'manage') return { ok: false, code: 'PURPOSE' };
  if (typeof p.oid !== 'string' || !p.oid) return { ok: false, code: 'FORMAT' };
  if (!Number.isSafeInteger(p.ver) || p.ver < 0) return { ok: false, code: 'FORMAT' };
  if (p.env !== 'live' && p.env !== 'sandbox') return { ok: false, code: 'FORMAT' };
  if (typeof p.dep !== 'string' || !p.dep) return { ok: false, code: 'FORMAT' };
  if (!Number.isFinite(p.iat) || p.iat > nowMs + CLOCK_SKEW_MS) return { ok: false, code: 'IAT' };
  if (!Number.isFinite(p.exp) || p.exp <= nowMs) return { ok: false, code: 'EXPIRED' };
  if (opts.orderID !== undefined && p.oid !== opts.orderID) return { ok: false, code: 'ORDER' };
  if (opts.version !== undefined && p.ver !== (Number(opts.version) || 0)) return { ok: false, code: 'VERSION' };
  if (opts.paypalEnvironment !== undefined && p.env !== normEnv(opts.paypalEnvironment)) return { ok: false, code: 'ENV' };
  if (opts.deployment !== undefined && p.dep !== String(opts.deployment)) return { ok: false, code: 'DEPLOYMENT' };
  return { ok: true, payload: p };
}
