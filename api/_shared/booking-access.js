/**
 * 예약 접근 검사 (2026-10-23, 후속 ②a) — 회원(Firebase ID 토큰 + 소유자 이메일) 또는 게스트(예약 관리 토큰).
 *
 * 규칙:
 *   - Authorization 헤더가 있으면(잘못돼도) 회원 경로만 탄다 — 게스트로 전환하지 않는다.
 *   - 헤더가 없고 body.manageToken 이 있으면 게스트 경로: 서명·형식·만료(+oid) 를 **문서 조회 전에** 확인하고,
 *     조회 뒤 게스트 관리 대상 여부·버전·환경(토큰=예약=배포 런타임)·배포를 대조한다.
 *   - 인증되지 않은 모든 실패는 같은 응답(401 AUTH_REQUIRED, 같은 메시지) — 예약 존재·종류를 드러내지 않는다.
 *   - 인증 성공 뒤 비즈니스 거부(상태·cart·정책)는 호출자가 409/403 으로 답한다.
 */
import { verifyUserToken } from './user-auth.js';
import { verifyBookingManageToken } from './booking-manage-token.js';
import { resolveIsSandbox } from './paypal.js';

export const AUTH_REQUIRED_MESSAGE = 'Authentication required';
const AUTH_REQUIRED = Object.freeze({ ok: false, status: 401, code: 'AUTH_REQUIRED', error: AUTH_REQUIRED_MESSAGE });

/**
 * 게스트 관리 대상 = 회원 아님(uid·userEmail 없음) + 결제자 이메일 있음 + 장바구니 자식 아님.
 * 수동 예약은 userEmail=customerEmail 로, 회원 장바구니 자식은 parentOrderID 로 제외된다.
 * 발급(확인 메일)·접근·취소 선점 재확인·조회 네 곳이 이 함수 하나를 쓴다.
 */
export function isGuestManagedBooking(b) {
  const d = b || {};
  return !d.uid && !d.userEmail && Boolean(d.payerEmail) && !d.parentOrderID;
}

export function currentDeployment() {
  return process.env.VERCEL_ENV || 'development';
}

function runtimeEnv() {
  return resolveIsSandbox() ? 'sandbox' : 'live';
}

function bookingEnv(b) {
  return (b || {}).paypalEnvironment === 'sandbox' ? 'sandbox' : 'live';
}

/**
 * 게스트 토큰의 서명·형식·만료 검사(문서 조회 전 단계). orderID 를 넘기면 oid 일치도 본다.
 * @returns {{ok: true, payload: object} | typeof AUTH_REQUIRED}
 */
export function verifyGuestManageToken(manageToken, { orderID } = {}) {
  if (typeof manageToken !== 'string' || !manageToken) return AUTH_REQUIRED;
  const verified = verifyBookingManageToken(manageToken, orderID === undefined ? {} : { orderID });
  return verified.ok ? verified : AUTH_REQUIRED;
}

/**
 * 문서 조회 뒤 게스트 토큰 ↔ 예약 대조. 실패는 전부 동일 401.
 * @returns {{ok: true} | typeof AUTH_REQUIRED}
 */
export function matchGuestBooking(booking, payload) {
  if (!booking || !isGuestManagedBooking(booking)) return AUTH_REQUIRED;
  if (payload.ver !== (Number(booking.manageTokenVersion) || 0)) return AUTH_REQUIRED;
  if (!matchGuestEnvironment(booking, payload)) return AUTH_REQUIRED;
  return { ok: true };
}

/**
 * 환경 삼자 일치(토큰 = 예약 결제 환경 = 이 배포의 PayPal 환경) + 발급 배포 일치.
 * matchGuestBooking 과 날짜 변경 토큰 복구(modifyBooking)가 같은 기준을 쓴다.
 */
export function matchGuestEnvironment(booking, payload) {
  if (!booking || !payload) return false;
  if (payload.env !== bookingEnv(booking) || payload.env !== runtimeEnv()) return false;
  return payload.dep === currentDeployment();
}

/**
 * @param {{ req: object, body: object, bookingID: string, loadBooking: () => Promise<object|null> }} args
 * @returns {Promise<
 *   {ok: true, actor: {type: 'member', email: string, uid: string} | {type: 'guest', email: string, tokenVersion: number}, booking: object}
 *   | {ok: false, status: number, code: string, error: string}>}
 */
export async function resolveBookingAccess({ req, body, bookingID, loadBooking }) {
  const header = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (String(header).trim()) {
    const auth = await verifyUserToken(req);
    if (!auth.ok) return AUTH_REQUIRED;
    const booking = await loadBooking();
    if (!booking) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Booking not found' };
    if ((booking.userEmail || '').toLowerCase() !== String(auth.email || '').toLowerCase()) {
      return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Not your booking' };
    }
    return { ok: true, actor: { type: 'member', email: auth.email, uid: auth.uid }, booking };
  }

  const manageToken = body && body.manageToken;
  if (typeof manageToken === 'string' && manageToken) {
    const token = verifyGuestManageToken(manageToken, { orderID: bookingID });
    if (!token.ok) return token;
    const booking = await loadBooking();
    const match = matchGuestBooking(booking, token.payload);
    if (!match.ok) return match;
    return {
      ok: true,
      actor: { type: 'guest', email: booking.payerEmail || '', tokenVersion: token.payload.ver },
      booking,
    };
  }

  return AUTH_REQUIRED;
}
