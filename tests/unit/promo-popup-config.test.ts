/**
 * tests/unit/promo-popup-config.test.ts
 *
 * api/_shared/promo-config.js — 팝업 설정 단위 테스트.
 * 배너 기존 동작 회귀 없음 확인 포함.
 *
 * 검증:
 *   1. DEFAULT_POPUP_CONFIG 4언어 parity
 *   2. getPopupConfig fail-safe (에러 → DEFAULT)
 *   3. getPopupConfig Firestore 정상 → 병합값 반환
 *   4. setPopupConfig 화이트리스트 외 필드 거부
 *   5. setPopupConfig 잘못된 frequency 거부
 *   6. setPopupConfig 잘못된 타입 거부 (enabled boolean)
 *   7. setPopupConfig langMap 타입 오류 거부
 *   8. setPopupConfig 성공 경로 (캐시 무효화)
 *   9. 배너 DEFAULT 4언어 parity (회귀 방지)
 *  10. 배너/팝업 캐시 독립성
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// firebase-admin/firestore 동적 import mock
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => '__TS__') },
}));

import {
  DEFAULT_POPUP_CONFIG,
  DEFAULT_PROMO_CONFIG,
  getPopupConfig,
  setPopupConfig,
  getPromoConfig,
  __resetPopupConfigCache,
  __resetPromoConfigCache,
} from '../../api/_shared/promo-config.js';

const LANG_KEYS = ['ko', 'en', 'ja', 'zh'] as const;

// ── 헬퍼: 정상 Firestore DB mock ──────────────────────────────────────────────
function makeDb(docData: Record<string, unknown> | null = null) {
  const snap = {
    exists: docData !== null,
    data: () => docData,
  };
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue(snap),
        set: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  };
}

// ── 헬퍼: 오류를 던지는 DB mock ───────────────────────────────────────────────
function makeErrorDb() {
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockRejectedValue(new Error('firestore unavailable')),
        set: vi.fn().mockRejectedValue(new Error('firestore unavailable')),
      })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_POPUP_CONFIG — 4언어 parity', () => {
  it('title 에 ko/en/ja/zh 가 모두 존재하고 비어 있지 않음', () => {
    for (const lang of LANG_KEYS) {
      expect(typeof DEFAULT_POPUP_CONFIG.title[lang]).toBe('string');
      expect(DEFAULT_POPUP_CONFIG.title[lang].length).toBeGreaterThan(0);
    }
  });

  it('body 에 ko/en/ja/zh 가 모두 존재하고 비어 있지 않음', () => {
    for (const lang of LANG_KEYS) {
      expect(typeof DEFAULT_POPUP_CONFIG.body[lang]).toBe('string');
      expect(DEFAULT_POPUP_CONFIG.body[lang].length).toBeGreaterThan(0);
    }
  });

  it('ctaText 에 ko/en/ja/zh 가 모두 존재하고 비어 있지 않음', () => {
    for (const lang of LANG_KEYS) {
      expect(typeof DEFAULT_POPUP_CONFIG.ctaText[lang]).toBe('string');
      expect(DEFAULT_POPUP_CONFIG.ctaText[lang].length).toBeGreaterThan(0);
    }
  });

  it('enabled 기본값은 false (처음엔 팝업 안 뜸)', () => {
    expect(DEFAULT_POPUP_CONFIG.enabled).toBe(false);
  });

  it('frequency 기본값은 "once"', () => {
    expect(DEFAULT_POPUP_CONFIG.frequency).toBe('once');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getPopupConfig — fail-safe', () => {
  beforeEach(() => { __resetPopupConfigCache(); });

  it('Firestore 에러 시 DEFAULT_POPUP_CONFIG 반환 (throw 금지)', async () => {
    const db = makeErrorDb();
    const result = await getPopupConfig(db);
    expect(result).toEqual(DEFAULT_POPUP_CONFIG);
  });

  it('db=null 이면 DEFAULT_POPUP_CONFIG 반환', async () => {
    const result = await getPopupConfig(null);
    expect(result).toEqual(DEFAULT_POPUP_CONFIG);
  });

  it('문서 미존재(exists=false) 시 DEFAULT_POPUP_CONFIG 반환', async () => {
    const db = makeDb(null); // exists=false
    const result = await getPopupConfig(db);
    expect(result).toEqual(DEFAULT_POPUP_CONFIG);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getPopupConfig — Firestore 정상 경로', () => {
  beforeEach(() => { __resetPopupConfigCache(); });

  it('Firestore 값이 있으면 enabled 덮어쓰기', async () => {
    const db = makeDb({ enabled: true });
    const result = await getPopupConfig(db);
    expect(result.enabled).toBe(true);
  });

  it('Firestore 에 title.ko 만 있으면 ko 만 덮어쓰고 나머지는 DEFAULT', async () => {
    const db = makeDb({ title: { ko: '맞춤 제목' } });
    const result = await getPopupConfig(db);
    expect(result.title.ko).toBe('맞춤 제목');
    expect(result.title.en).toBe(DEFAULT_POPUP_CONFIG.title.en);
    expect(result.title.ja).toBe(DEFAULT_POPUP_CONFIG.title.ja);
    expect(result.title.zh).toBe(DEFAULT_POPUP_CONFIG.title.zh);
  });

  it('올바른 frequency 는 그대로 반환', async () => {
    const db = makeDb({ frequency: 'daily' });
    const result = await getPopupConfig(db);
    expect(result.frequency).toBe('daily');
  });

  it('잘못된 frequency 는 DEFAULT(once) 로 폴백', async () => {
    const db = makeDb({ frequency: 'unknown_value' });
    const result = await getPopupConfig(db);
    expect(result.frequency).toBe('once');
  });

  it('imageUrl string 은 그대로 반환', async () => {
    const db = makeDb({ imageUrl: 'https://cdn.example.com/img.webp' });
    const result = await getPopupConfig(db);
    expect(result.imageUrl).toBe('https://cdn.example.com/img.webp');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('setPopupConfig — 화이트리스트 검증', () => {
  it('허용되지 않은 필드는 거부', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { unknownField: 'x' } as unknown, 'admin@test');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/허용되지 않은 필드/);
  });

  it('enabled 가 boolean 이 아니면 거부', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { enabled: 'yes' } as unknown, 'admin@test');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boolean/);
  });

  it('title.en 이 string 이 아니면 거부', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { title: { en: 123 } } as unknown, 'admin@test');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/title\.en.*string/);
  });

  it('body 가 객체가 아니면 거부', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { body: 'flat string' } as unknown, 'admin@test');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/body.*객체/);
  });

  it('imageUrl 이 string 이 아니면 거부', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { imageUrl: 42 } as unknown, 'admin@test');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/imageUrl.*string/);
  });

  it('frequency 가 허용값 외이면 거부', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { frequency: 'weekly' } as unknown, 'admin@test');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/frequency/);
  });

  it("frequency = 'once' 는 허용", async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { frequency: 'once' }, 'admin@test');
    expect(result.ok).toBe(true);
  });

  it("frequency = 'daily' 는 허용", async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { frequency: 'daily' }, 'admin@test');
    expect(result.ok).toBe(true);
  });

  it("frequency = 'every_visit' 는 허용", async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { frequency: 'every_visit' }, 'admin@test');
    expect(result.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('setPopupConfig — 성공 경로', () => {
  beforeEach(() => { __resetPopupConfigCache(); });

  it('정상 config 는 ok:true 반환', async () => {
    const db = makeDb();
    const result = await setPopupConfig(db, { enabled: true, frequency: 'daily' }, 'admin@test');
    expect(result.ok).toBe(true);
  });

  it('성공 후 캐시 무효화 → 다음 get 이 fresh', async () => {
    // 첫 get 으로 캐시 채움
    const db1 = makeDb({ enabled: false });
    await getPopupConfig(db1);
    // set 으로 캐시 무효화
    await setPopupConfig(db1, { enabled: true }, 'admin@test');
    // 새 db mock (enabled:true)
    const db2 = makeDb({ enabled: true });
    const fresh = await getPopupConfig(db2);
    expect(fresh.enabled).toBe(true);
  });

  it('db 누락 시 ok:false 반환', async () => {
    const result = await setPopupConfig(null as unknown, { enabled: true }, 'admin@test');
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('배너 DEFAULT — 4언어 parity 회귀 방지', () => {
  it('DEFAULT_PROMO_CONFIG.copy 에 ko/en/ja/zh 모두 존재', () => {
    for (const lang of LANG_KEYS) {
      expect(typeof DEFAULT_PROMO_CONFIG.copy[lang]).toBe('string');
      expect(DEFAULT_PROMO_CONFIG.copy[lang].length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_PROMO_CONFIG.ctaText 에 ko/en/ja/zh 모두 존재', () => {
    for (const lang of LANG_KEYS) {
      expect(typeof DEFAULT_PROMO_CONFIG.ctaText[lang]).toBe('string');
      expect(DEFAULT_PROMO_CONFIG.ctaText[lang].length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('배너/팝업 캐시 독립성', () => {
  beforeEach(() => {
    __resetPromoConfigCache();
    __resetPopupConfigCache();
  });

  it('배너 캐시 무효화가 팝업 캐시에 영향 없음', async () => {
    // 팝업 캐시 채우기
    const dbPopup = makeDb({ enabled: true, frequency: 'daily' });
    await getPopupConfig(dbPopup);

    // 배너 캐시 리셋 (팝업은 영향 없어야 함)
    __resetPromoConfigCache();

    // 팝업은 여전히 캐시에서 반환 (db 호출 없이 cached값 일치)
    const dbEmpty = makeDb(null); // exists=false — 호출되면 DEFAULT 반환
    // 팝업 캐시가 살아 있으면 db 호출 없이 이전값 반환 (TTL 내)
    const cached = await getPopupConfig(dbEmpty);
    // cached 가 DEFAULT 이면 캐시가 살아있고 내부에서 enabled=true 로 채워져 있어야 함
    // (캐시 TTL 60s 이내이므로) — enabled=true 반환 기대
    expect(cached.enabled).toBe(true);
  });

  it('팝업 getPopupConfig 오류가 배너 getPromoConfig 에 영향 없음', async () => {
    const popupErrorDb = makeErrorDb();
    const bannerOkDb = makeDb({ enabled: false }); // 배너용

    // 팝업 오류 → DEFAULT 반환, throw 없음
    const popupResult = await getPopupConfig(popupErrorDb);
    expect(popupResult).toEqual(DEFAULT_POPUP_CONFIG);

    // 배너는 정상 동작
    const bannerResult = await getPromoConfig(bannerOkDb);
    expect(bannerResult.enabled).toBe(false);
  });
});
