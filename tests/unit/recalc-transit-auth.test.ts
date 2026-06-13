/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * recalc-transit 인증 회귀 (2026-06-13 버그헌트).
 * 결함: isGuest=!plan.uid 가 "소유자 없는 plan" 을 자격 없이 누구나 변조 허용 — accessToken 을
 *   가진 게스트 plan 도 토큰 없이 통과(무인증 plan 변조).
 * fix: accessToken 이 있는 plan 은 owner 또는 token 일치만 허용. accessToken 자체가 없는
 *   legacy 게스트 plan(보호수단 부재)만 하위호환 통과 — 정상 게스트 편집(token 전달) 무영향.
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

function makeRes(): any {
  const res: any = {
    statusCode: undefined, headers: {}, body: '',
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(s: number) { res.statusCode = s; return res; },
    json(o: any) { res.body = JSON.stringify(o); return res; },
  };
  return res;
}

async function call(planObj: any, body: any, authHeader?: string) {
  planData = planObj;
  const handler = (await import('../../api/recalc-transit.js')).default;
  const res = makeRes();
  await handler({ method: 'POST', headers: authHeader ? { authorization: authHeader } : {}, body } as any, res as any);
  return res;
}

describe('recalc-transit 인증 — 게스트 무자격 변조 차단 (isGuest 제거)', () => {
  it('accessToken 보유 게스트 plan + 토큰 없음 → 403 (이전엔 isGuest 로 통과)', async () => {
    const res = await call({ uid: null, accessToken: 'secret', itinerary: { days: [] } }, { planId: 'p', dayIndex: 0 });
    expect(res.statusCode).toBe(403);
  });

  it('accessToken 보유 게스트 plan + 올바른 토큰 → 인증 통과(403 아님)', async () => {
    const res = await call({ uid: null, accessToken: 'secret', itinerary: { days: [] } }, { planId: 'p', dayIndex: 0, token: 'secret' });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(400); // Invalid dayIndex(빈 days) = 인증 통과 입증
  });

  it('legacy 게스트 plan(accessToken 없음) + 토큰 없음 → 하위호환 통과(403 아님)', async () => {
    const res = await call({ uid: null, accessToken: null, itinerary: { days: [] } }, { planId: 'p', dayIndex: 0 });
    expect(res.statusCode).not.toBe(403);
  });

  it('소유자 plan + 본인 Bearer uid → 통과(owner 흐름 무영향)', async () => {
    const res = await call({ uid: 'owner1', accessToken: null, itinerary: { days: [] } }, { planId: 'p', dayIndex: 0 }, 'Bearer owner1');
    expect(res.statusCode).not.toBe(403);
  });

  it('소유자 plan + 타인 Bearer uid + 토큰 없음 → 403', async () => {
    const res = await call({ uid: 'owner1', accessToken: 'secret', itinerary: { days: [] } }, { planId: 'p', dayIndex: 0 }, 'Bearer attacker');
    expect(res.statusCode).toBe(403);
  });
});
