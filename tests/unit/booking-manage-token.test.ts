/**
 * 게스트 예약 관리 토큰 (api/_shared/booking-manage-token.js, 2026-10-23 후속 ②a).
 * 잠그는 것: payload 모양 · 만료 = 투어일 KST 23:59 + 7일(최대 400일) · 무효 날짜 throw ·
 *   검증 순서(형식 → 서명 → v/pur/iat/exp → oid/ver/env/dep) · 넘긴 대상만 비교.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBookingManageToken, verifyBookingManageToken } from '../../api/_shared/booking-manage-token.js';
import { createSignedToken } from '../../api/_shared/hmac-sign.js';

const SECRET = 's'.repeat(48);
const NOW = Date.UTC(2026, 9, 23, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const base = { orderID: 'ORD-1', version: 0, paypalEnvironment: 'live', deployment: 'production', tourDate: '2026-11-01', nowMs: NOW };
const saved = process.env.BOOKING_MANAGE_SIGNING_SECRET;

beforeEach(() => { process.env.BOOKING_MANAGE_SIGNING_SECRET = SECRET; });
afterEach(() => { if (saved === undefined) delete process.env.BOOKING_MANAGE_SIGNING_SECRET; else process.env.BOOKING_MANAGE_SIGNING_SECRET = saved; });

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}
const sign = (payload: object) => createSignedToken(payload, { secretEnv: 'BOOKING_MANAGE_SIGNING_SECRET' });

describe('createBookingManageToken', () => {
  it('payload { v:1, pur:"manage", oid, ver, env, dep, iat, exp }', () => {
    const { token, expiresAtMs } = createBookingManageToken(base);
    expect(decode(token)).toEqual({ v: 1, pur: 'manage', oid: 'ORD-1', ver: 0, env: 'live', dep: 'production', iat: NOW, exp: expiresAtMs });
  });

  it('exp = tour day 23:59 KST + 7 days', () => {
    const { expiresAtMs } = createBookingManageToken(base);
    expect(expiresAtMs).toBe(Date.UTC(2026, 10, 1, 14, 59, 0) + 7 * DAY);
  });

  it('exp is capped at now + 400 days', () => {
    const { expiresAtMs } = createBookingManageToken({ ...base, tourDate: '2029-01-01' });
    expect(expiresAtMs).toBe(NOW + 400 * DAY);
  });

  it('invalid tourDate / missing orderID throw', () => {
    for (const tourDate of ['', '2026-02-30', '2026/11/01', 'tomorrow', undefined]) {
      expect(() => createBookingManageToken({ ...base, tourDate })).toThrow(/invalid tourDate/);
    }
    expect(() => createBookingManageToken({ ...base, orderID: '' })).toThrow(/orderID/);
  });

  it('sandbox env is kept; anything else normalises to live', () => {
    expect(decode(createBookingManageToken({ ...base, paypalEnvironment: 'sandbox' }).token).env).toBe('sandbox');
    expect(decode(createBookingManageToken({ ...base, paypalEnvironment: undefined }).token).env).toBe('live');
  });
});

describe('verifyBookingManageToken', () => {
  const opts = { orderID: 'ORD-1', version: 0, paypalEnvironment: 'live', deployment: 'production', nowMs: NOW + 1000 };

  it('accepts a fresh token for the same target', () => {
    const { token } = createBookingManageToken(base);
    expect(verifyBookingManageToken(token, opts)).toMatchObject({ ok: true, payload: { oid: 'ORD-1', ver: 0 } });
  });

  it('format → FORMAT, bad signature → SIGNATURE', () => {
    const { token } = createBookingManageToken(base);
    expect(verifyBookingManageToken('not-a-token', opts)).toMatchObject({ ok: false, code: 'FORMAT' });
    process.env.BOOKING_MANAGE_SIGNING_SECRET = 'x'.repeat(48);
    expect(verifyBookingManageToken(token, opts)).toMatchObject({ ok: false, code: 'SIGNATURE' });
  });

  it('purpose / iat / expiry', () => {
    const good = decode(createBookingManageToken(base).token);
    expect(verifyBookingManageToken(sign({ ...good, pur: 'chat' }), opts)).toMatchObject({ ok: false, code: 'PURPOSE' });
    expect(verifyBookingManageToken(sign({ ...good, v: 2 }), opts)).toMatchObject({ ok: false, code: 'PURPOSE' });
    expect(verifyBookingManageToken(sign({ ...good, iat: NOW + 10 * 60_000 }), opts)).toMatchObject({ ok: false, code: 'IAT' });
    expect(verifyBookingManageToken(createBookingManageToken(base).token, { ...opts, nowMs: good.exp })).toMatchObject({ ok: false, code: 'EXPIRED' });
  });

  it('oid / ver / env / dep mismatches', () => {
    const { token } = createBookingManageToken(base);
    expect(verifyBookingManageToken(token, { ...opts, orderID: 'ORD-2' })).toMatchObject({ ok: false, code: 'ORDER' });
    expect(verifyBookingManageToken(token, { ...opts, version: 1 })).toMatchObject({ ok: false, code: 'VERSION' });
    expect(verifyBookingManageToken(token, { ...opts, paypalEnvironment: 'sandbox' })).toMatchObject({ ok: false, code: 'ENV' });
    expect(verifyBookingManageToken(token, { ...opts, deployment: 'preview' })).toMatchObject({ ok: false, code: 'DEPLOYMENT' });
  });

  it('only compares the targets that are passed (pre-load stage checks signature/expiry only)', () => {
    const { token } = createBookingManageToken(base);
    expect(verifyBookingManageToken(token, { nowMs: NOW + 1000 })).toMatchObject({ ok: true });
  });

  it('a token for the previous version is rejected after the version is bumped', () => {
    const { token } = createBookingManageToken(base);
    expect(verifyBookingManageToken(token, { ...opts, version: 1 })).toMatchObject({ ok: false, code: 'VERSION' });
  });
});
