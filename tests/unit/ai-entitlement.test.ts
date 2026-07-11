/**
 * AI 유료 기능 자격(aiFeaturesUnlocked) 게이트 가드 (운영자 2026-07-07 요금제).
 *
 * 설계: $9.90 구매자만 course-ai(AI 동선최적화·주변추천) 사용. 무료 쿠폰/비로그인=잠김.
 * hasAiFeatureEntitlement 가 users/{uid}.aiFeaturesUnlocked===true 만 true, 그 외 false(안전).
 */
import { describe, it, expect } from 'vitest';
import { hasAiFeatureEntitlement } from '../../api/_shared/ai-entitlement.js';

function mockDb(userDoc: any) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: userDoc != null, data: () => userDoc }),
      }),
    }),
  };
}

describe('hasAiFeatureEntitlement', () => {
  it('aiFeaturesUnlocked===true → true (구매자)', async () => {
    expect(await hasAiFeatureEntitlement(mockDb({ aiFeaturesUnlocked: true }) as never, 'u')).toBe(true);
  });
  it('플래그 없음/false → false (무료·미구매)', async () => {
    expect(await hasAiFeatureEntitlement(mockDb({}) as never, 'u')).toBe(false);
    expect(await hasAiFeatureEntitlement(mockDb({ aiFeaturesUnlocked: false }) as never, 'u')).toBe(false);
  });
  it('user 문서 없음 → false', async () => {
    expect(await hasAiFeatureEntitlement(mockDb(null) as never, 'u')).toBe(false);
  });
  it('db/uid 누락 → false (비로그인)', async () => {
    expect(await hasAiFeatureEntitlement(null as never, 'u')).toBe(false);
    expect(await hasAiFeatureEntitlement(mockDb({ aiFeaturesUnlocked: true }) as never, '')).toBe(false);
  });
  it('truthy 이지만 !==true (문자열 등) → false (엄격 비교)', async () => {
    expect(await hasAiFeatureEntitlement(mockDb({ aiFeaturesUnlocked: 'yes' }) as never, 'u')).toBe(false);
  });
});
