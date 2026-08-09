/**
 * 프로모션 진실성 P0 회귀 가드 (2026-07-10 마케팅 지시서).
 *
 * 배경: 실발급(onboarding-coupons.js) = AI플랜 무료(1~3일) + 차터 5% + 투어 5%, 유효 1년.
 * 그런데 서버 DEFAULT(promo-config.js)는 거짓 '50% OFF·첫 예약 10%·6/28' 을,
 * 가입 모달 i18n 은 '쿠폰 2장·90일' 을 표시하고 있었음 (prod API 실응답으로 확증).
 * 7/7 에 프론트 상수만 고치고 서버 DEFAULT 를 빼먹은 것이 재발 원인 → 이 가드가 박제.
 *
 * 규칙: 활성 기본문구·i18n 에 근거 없는 할인율/지난 마감일/실발급과 다른 혜택 수·기간 금지.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
}));

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

function readLocale(lang: string): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8'));
}

// 거짓/낡은 문구 패턴 — 활성 기본값 어디에도 나오면 안 됨
const STALE_BANNER_PATTERNS = [
  /50%/, // 최대 50% 할인 (근거 없음 — 실제 총 상한 10%)
  /첫 예약 10%/, /10% off your 1st/, /初回ご予約10%/, /首单再减10%/,
  /6\/28/, // 지난 마감일 (가짜 긴급성)
];

describe('P0-A 서버 DEFAULT_PROMO_CONFIG — 거짓 문구 없음 + 실발급과 일치', () => {
  it('4언어 copy·endDate 에 50%/첫 예약 10%/6-28 이 없다', async () => {
    vi.resetModules();
    const { DEFAULT_PROMO_CONFIG } = await import('../../api/_shared/promo-config.js');
    const values = [...Object.values(DEFAULT_PROMO_CONFIG.copy), DEFAULT_PROMO_CONFIG.endDate];
    for (const v of values) {
      for (const pat of STALE_BANNER_PATTERNS) {
        expect(String(v)).not.toMatch(pat);
      }
    }
  });

  it('4언어 copy 가 실발급 혜택(한국 여행 일정 무료 + 5% 쿠폰)을 말하고, "AI" 를 전면에 내세우지 않는다', async () => {
    // 2026-08-10 P2 (#1272): 제품 포지셔닝은 "AI 플랜"이 아니라 "한국 전용 데이터로 짠
    // 실행 가능한 여행 일정" — docs/DESIGN-EDITORIAL-CONCIERGE.md §5, homeCopy.ts 와 동일 규칙.
    vi.resetModules();
    const { DEFAULT_PROMO_CONFIG } = await import('../../api/_shared/promo-config.js');
    const ITINERARY_MENTION: Record<string, RegExp> = {
      en: /itinerary/i,
      ko: /여행 일정/,
      ja: /旅程/,
      zh: /行程/,
    };
    for (const lang of LANGS) {
      expect(DEFAULT_PROMO_CONFIG.copy[lang]).not.toMatch(/\bAI\b/);
      expect(DEFAULT_PROMO_CONFIG.copy[lang]).toMatch(ITINERARY_MENTION[lang]);
      expect(DEFAULT_PROMO_CONFIG.copy[lang]).toMatch(/5%/);
    }
  });

  it('프론트 폴백(PromoBanner.tsx COPY)이 서버 DEFAULT 와 동일하다 — 7/7 재발 방지', async () => {
    vi.resetModules();
    const { DEFAULT_PROMO_CONFIG } = await import('../../api/_shared/promo-config.js');
    const bannerSrc = readFileSync(resolve(process.cwd(), 'src/components/PromoBanner.tsx'), 'utf8');
    for (const lang of LANGS) {
      // 소스 텍스트에 서버 DEFAULT copy 문자열이 그대로 존재해야 함
      expect(bannerSrc).toContain(DEFAULT_PROMO_CONFIG.copy[lang]);
    }
  });

  it('Firestore 읽기 실패 시에도 과장 문구가 재출현하지 않는다 (fail-safe = 정직 기본값)', async () => {
    vi.resetModules();
    const { getPromoConfig, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const throwingDb = {
      collection: () => ({ doc: () => ({ get: () => { throw new Error('boom'); } }) }),
    };
    const cfg = await getPromoConfig(throwingDb);
    for (const lang of LANGS) {
      for (const pat of STALE_BANNER_PATTERNS) {
        expect(cfg.copy[lang]).not.toMatch(pat);
      }
    }
    expect(cfg.endDate).not.toMatch(/6\/28/);
  });
});

describe('P0-C 운영 Firestore 구형 문구 정규화 — 커스텀은 보존 (2026-08-10 P2 #1272)', () => {
  it('언어별 값이 정확히 구형 기본값(LEGACY_DEFAULT_PROMO_COPY)과 같으면 새 기본값으로 정규화된다', async () => {
    vi.resetModules();
    const { getPromoConfig, DEFAULT_PROMO_CONFIG, LEGACY_DEFAULT_PROMO_COPY, __resetPromoConfigCache } =
      await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const dbWithLegacyCopy = {
      collection: () => ({
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ copy: LEGACY_DEFAULT_PROMO_COPY }) }),
        }),
      }),
    };
    const cfg = await getPromoConfig(dbWithLegacyCopy);
    for (const lang of LANGS) {
      expect(cfg.copy[lang]).toBe(DEFAULT_PROMO_CONFIG.copy[lang]);
      expect(cfg.copy[lang]).not.toMatch(/\bAI\b/);
    }
  });

  it('구형 기본값과 다른(운영자 커스텀) 문구는 절대 덮어쓰지 않는다', async () => {
    vi.resetModules();
    const { getPromoConfig, __resetPromoConfigCache } = await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const customCopy = {
      ko: '운영자가 직접 쓴 문구', en: 'Operator-written copy', ja: '運営者が書いた文言', zh: '运营者自定义文案',
    };
    const dbWithCustomCopy = {
      collection: () => ({
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ copy: customCopy }) }),
        }),
      }),
    };
    const cfg = await getPromoConfig(dbWithCustomCopy);
    for (const lang of LANGS) {
      expect(cfg.copy[lang]).toBe(customCopy[lang]);
    }
  });

  it('언어 하나만 구형값이고 나머지는 커스텀이면, 그 언어만 정규화된다', async () => {
    vi.resetModules();
    const { getPromoConfig, DEFAULT_PROMO_CONFIG, LEGACY_DEFAULT_PROMO_COPY, __resetPromoConfigCache } =
      await import('../../api/_shared/promo-config.js');
    __resetPromoConfigCache();
    const mixedCopy = {
      ko: LEGACY_DEFAULT_PROMO_COPY.ko, // 구형 → 정규화 대상
      en: 'A custom English promo the operator wrote', // 커스텀 → 보존
      ja: LEGACY_DEFAULT_PROMO_COPY.ja,
      zh: '运营者自定义文案',
    };
    const db = {
      collection: () => ({
        doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ copy: mixedCopy }) }) }),
      }),
    };
    const cfg = await getPromoConfig(db);
    expect(cfg.copy.ko).toBe(DEFAULT_PROMO_CONFIG.copy.ko);
    expect(cfg.copy.ja).toBe(DEFAULT_PROMO_CONFIG.copy.ja);
    expect(cfg.copy.en).toBe(mixedCopy.en);
    expect(cfg.copy.zh).toBe(mixedCopy.zh);
  });
});

describe('P0-D 배너 긴급성 — endDate 없으면 붙지 않는다 (가짜 긴급성 금지)', () => {
  it('urgency() 는 endDate 가 없으면 즉시 빈 문자열을 반환하고, 4언어 폴백 긴급성 문구가 코드에 없다', () => {
    const bannerSrc = readFileSync(resolve(process.cwd(), 'src/components/PromoBanner.tsx'), 'utf8');
    // endDate 가 falsy 면 조건 분기 없이 바로 반환 — '선착순'류로 새는 경로가 없다.
    expect(bannerSrc).toMatch(/if \(!endDate\) return '';/);
    // 주석은 이 변경의 이력을 설명하려 해당 단어를 인용할 수 있으므로 제외하고, 실제 코드만 본다.
    const code = bannerSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const stale of ['선착순', '先着順', '限量', "' · limited'"]) {
      expect(code, `stale urgency word "${stale}" still present in code`).not.toContain(stale);
    }
  });

  it('endDate 가 있을 때의 4언어 마감 문구는 그대로 유지된다 (진짜 마감일은 표시)', () => {
    const bannerSrc = readFileSync(resolve(process.cwd(), 'src/components/PromoBanner.tsx'), 'utf8');
    expect(bannerSrc).toContain('마감`');
    expect(bannerSrc).toContain('まで`');
    expect(bannerSrc).toContain('截止`');
    expect(bannerSrc).toContain('ends ${endDate}');
  });
});

describe('P0-B 가입 모달 i18n — 실발급 3혜택·1년과 일치 (4언어)', () => {
  // ⚠️ '5% 쿠폰 2장' 자체는 사실(AI플랜 + 쿠폰 2장 = 3혜택) — 거짓은 "총혜택이 쿠폰 2장뿐" 주장.
  const STALE_MODAL_PATTERNS = [
    /90\s*days/i, /90일/, /90日/, /90\s*天/, // 실제 1년
    /2 welcome coupons/, /환영 쿠폰 2장/, /ウェルカムクーポン2枚/, /2 张欢迎优惠券/, // 총혜택=2장 주장
  ];

  for (const lang of LANGS) {
    it(`${lang}: welcomeModal* + couponValid 에 90일/2장 없음, 3혜택·1년·AI플랜 존재`, () => {
      const mp = readLocale(lang).mypage;
      const modalKeys = [
        'welcomeCouponsBody', 'welcomeModalCouponHeading', 'welcomeModalCoupon0',
        'welcomeModalCoupon1', 'welcomeModalCoupon2', 'welcomeModalExpiry',
        'welcomeModalBody', 'couponValid',
      ];
      for (const key of modalKeys) {
        expect(mp[key], `${lang}.mypage.${key} 누락`).toBeTypeOf('string');
        for (const pat of STALE_MODAL_PATTERNS) {
          expect(mp[key], `${lang}.mypage.${key} 에 낡은 문구`).not.toMatch(pat);
        }
      }
      // 1년 표기 존재
      expect(mp.welcomeModalExpiry).toMatch(/1\s*year|1년|1年|1\s*年/);
      // 첫 혜택 = AI 플랜 무료
      expect(mp.welcomeModalCoupon0).toMatch(/AI/);
    });
  }

  it('모달 컴포넌트 폴백 문자열에도 90 days/2 coupons 없음', () => {
    const modalSrc = readFileSync(resolve(process.cwd(), 'src/components/OnboardingCouponModal.tsx'), 'utf8');
    expect(modalSrc).not.toMatch(/90 days/);
    expect(modalSrc).not.toMatch(/2 welcome coupons/);
    // AI 플랜 pill 이 첫 혜택으로 존재
    expect(modalSrc).toMatch(/welcomeModalCoupon0/);
    expect(modalSrc).toMatch(/Valid for 1 year/);
  });
});

describe('P0-B 발급 상태 → 모달 노출 조건 (구조 가드)', () => {
  it('firebase.js 는 issued > 0 일 때만 모달 플래그를 세팅한다 (종료/기발급 시 모달 안 뜸)', () => {
    const fbSrc = readFileSync(resolve(process.cwd(), 'src/lib/firebase.js'), 'utf8');
    // setItem 이 issued > 0 가드 안에 있어야 함
    expect(fbSrc).toMatch(/json\.issued > 0/);
    expect(fbSrc).toMatch(/COCO_ONBOARDING_COUPONS_JUST_ISSUED/);
  });

  it('onboarding-coupons.js — 프로모 종료/기발급이면 issued:0 (모달 트리거 차단)', () => {
    const apiSrc = readFileSync(resolve(process.cwd(), 'api/onboarding-coupons.js'), 'utf8');
    expect(apiSrc).toMatch(/issued:\s*0,\s*promoClosed:\s*true/);
    expect(apiSrc).toMatch(/issued:\s*0,\s*alreadyIssued:\s*true/);
    // 실발급 3혜택·1년이 코드에 남아있는지 (문구의 근거)
    expect(apiSrc).toMatch(/issued:\s*3/);
    expect(apiSrc).toMatch(/365 \* 24 \* 3600 \* 1000/);
  });
});
