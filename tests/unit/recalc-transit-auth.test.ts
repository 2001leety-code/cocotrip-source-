/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * recalc-transit 인증 회귀 (2026-06-13 버그헌트, 2단계).
 * (1단계, #918) isGuest=!plan.uid 가 "소유자 없는 plan" 을 자격 없이 누구나 변조 허용.
 *   → accessToken 있는 plan 은 owner/token 만, accessToken 없는 legacy 게스트만 하위호환.
 * (2단계, 본 PR) owner 경로가 Authorization: Bearer 원문을 verifyIdToken 없이 raw uid 로
 *   비교 → 피해자 uid 만 알면 owned plan 변조. → verifyUserToken 의 검증된 auth.uid 만 owner.
 */
import { describe, it, expect, vi } from 'vitest';

let planData: any = null;
function chain(): any {
  return {
    collection: () => chain(),
    doc: () => chain(),
    get: async () => ({ exists: planData !== null, data: () => planData }),
    update: async () => {},
    set: async () => {},
  };
}
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => chain(), FieldValue: { increment: () => 1 } }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => '1.2.3.4' }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => null }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: async () => null }));
const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: (...a: any[]) => verifyUserTokenMock(...a),
  default: (...a: any[]) => verifyUserTokenMock(...a),
}));

function makeRes(): any {
  const res: any = {
    statusCode: undefined, headers: {}, body: '',
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(s: number) { res.statusCode = s; return res; },
    json(o: any) { res.body = JSON.stringify(o); return res; },
  };
  return res;
}

// verifyResult: Bearer 헤더 있을 때 verifyUserToken 이 반환할 값(검증 성공/실패).
async function call(planObj: any, body: any, authHeader?: string, verifyResult?: any) {
  planData = planObj;
  verifyUserTokenMock.mockReset();
  verifyUserTokenMock.mockResolvedValue(verifyResult || { ok: false, status: 401, error: 'Token verification failed' });
  const handler = (await import('../../api/recalc-transit.js')).default;
  const res = makeRes();
  await handler({ method: 'POST', headers: authHeader ? { authorization: authHeader } : {}, body } as any, res as any);
  return res;
}

describe('recalc-transit 인증 — 게스트 무자격 변조 + raw-uid IDOR 차단', () => {
  it('accessToken 보유 게스트 plan + 토큰 없음 → 403', async () => {
    const res = await call({ uid: null, accessToken: 'secret', itinerary: { days: [] } }, { planId: 'p', dayIndex: 0 });
    expect(res.statusCode).toBe(403);
  });

  it('accessToken 보유 게스트 plan + 올바른 token → 인증 통과(403 아님)', async () => {
    const res = await call({ uid: null, accessToken: 'secret', itinerary: { days: [] } }, { planId: 'p', dayIndex: 0, token: 'secret' });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(400); // Invalid dayIndex(빈 days) = 인증 통과 입증
  });

  it('legacy 게스트 plan(accessToken 없음) + 토큰 없음 → 하위호환 통과(403 아님)', async () => {
    const res = await call({ uid: null, accessToken: null, itinerary: { days: [] } }, { planId: 'p', dayIndex: 0 });
    expect(res.statusCode).not.toBe(403);
  });

  it('소유자 plan + 검증된 ID 토큰(verifyUserToken ok=uid 일치) → 통과', async () => {
    const res = await call(
      { uid: 'owner1', accessToken: null, itinerary: { days: [] } },
      { planId: 'p', dayIndex: 0 },
      'Bearer valid.id.token',
      { ok: true, uid: 'owner1', email: 'o@x.com' },
    );
    expect(res.statusCode).not.toBe(403);
  });

  it('🔴 raw uid 를 Bearer 로 보내도 verifyIdToken 실패 → owner 불인정 → 403 (IDOR 차단)', async () => {
    // 공격자가 피해자 uid='owner1' 를 알아 Bearer owner1 로 보내도, 그것은 유효한 ID 토큰이
    // 아니므로 verifyUserToken 이 실패(ok=false) → uid=null → isOwner=false → 403.
    const res = await call(
      { uid: 'owner1', accessToken: 'secret', itinerary: { days: [] } },
      { planId: 'p', dayIndex: 0 },
      'Bearer owner1',
      { ok: false, status: 401, error: 'Token verification failed' },
    );
    expect(res.statusCode).toBe(403);
  });

  it('소유자 plan + 타인의 검증된 토큰(uid 불일치) → 403', async () => {
    const res = await call(
      { uid: 'owner1', accessToken: 'secret', itinerary: { days: [] } },
      { planId: 'p', dayIndex: 0 },
      'Bearer other.id.token',
      { ok: true, uid: 'attacker', email: 'a@x.com' },
    );
    expect(res.statusCode).toBe(403);
  });
});
