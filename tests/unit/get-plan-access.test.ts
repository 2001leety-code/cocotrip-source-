/**
 * tests/unit/get-plan-access.test.ts
 *
 * resolvePlanAccess 순수 헬퍼 + 마스킹 검증.
 * Firestore / Admin SDK 는 일절 사용하지 않음 (순수 단위 테스트).
 *
 * 케이스:
 *   1. 토큰 일치 → full (PII 포함)
 *   2. 토큰 불일치 + isPublic → masked (PII 없음)
 *   3. 토큰 불일치 + 비공개 → denied
 *   4. planId 없음 (handler 레벨 guard — resolvePlanAccess 는 planId 미검증,
 *      handler 가 400 반환함을 별도 검증)
 */

import { describe, it, expect } from 'vitest';
import { resolvePlanAccess } from '../../api/get-plan.js';

// 완전한 가짜 플랜 (PII 포함)
function makePlan(overrides = {}) {
  return {
    uid: 'user-abc',
    guestEmail: 'guest@example.com',
    accessToken: 'secret-tok-123',
    isPublic: false,
    pricing: { total_usd: 9.9 },
    title: '서울 3일 여행',
    input: {
      specialRequest: '알레르기: 견과류',
      hotel_address: '서울 중구 명동',
      arrival_airport: 'ICN',
      departure_airport: 'ICN',
      nights: 3,
    },
    itinerary: { days: [] },
    ...overrides,
  };
}

// ── 케이스 1: 토큰 일치 → full ──────────────────────────────────────────────
describe('resolvePlanAccess — 토큰 일치 (full)', () => {
  const plan = makePlan();
  const result = resolvePlanAccess(plan, 'secret-tok-123');

  it('access 가 full 이다', () => {
    expect(result.access).toBe('full');
  });

  it('plan 이 반환된다', () => {
    expect(result.plan).toBeDefined();
  });

  it('uid 가 포함된다 (PII 제거 안 함)', () => {
    expect(result.plan.uid).toBe('user-abc');
  });

  it('guestEmail 이 포함된다', () => {
    expect(result.plan.guestEmail).toBe('guest@example.com');
  });

  it('accessToken 이 포함된다', () => {
    expect(result.plan.accessToken).toBe('secret-tok-123');
  });

  it('pricing 이 포함된다', () => {
    expect(result.plan.pricing).toBeDefined();
  });

  it('input.specialRequest 이 포함된다', () => {
    expect(result.plan.input.specialRequest).toBe('알레르기: 견과류');
  });

  it('input.hotel_address 이 포함된다', () => {
    expect(result.plan.input.hotel_address).toBeDefined();
  });
});

// ── 케이스 2: 토큰 불일치 + isPublic → masked ────────────────────────────────
describe('resolvePlanAccess — 토큰 불일치 + isPublic (masked)', () => {
  const plan = makePlan({ isPublic: true });
  const result = resolvePlanAccess(plan, 'wrong-token');

  it('access 가 masked 이다', () => {
    expect(result.access).toBe('masked');
  });

  it('plan 이 반환된다', () => {
    expect(result.plan).toBeDefined();
  });

  it('uid 가 없다', () => {
    expect(result.plan.uid).toBeUndefined();
  });

  it('guestEmail 이 없다', () => {
    expect(result.plan.guestEmail).toBeUndefined();
  });

  it('accessToken 이 없다', () => {
    expect(result.plan.accessToken).toBeUndefined();
  });

  it('pricing 이 없다', () => {
    expect(result.plan.pricing).toBeUndefined();
  });

  it('input.specialRequest 가 없다', () => {
    expect(result.plan.input.specialRequest).toBeUndefined();
  });

  it('input.hotel_address 가 없다', () => {
    expect(result.plan.input.hotel_address).toBeUndefined();
  });

  it('input.arrival_airport 가 없다', () => {
    expect(result.plan.input.arrival_airport).toBeUndefined();
  });

  it('input.departure_airport 가 없다', () => {
    expect(result.plan.input.departure_airport).toBeUndefined();
  });

  it('itinerary 는 유지된다 (뷰 안 깨짐)', () => {
    expect(result.plan.itinerary).toBeDefined();
  });

  it('input.nights 같은 비PII 는 유지된다', () => {
    expect(result.plan.input.nights).toBe(3);
  });
});

// ── 케이스 2b: 토큰 없음 + isPublic → masked ─────────────────────────────────
describe('resolvePlanAccess — 토큰 없음 + isPublic (masked)', () => {
  const plan = makePlan({ isPublic: true });
  const result = resolvePlanAccess(plan, '');

  it('access 가 masked 이다', () => {
    expect(result.access).toBe('masked');
  });

  it('guestEmail 이 없다', () => {
    expect(result.plan.guestEmail).toBeUndefined();
  });
});

// ── 케이스 3: 토큰 불일치 + 비공개 → denied ─────────────────────────────────
describe('resolvePlanAccess — 토큰 불일치 + 비공개 (denied)', () => {
  const plan = makePlan({ isPublic: false });

  it('access 가 denied 이다 (잘못된 토큰)', () => {
    const result = resolvePlanAccess(plan, 'bad-token');
    expect(result.access).toBe('denied');
  });

  it('plan 이 반환되지 않는다', () => {
    const result = resolvePlanAccess(plan, 'bad-token');
    expect(result.plan).toBeUndefined();
  });

  it('access 가 denied 이다 (토큰 없음 + 비공개)', () => {
    const result = resolvePlanAccess(plan, '');
    expect(result.access).toBe('denied');
  });
});

// ── 케이스 4: accessToken 없는 플랜 + isPublic false → denied ───────────────
describe('resolvePlanAccess — accessToken 없는 플랜', () => {
  it('토큰이 있어도 플랜에 accessToken 없으면 full 이 아니다', () => {
    const plan = makePlan({ accessToken: undefined, isPublic: false });
    const result = resolvePlanAccess(plan, 'some-token');
    expect(result.access).toBe('denied');
  });

  it('isPublic true 이면 masked 로 열린다', () => {
    const plan = makePlan({ accessToken: undefined, isPublic: true });
    const result = resolvePlanAccess(plan, '');
    expect(result.access).toBe('masked');
  });
});

// ── 원본 플랜 불변성 확인 (masked 는 deep clone) ────────────────────────────
describe('resolvePlanAccess — masked 원본 불변성', () => {
  it('masked 결과 수정이 원본에 영향 안 준다', () => {
    const plan = makePlan({ isPublic: true });
    const result = resolvePlanAccess(plan, '');
    // masked plan 에는 uid 없음. 원본에는 여전히 있어야 함.
    expect(result.plan.uid).toBeUndefined();
    expect(plan.uid).toBe('user-abc');
  });
});
