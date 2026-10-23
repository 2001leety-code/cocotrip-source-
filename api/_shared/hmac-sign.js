/**
 * 공용 HMAC 서명 토큰 (2026-10-23 — chat-session-auth 에서 추출, booking-manage-token 이 함께 쓴다).
 *
 * 형식: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload 부분)).
 * 비밀: process.env[secretEnv] → GOOGLE_SERVICE_ACCOUNT_KEY → FIREBASE_PRIVATE_KEY (32자 미만이면 throw).
 * 검증 순서: 형식(두 조각) → 서명(timingSafeEqual, JSON 파싱 **전**) → JSON 파싱. 값은 로그·응답에 노출하지 않는다.
 * 목적(pur)·만료·대상 일치 같은 의미 검사는 호출자 몫이다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signingSecret(secretEnv, label = 'signing') {
  const secret = (secretEnv && process.env[secretEnv])
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    || process.env.FIREBASE_PRIVATE_KEY
    || '';
  if (secret.length < 32) throw new Error(`${label} secret unavailable`);
  return secret;
}

export function signEncoded(encodedPayload, { secretEnv, label } = {}) {
  return createHmac('sha256', signingSecret(secretEnv, label)).update(encodedPayload, 'utf8').digest('base64url');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** @returns {string} 서명된 토큰. 비밀이 없으면 throw. */
export function createSignedToken(payload, { secretEnv, label } = {}) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signEncoded(encoded, { secretEnv, label })}`;
}

/**
 * 서명 검증 + payload 복원. 절대 throw 하지 않는다(비밀 없음도 실패로 돌려준다).
 * @returns {{ok: true, payload: object} | {ok: false, code: 'FORMAT'|'SIGNATURE'|'INVALID'}}
 */
export function verifySignedToken(token, { secretEnv, label } = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, code: 'FORMAT' };
    if (!safeEqual(signEncoded(parts[0], { secretEnv, label }), parts[1])) return { ok: false, code: 'SIGNATURE' };
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, code: 'FORMAT' };
    return { ok: true, payload };
  } catch {
    return { ok: false, code: 'INVALID' };
  }
}
