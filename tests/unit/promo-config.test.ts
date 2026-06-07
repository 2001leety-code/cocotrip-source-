// Coverage for api/_shared/promo-config.js — 프로모 배너 설정 읽기/쓰기 모듈.
// fail-safe(에러 db → DEFAULT), setPromoConfig 검증(잘못된 필드/타입 거부, 정상 통과),
// DEFAULT_PROMO_CONFIG 4언어 존재 확인.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// firebase-admin/firestore FieldValue mock (setPromoConfig 내부 동적 import)
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
}));

describe('api/_shared/promo-config — DEFAULT_PROMO_CONFIG', () => {
  it('4언어(ko/en/ja/zh) copy 가 모두 존재한다', async () => {
    vi.resetModules();
    const { DEFAULT_PROMO_CONFIG } = await import('../../api/_shared/promo-config.js');
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      expect(typeof DEFAULT_PROMO_CONFIG.copy[lang]).toBe('string');
      expect(DEFAULT_PROMO_CONFIG.copy[lang].length).toBeGreaterThan(0);
    }
  });

  it('4언어(ko/en/ja/zh) ctaText 가 모두 존재한다', async () => {
    vi.resetModules();
    const { DEFAULT_PROMO_CONFIG } = await import('../../api/_shared/promo-config.js');
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      expect(typeof DEFAULT_PROMO_CONFIG.ctaText[lang]).toBe('string');
      expect(DEFAULT_PROMO_CONFIG.ctaText[lang].length).toBeGreaterThan(0);
    }
  });

  it('enabled=true, ctaHref/endDate 가 string 이다', async () => {
    vi.resetModules();
    const { DEFAULT_PROMO_CONFIG } = await import('../../api/_shared/promo-config.js');
    expect(DEFAULT_PROMO_CONFIG.enabled).toBe(true);
    expect(typeof DEFAULT_PROMO_CONFIG.ctaHref).toBe('string');
    expect(typeof DEFAULT_PROMO_CONFIG.endDate).toBe('string');
  });
});

describe('api/_shared/promo-config — getPromoConfig fail-safe', () => {
  afterEach(() => { vi.resetModules(); });

  it('db=null 이면 DEFAULT_PROMO_CONFIG 반환 (throw 없음)', async () => {
    vi.resetModules();
    const { getPromoConfig, DEFAULT_PROMO_CONFIG, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const result = await getPromoConfig(null);
    expect(result).toEqual(DEFAULT_PROMO_CONFIG);
  });

  it('Firestore 읽기 에러 → DEFAULT 반환 (throw 없음)', async () => {
    vi.resetModules();
    const { getPromoConfig, DEFAULT_PROMO_CONFIG, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const brokenDb = {
      collection: () => ({
        doc: () => ({
          get: () => Promise.reject(new Error('Firestore unavailable')),
        }),
      }),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await getPromoConfig(brokenDb as never);
    warnSpy.mockRestore();
    expect(result).toEqual(DEFAULT_PROMO_CONFIG);
  });

  it('Firestore 문서 미존재 → DEFAULT 반환', async () => {
    vi.resetModules();
    const { getPromoConfig, DEFAULT_PROMO_CONFIG, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const emptyDb = {
      collection: () => ({
        doc: () => ({
          get: () => Promise.resolve({ exists: false, data: () => ({}) }),
        }),
      }),
    };
    const result = await getPromoConfig(emptyDb as never);
    expect(result).toEqual(DEFAULT_PROMO_CONFIG);
  });

  it('Firestore 에 enabled=false 있으면 반환값에 반영된다', async () => {
    vi.resetModules();
    const { getPromoConfig, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const dbWithDisabled = {
      collection: () => ({
        doc: () => ({
          get: () => Promise.resolve({
            exists: true,
            data: () => ({ enabled: false }),
          }),
        }),
      }),
    };
    const result = await getPromoConfig(dbWithDisabled as never);
    expect(result.enabled).toBe(false);
  });

  it('TTL 캐시 — 두 번째 호출은 db 없이도 캐시 반환', async () => {
    vi.resetModules();
    const { getPromoConfig, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    let callCount = 0;
    const countingDb = {
      collection: () => ({
        doc: () => ({
          get: () => { callCount += 1; return Promise.resolve({ exists: false, data: () => ({}) }); },
        }),
      }),
    };
    await getPromoConfig(countingDb as never); // 1st — DB 호출
    await getPromoConfig(countingDb as never); // 2nd — 캐시 히트
    expect(callCount).toBe(1);
  });
});

describe('api/_shared/promo-config — setPromoConfig 검증', () => {
  afterEach(() => { vi.resetModules(); });

  function makeMockDb() {
    const setMock = vi.fn().mockResolvedValue(undefined);
    const db = {
      collection: () => ({ doc: () => ({ set: setMock }) }),
    };
    return { db, setMock };
  }

  it('정상 config (enabled + copy + ctaText + ctaHref + endDate) → ok:true', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db } = makeMockDb();
    const result = await setPromoConfig(db as never, {
      enabled: true,
      copy: { ko: '테스트', en: 'test', ja: 'てすと', zh: '测试' },
      ctaText: { ko: '보기', en: 'View', ja: '見る', zh: '查看' },
      ctaHref: '/tours',
      endDate: '7/1',
    }, 'admin@test.com');
    expect(result.ok).toBe(true);
  });

  it('허용되지 않은 필드(arbitraryKey) 포함 → ok:false + error', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db } = makeMockDb();
    const result = await setPromoConfig(db as never, {
      enabled: true,
      arbitraryKey: 'HACK',
    } as never, 'admin@test.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('arbitraryKey');
  });

  it('enabled 가 boolean 아니면 → ok:false + error', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db } = makeMockDb();
    const result = await setPromoConfig(db as never, { enabled: 'yes' } as never, 'admin@test.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boolean');
  });

  it('copy.ko 가 string 아니면 → ok:false + error', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db } = makeMockDb();
    const result = await setPromoConfig(db as never, {
      copy: { ko: 123, en: 'ok', ja: 'ok', zh: 'ok' },
    } as never, 'admin@test.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('string');
  });

  it('ctaHref 가 string 아니면 → ok:false + error', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db } = makeMockDb();
    const result = await setPromoConfig(db as never, { ctaHref: 42 } as never, 'admin@test.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('string');
  });

  it('부분 업데이트 (enabled 만) → ok:true (화이트리스트 내)', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db } = makeMockDb();
    const result = await setPromoConfig(db as never, { enabled: false }, 'admin@test.com');
    expect(result.ok).toBe(true);
  });

  it('db=null → ok:false', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const result = await setPromoConfig(null as never, { enabled: true }, 'admin@test.com');
    expect(result.ok).toBe(false);
  });

  it('저장 성공 시 updatedBy/updatedAt 포함하여 set 호출', async () => {
    vi.resetModules();
    const { setPromoConfig } = await import('../../api/_shared/promo-config.js');
    const { db, setMock } = makeMockDb();
    await setPromoConfig(db as never, { enabled: true }, '2001leety@gmail.com');
    expect(setMock).toHaveBeenCalledTimes(1);
    const callArg = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.updatedBy).toBe('2001leety@gmail.com');
    expect(callArg.updatedAt).toBe('__SERVER_TIMESTAMP__');
  });
});
