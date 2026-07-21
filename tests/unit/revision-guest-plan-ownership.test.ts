// ─────────────────────────────────────────────────────────────────────────────
// revision 소유권 가드 — 게스트 플랜 fail-open 회귀 테스트 (2026-07-21)
//
// 배경 (보안 감사): api/_ai_core/paymentGate.js 의 revision 분기 거부 조건이
//   `!isOwner && !hasToken && hasValidOwnerUid` 였다. hasValidOwnerUid 를 거부의
//   **필수항**으로 둔 탓에, uid 가 없는 게스트 플랜(origData.uid=null)은 조건이 항상
//   false → accessToken 이 없거나 틀려도 절대 거부되지 않았다(fail-open).
//
//   게스트 플랜은 planPersister 가 accessToken=randomUUID + revisionCredits=2 로 저장하며,
//   그 accessToken 이 유일한 보호 수단이다. 기존 가드는 그걸 무시해, planId 만 알면
//   토큰 없이 무결제 revision 을 생성할 수 있었다(유료 플랜 $9.90 우회 + IDOR).
//
// fix: 보호 수단이 하나라도 있으면(소유 uid OR accessToken) 소유/토큰 일치를 강제.
//   이 테스트가 그 경계를 박제한다 — 폴백 복원(hasValidOwnerUid 필수항)을 재주입하면
//   'guest+무토큰 거부' 케이스가 red 가 된다.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

/** plans/{id} 하나만 돌려주는 최소 adminDb mock. revision 분기는 credits 차감에 runTransaction 을 쓴다. */
function mockDb(origData: Record<string, unknown>) {
  const doc = (_id: string) => ({
    get: async () => ({ exists: true, data: () => origData }),
    set: async () => {},
    update: async () => {},
  });
  return {
    collection: () => ({ doc, add: async () => {} }),
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      const tx = {
        get: async () => ({ data: () => origData }),
        update: () => {},
        set: () => {},
      };
      return cb(tx);
    },
  };
}

const REVISION_OF = 'plan-abc123';
const TOKEN = 'secret-access-token-uuid';

describe('revision — 게스트 플랜(uid=null)은 accessToken 을 강제한다', () => {
  it('⭐ 게스트 플랜 + 토큰 없음 → 403 (fail-open 회귀 방지)', async () => {
    const db = mockDb({ uid: null, accessToken: TOKEN, revisionCredits: 2 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF /* revisionToken 없음 */ },
      db,
      'attacker@example.com',
      'attacker-uid'
    );
    expect(result.rejection?.statusCode).toBe(403);
    expect(result.rejection?.code).toBe('FORBIDDEN');
  });

  it('⭐ 게스트 플랜 + 틀린 토큰 → 403', async () => {
    const db = mockDb({ uid: null, accessToken: TOKEN, revisionCredits: 2 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF, revisionToken: 'wrong-token' },
      db,
      'attacker@example.com',
      'attacker-uid'
    );
    expect(result.rejection?.statusCode).toBe(403);
  });

  it('게스트 플랜 + 올바른 토큰 → 통과 (정당 소유자)', async () => {
    const db = mockDb({ uid: null, accessToken: TOKEN, revisionCredits: 2 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF, revisionToken: TOKEN },
      db,
      null,
      null
    );
    expect(result.rejection).toBeUndefined();
    expect(result.isRevision).toBe(true);
  });
});

describe('revision — 소유 uid 플랜 (기존 동작 보존, 회귀 없음)', () => {
  it('소유자 uid 일치 → 통과', async () => {
    const db = mockDb({ uid: 'owner-uid', accessToken: TOKEN, revisionCredits: 1 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF },
      db,
      'owner@example.com',
      'owner-uid'
    );
    expect(result.rejection).toBeUndefined();
    expect(result.isRevision).toBe(true);
  });

  it('⭐ 남의 uid 플랜 + 토큰 없음 → 403 (기존 IDOR 가드 유지)', async () => {
    const db = mockDb({ uid: 'owner-uid', accessToken: TOKEN, revisionCredits: 1 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF },
      db,
      'attacker@example.com',
      'attacker-uid'
    );
    expect(result.rejection?.statusCode).toBe(403);
  });

  it('빈 문자열 uid 플랜 + accessToken 있음 + 토큰 없음 → 403 (P1-4 우회 + 게스트 케이스 둘 다 차단)', async () => {
    const db = mockDb({ uid: '', accessToken: TOKEN, revisionCredits: 2 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF },
      db,
      'attacker@example.com',
      'attacker-uid'
    );
    expect(result.rejection?.statusCode).toBe(403);
  });
});

describe('revision — 크레딧 소진 (보호와 무관하게 유지)', () => {
  it('올바른 토큰이어도 credits=0 → REVISION_EXHAUSTED', async () => {
    const db = mockDb({ uid: null, accessToken: TOKEN, revisionCredits: 0 });
    const result = await enforcePaymentAndRevision(
      { revisionOf: REVISION_OF, revisionToken: TOKEN },
      db,
      null,
      null
    );
    expect(result.rejection?.code).toBe('REVISION_EXHAUSTED');
  });
});
