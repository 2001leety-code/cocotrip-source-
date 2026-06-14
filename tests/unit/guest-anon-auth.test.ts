// Coverage for FEATURE_GUEST_ANON_AUTH backend wiring:
//   1. api/_shared/user-auth.js — verifyGuestAnonToken (익명 전용 idToken 검증)
//   2. api/_ai_core/planPersister.js — savePlanSkeleton / persistPlan 의 accessToken 식
//      (forceGuestToken=true → uid 있어도 token / false → 기존 uid?null:random).
//
// 배경: 게스트(비로그인) AI 플랜은 uid=null 로 저장 → Firestore 룰이 uid==null plan 을
//   누구나 read 허용 → PII 노출. 격리된 익명 Firebase uid 를 부여하면 기존 룰
//   (request.auth.uid == resource.data.uid) 이 비소유자 read 를 막는다. 단, 익명 사용자는
//   로그인 세션이 없어 공유/접근 토큰이 필요 → forceGuestToken 로 non-null uid 라도 accessToken 발급.
//
// HARD: 플래그 OFF (forceGuestToken=false 기본) 시 accessToken 식이 기존
//   (uid ? null : random) 과 동일 = byte-identical.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const verifyIdTokenMock = vi.fn();

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: vi.fn(() => [{ name: '[DEFAULT]' }]), // pretend app already initialized
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ verifyIdToken: verifyIdTokenMock })),
}));

describe('api/_shared/user-auth — verifyGuestAnonToken', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    verifyIdTokenMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.resetModules();
  });

  function reqWith(token?: string | string[]) {
    return { headers: token !== undefined ? { 'x-guest-anon-token': token } : {} };
  }

  it('헤더 없으면 {ok:false} (토큰 검증 시도조차 안 함)', async () => {
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith());
    expect(result).toEqual({ ok: false });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('빈 문자열 토큰이면 {ok:false}', async () => {
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith(''));
    expect(result).toEqual({ ok: false });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it('익명(anonymous) provider 토큰만 {ok:true, uid}', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'anon-uid-123',
      firebase: { sign_in_provider: 'anonymous' },
    });
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith('valid-anon-token'));
    expect(result).toEqual({ ok: true, uid: 'anon-uid-123' });
    // checkRevoked=true 로 검증 (2번째 인자).
    expect(verifyIdTokenMock).toHaveBeenCalledWith('valid-anon-token', true);
  });

  it('SECURITY: email/password provider 토큰은 거부 (실계정 uid 사칭 방지)', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'real-account-uid',
      email: 'attacker@example.com',
      firebase: { sign_in_provider: 'password' },
    });
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith('real-account-token'));
    // 익명 아님 → 거부 → 남의 plan 목록에 주입 불가.
    expect(result).toEqual({ ok: false });
  });

  it('SECURITY: google.com provider 토큰도 거부', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'google-uid',
      firebase: { sign_in_provider: 'google.com' },
    });
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith('google-token'));
    expect(result).toEqual({ ok: false });
  });

  it('firebase 클레임 누락 시 거부 (sign_in_provider undefined)', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ uid: 'no-provider-uid' });
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith('weird-token'));
    expect(result).toEqual({ ok: false });
  });

  it('만료/위조 토큰(verifyIdToken throw)이면 {ok:false} — graceful', async () => {
    verifyIdTokenMock.mockRejectedValueOnce(new Error('Firebase ID token has expired'));
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith('expired-token'));
    expect(result).toEqual({ ok: false });
  });

  it('헤더가 배열이면 첫 값 사용 (multi-value header 방어)', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'anon-array-uid',
      firebase: { sign_in_provider: 'anonymous' },
    });
    const { verifyGuestAnonToken } = await import('../../api/_shared/user-auth.js');
    const result = await verifyGuestAnonToken(reqWith(['first-token', 'second-token']));
    expect(result).toEqual({ ok: true, uid: 'anon-array-uid' });
    expect(verifyIdTokenMock).toHaveBeenCalledWith('first-token', true);
  });
});

// ── planPersister accessToken 로직 (forceGuestToken) ─────────────────────────
// savePlanSkeleton / persistPlan 모두 동일 식:
//   const accessToken = (forceGuestToken || !uid) ? randomUUID() : null;
// Firestore admin 의존 없이 식의 진리표만 고정 (소스의 식을 1:1 재현).
describe('planPersister accessToken 식 — forceGuestToken 진리표', () => {
  // 소스 (planPersister.js savePlanSkeleton L1058 / persistPlan L1223) 와 byte-identical.
  function computeAccessToken(uid: string | null | undefined, forceGuestToken = false): string | null {
    return (forceGuestToken || !uid) ? 'TOKEN' : null;
  }

  it('forceGuestToken=true + uid 있음 → token 발급 (게스트 익명 소유자)', () => {
    expect(computeAccessToken('anon-uid-1', true)).toBe('TOKEN');
  });

  it('forceGuestToken=false + uid 있음 → null (로그인 사용자, 기존 동작)', () => {
    expect(computeAccessToken('logged-in-uid', false)).toBe(null);
  });

  it('forceGuestToken=false + uid 없음 → token (기존 게스트 동작)', () => {
    expect(computeAccessToken(null, false)).toBe('TOKEN');
    expect(computeAccessToken(undefined, false)).toBe('TOKEN');
  });

  it('forceGuestToken=true + uid 없음 → token (방어: 식이 안전)', () => {
    expect(computeAccessToken(null, true)).toBe('TOKEN');
  });

  it('BYTE-IDENTICAL: forceGuestToken 기본값(false) = 기존 (uid ? null : random)', () => {
    // 플래그 OFF (forceGuestToken 미전달 → 기본 false) 시 기존 식과 결과 동일해야 함.
    const legacy = (uid: string | null) => (uid ? null : 'TOKEN');
    for (const uid of ['u1', null] as (string | null)[]) {
      expect(computeAccessToken(uid /* forceGuestToken 생략 = false */)).toBe(legacy(uid));
    }
  });

  it('SOURCE GUARD: 실제 planPersister.js 가 (forceGuestToken || !uid) 식을 사용한다', () => {
    // 누군가 식을 (uid ? null : random) 으로 되돌리거나 nullish 연산자로 바꾸면 회귀 감지.
    const src = readFileSync(
      resolve(__dirname, '../../api/_ai_core/planPersister.js'),
      'utf8',
    );
    // savePlanSkeleton + persistPlan 두 곳 모두 동일 식. 정확히 2회 등장해야 함.
    const matches = src.match(/const accessToken = \(forceGuestToken \|\| !uid\) \? randomUUID\(\) : null;/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
    // forceGuestToken 파라미터가 두 함수 시그니처에 기본값 false 로 존재.
    expect(src).toMatch(/forceGuestToken = false,/);
  });
});
