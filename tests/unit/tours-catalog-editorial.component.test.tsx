// @vitest-environment jsdom
/**
 * `/tours` 공개 목록 — 편집형 정리 회귀 잠금 (design/tours-catalog-editorial, 2026-08-11).
 *
 * #1279/#1280 이후 프로덕션에 남아 있던 P3 4건을 잠근다.
 *
 *   P3-1 카드 제목 `line-clamp-1`  — '한국 멀티시티 3일 2박 (서울·경주·부산)' 같은 제목이
 *                                    390/768/1440 어디서나 한 줄에서 잘려 상품을 식별할 수 없었다.
 *   P3-2 모바일 필터 칩 30~40px    — 터치 최소치(44px) 미달.
 *   P3-3 근거 없는 `Popular` 필터칩 — 집계가 없는 라벨이 공개 필터에 남아 있었다.
 *   P3-4 ko/ja/zh 영어 누출        — NIGHT / NATURE / HISTORY / MULTI-CITY / Fuel / Tolls / Parking.
 *
 * **왜 소스 문자열이 아니라 렌더인가**: #1276 의 F3(AI-CURATED)은 구현 상수가 맞는데도
 * 그 상수를 안 쓰는 두 번째 경로가 있어서 화면에는 그대로 찍혔다(tests/unit/public-ai-actor-copy
 * .component.test.tsx 참조). 그래서 여기서도 "화면에 뭐가 찍히나"로 잠근다.
 * 실제 픽셀 기하(44px·2줄·가로 넘침)는 jsdom 이 레이아웃을 계산하지 않으므로
 * `tests/e2e/tours-catalog-editorial.spec.ts` 가 390/768/1440 × 4언어로 따로 잰다.
 *
 * 동시에 **지우면 안 되는 것**도 잠근다 — 가격 문자열, 정당한 태그 배지, `tour.tags` 원본,
 * 어드민 태그 옵션, 태그 검색. 표시 정리가 상품 데이터를 갉아먹으면 안 된다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'fs';
import { resolve } from 'path';

void React;

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
type Lang = (typeof LANGS)[number];

/** ko/ja/zh 화면에 절대 남으면 안 되는 영어 원문. en 화면에서는 정상 문구라 검사하지 않는다. */
const ENGLISH_LEAK: RegExp[] = [
  /\bNIGHT\b/i,
  /NIGHT\s*TOUR/i,
  /\bNATURE\b/i,
  /\bHISTORY\b/i,
  /MULTI-?\s?CITY/i,
  /\bFuel\b/i,
  /\bTolls\b/i,
  /\bParking\b/i,
  /\bTips\b/i,
];

beforeAll(() => {
  if (!window.matchMedia) {
    // @ts-expect-error jsdom 폴리필
    window.matchMedia = (q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    });
  }
});

beforeEach(() => cleanup());

// ── 외부 의존(파이어베이스·리뷰 집계·계측)은 이 검증의 대상이 아니다 ──────────────────
vi.mock('../../src/components/WishlistButton', () => ({
  WishlistToggle: () => <button type="button" aria-label="wishlist" />,
}));
vi.mock('../../src/hooks/useTourRatingAggregates', () => ({ useTourRatingAggregates: () => ({}) }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../src/sections/Header', () => ({ Header: () => null }));
vi.mock('../../src/lib/analytics', () => ({ trackEvent: () => {} }));
vi.mock('../../src/lib/affiliateTracking', () => ({
  observeAffiliateImpression: () => () => {},
  trackAffiliateClick: () => {},
}));

const mockLanguage: { current: Lang } = { current: 'en' };
vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: mockLanguage.current, t: {}, changeLanguage: () => {} }),
}));

const { TourCard } = await import('../../src/components/tours/TourCard');
const { TOURS, publicBadgeTag, isUngroundedBadgeTag } = await import('../../src/data/tours');
const { matchesTourQuery } = await import('../../src/lib/tourSearch');
const ToursPage = (await import('../../src/pages/ToursPage')).default;

type Tour = (typeof TOURS)[number];

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

/** 태그만 바꾼 실제 상품 1건 — 필드를 손으로 지어내면 렌더가 실제와 달라진다. */
function tourWith(patch: Partial<Tour>): Tour {
  return { ...TOURS[0], ...patch } as Tour;
}

function renderCard(tour: Tour, language: Lang) {
  return render(<MemoryRouter><TourCard tour={tour} language={language} /></MemoryRouter>);
}

function cardText(tour: Tour, language: Lang): string {
  return renderCard(tour, language).container.textContent || '';
}

function renderPage(language: Lang) {
  mockLanguage.current = language;
  return render(<MemoryRouter initialEntries={['/tours']}><ToursPage /></MemoryRouter>);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('P3-1 카드 제목 — 최대 2줄, 높이 고정', () => {
  const src = read('src/components/tours/TourCard.tsx');
  const titleClass = (): string => {
    const { container } = renderCard(TOURS[0], 'ko');
    return container.querySelector('h3')?.className || '';
  };

  it('제목이 한 줄로 잘리지 않는다 (line-clamp-1 금지)', () => {
    // 소스 문자열이 아니라 렌더된 class 로 본다 — 주석에 적힌 `line-clamp-1` 은 설명이지 스타일이 아니다.
    expect(titleClass()).not.toMatch(/\bline-clamp-1\b/);
    const classAttrs = Array.from(src.matchAll(/className="([^"]*)"/g)).map((m) => m[1]);
    expect(classAttrs.filter((c) => /\bline-clamp-1\b/.test(c))).toHaveLength(0);
  });

  it('제목은 2줄까지 열린다', () => {
    expect(titleClass()).toMatch(/\bline-clamp-2\b/);
  });

  it('1줄 제목도 2줄 높이를 차지한다 — 카드 정렬이 제목 길이에 흔들리지 않게', () => {
    // 2.75em = leading-snug(1.375) × 2줄. em 이라 14px(모바일)/15px(데스크톱) 양쪽에서 같이 따라간다.
    expect(titleClass()).toMatch(/min-h-\[2\.75em\]/);
  });

  it('긴 제목을 말줄임·툴팁으로만 숨기지 않는다 (title 속성으로 대체 금지)', () => {
    const { container } = renderCard(TOURS[0], 'ko');
    const h3 = container.querySelector('h3');
    expect(h3?.getAttribute('title')).toBeNull();
    // 제목 본문은 DOM 에 통째로 들어 있다 — 자르기는 CSS 가 하고, 텍스트는 손대지 않는다.
    expect(h3?.textContent).toBe(TOURS[0].title.ko);
  });

  it('실제 상품 중 가장 긴 제목도 전문이 DOM 에 들어간다 (임의 축약 금지)', () => {
    for (const lang of LANGS) {
      const longest = [...TOURS].sort((a, b) => b.title[lang].length - a.title[lang].length)[0];
      const { container } = renderCard(longest, lang);
      expect(container.querySelector('h3')?.textContent, `${lang}: ${longest.id}`).toBe(longest.title[lang]);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P3-4 카드 태그·포함 배지 — ko/en/ja/zh 현지화, 영어 폴백 누출 0', () => {
  /** 카드 배지로 실제 렌더될 수 있는 태그 = 근거 없는 3개를 뺀 나머지. */
  const RENDERABLE = ['New', 'Multi-City', 'Night Tour', 'Nature', 'History'] as const;

  const EXPECTED: Record<(typeof RENDERABLE)[number], Record<Lang, string>> = {
    New:          { ko: '신규',      en: 'NEW',        ja: '新着',       zh: '新品' },
    'Multi-City': { ko: '다도시',    en: 'MULTI-CITY', ja: '複数都市',   zh: '多城市' },
    'Night Tour': { ko: '야경 투어', en: 'NIGHT TOUR', ja: '夜景ツアー', zh: '夜景游' },
    Nature:       { ko: '자연',      en: 'NATURE',     ja: '自然',       zh: '自然' },
    History:      { ko: '역사·문화', en: 'HISTORY',    ja: '歴史・文化', zh: '历史文化' },
  };

  for (const tag of RENDERABLE) {
    for (const lang of LANGS) {
      it(`${tag} 배지가 ${lang} 로 찍힌다`, () => {
        const text = cardText(tourWith({ tags: [tag] as Tour['tags'], isNightTour: false }), lang);
        expect(text).toContain(EXPECTED[tag][lang]);
      });
    }
  }

  for (const lang of ['ko', 'ja', 'zh'] as const) {
    it(`${lang} — 정당한 태그를 가진 실제 상품 전부에서 영어 원문이 하나도 안 새어 나온다`, () => {
      for (const tour of TOURS) {
        const text = cardText(tour, lang);
        for (const leak of ENGLISH_LEAK) {
          expect(text, `${tour.id} / ${lang}: ${leak}`).not.toMatch(leak);
        }
        cleanup();
      }
    });

    it(`${lang} — 실제 공통 포함 항목(연료비·톨비·주차비)이 현지 표기로 3개 다 나온다`, () => {
      const included: Record<typeof lang, string[]> = {
        ko: ['연료비', '톨비', '주차비'],
        ja: ['燃料費', '通行料', '駐車場'],
        zh: ['燃油费', '过路费', '停车费'],
      };
      const text = cardText(TOURS[0], lang);
      for (const label of included[lang]) expect(text).toContain(label);
    });
  }

  it('en 은 실제 공통 포함 항목만 표시한다 (Fuel/Tolls/Parking)', () => {
    const text = cardText(TOURS[0], 'en');
    for (const label of ['Fuel', 'Tolls', 'Parking']) expect(text).toContain(label);
    expect(text).not.toContain('Tips');
  });

  it('카드 링크 안에 위시리스트 버튼을 중첩하지 않는다', () => {
    const { container } = renderCard(TOURS[0], 'en');
    expect(container.querySelector('.tour-catalog-card')).toBeTruthy();
    expect(container.querySelector('.tour-catalog-card-link')).toBeTruthy();
    expect(container.querySelector('.tour-catalog-card-link button')).toBeNull();
    expect(container.querySelector('.tour-catalog-card > .tour-catalog-card-wishlist button')).toBeTruthy();
  });

  it('이미지 수와 카드 핵심 사실에 4언어 접근성 이름을 제공한다', () => {
    const imageLabels: Record<Lang, string> = {
      ko: '이미지 2장',
      en: '2 images',
      ja: '画像2枚',
      zh: '2张图片',
    };
    const factLabels: Record<Lang, string[]> = {
      ko: ['소요 시간', '차량 및 정원'],
      en: ['Duration', 'Vehicle and capacity'],
      ja: ['所要時間', '車両・定員'],
      zh: ['行程时长', '车辆及人数'],
    };

    for (const lang of LANGS) {
      const { container } = renderCard(tourWith({ images: ['one.jpg', 'two.jpg'] }), lang);
      expect(container.querySelector('.tour-catalog-card-image-count')).toHaveAttribute('aria-label', imageLabels[lang]);
      expect(Array.from(container.querySelectorAll('.tour-catalog-card-facts dt .sr-only')).map((node) => node.textContent)).toEqual(factLabels[lang]);
      cleanup();
    }
  });

  it('사전에 없는 태그는 배지를 안 만든다 — 영어 원문이 새는 대신 미렌더', () => {
    // 어드민이 자유 문자열을 넣어도 화면에 영어 원문이 찍히지 않는다.
    const text = cardText(tourWith({ tags: ['Hidden Gem'] as unknown as Tour['tags'] }), 'ko');
    expect(text).not.toMatch(/Hidden Gem/i);
  });

  it('야간 투어는 같은 말을 두 번 하지 않는다 (야경 배지 + 야경 투어 태그 중복 제거)', () => {
    const night = tourWith({ tags: ['Night Tour'] as Tour['tags'], isNightTour: true });
    for (const lang of LANGS) {
      const text = cardText(night, lang);
      const nightWord = { ko: '야경', en: 'NIGHT', ja: '夜景', zh: '夜景' }[lang];
      const hits = text.split(nightWord).length - 1;
      // 상품 제목에도 '야경/NIGHT' 이 들어갈 수 있으므로 배지 영역만 세지 않고 상한만 잠근다.
      expect(hits, `${lang}: '${nightWord}' ${hits}회`).toBeLessThanOrEqual(1);
      cleanup();
    }
  });

  it('가격·상품 의미는 그대로다 (표시 정리가 상품 정보를 지우면 안 된다)', () => {
    for (const lang of LANGS) {
      const text = cardText(TOURS[0], lang);
      expect(text).toContain(`$${TOURS[0].priceFrom.toLocaleString()}`);
      expect(text).toContain('USD');
      expect(text).toContain(TOURS[0].title[lang]);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P3-3 공개 필터 — 근거 없는 Popular 칩 0, 원본 데이터는 보존', () => {
  /** 칩 라벨은 정확 일치로 본다 — en 의 'Popular Destinations' 섹션 제목까지 잡으면 안 된다. */
  const POPULAR_CHIP: Record<Lang, string> = { ko: '인기', en: 'Popular', ja: '人気', zh: '热门' };

  for (const lang of LANGS) {
    it(`${lang} — Popular 필터칩이 화면에 0개다`, () => {
      const { container } = renderPage(lang);
      const chipLabels = Array.from(container.querySelectorAll('button.tour-chip'))
        .map((b) => (b.textContent || '').trim());
      expect(chipLabels).not.toContain(POPULAR_CHIP[lang]);
    });

    it(`${lang} — AI-CURATED / Best Value 공개 노출도 0 상태를 유지한다`, () => {
      const text = renderPage(lang).container.textContent || '';
      expect(text).not.toMatch(/AI-?\s?CURATED/i);
      expect(text).not.toMatch(/BEST\s?VALUE/i);
    });

    it(`${lang} — 정당한 관심사 칩 4종은 그대로 남는다 (필터를 죽이지 않았다)`, () => {
      const chipLabels = Array.from(renderPage(lang).container.querySelectorAll('button.tour-chip'))
        .map((b) => (b.textContent || '').trim());
      const expected: Record<Lang, string[]> = {
        ko: ['자연', '역사·문화', '야경', '다도시'],
        en: ['Nature', 'History', 'Night view', 'Multi-city'],
        ja: ['自然', '歴史・文化', '夜景', '複数都市'],
        zh: ['自然', '历史文化', '夜景', '多城市'],
      };
      for (const label of expected[lang]) expect(chipLabels, `${lang}: ${label}`).toContain(label);
    });
  }

  it('칩 목록이 근거 없는 태그를 원천 차단한다 (카드 배지와 같은 SSOT)', () => {
    for (const tag of ['Popular', 'Best Value', 'AI-Curated', 'popular', 'best-value', 'AI Curated']) {
      expect(isUngroundedBadgeTag(tag), tag).toBe(true);
    }
    for (const tag of ['Nature', 'History', 'Night Tour', 'Multi-City', 'New']) {
      expect(isUngroundedBadgeTag(tag), tag).toBe(false);
    }
    expect(publicBadgeTag(['Popular', 'Nature'])).toBe('Nature');
  });

  it('원본 tour.tags 는 안 지웠다 — 상품 데이터에 Popular 가 그대로 있다', () => {
    const tagged = TOURS.filter((t) => (t.tags as string[]).includes('Popular'));
    expect(tagged.length, '데이터에서 Popular 를 지워버리면 어드민·검색이 같이 죽는다').toBeGreaterThan(0);
  });

  it('어드민 태그 편집 옵션에 Popular 가 남아 있다', () => {
    expect(read('src/components/admin/ProductEditor/BasicInfoTab.tsx')).toMatch(/'Popular'/);
  });

  it('태그 검색은 계속 Popular 로 매칭된다', () => {
    const tagged = TOURS.find((t) => (t.tags as string[]).includes('Popular'))!;
    expect(matchesTourQuery(tagged, 'popular')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('P3-2 터치 영역 — 조작 가능한 칩·버튼 44px 선언', () => {
  // 실제 픽셀 높이는 e2e(tests/e2e/tours-catalog-editorial.spec.ts)가 브라우저에서 잰다.
  // 여기서는 "44 미만 최소높이 선언이 다시 들어오지 않는지"만 소스로 잠근다.
  const src = read('src/pages/ToursPage.tsx');

  it('ToursPage 에 44px 미만 min-h 선언이 남아 있지 않다', () => {
    const smaller = Array.from(src.matchAll(/min-h-\[(\d+(?:\.\d+)?)px\]/g))
      .map((m) => Number(m[1]))
      .filter((px) => px < 44);
    expect(smaller, `44px 미만 min-h: ${smaller.join(', ')}`).toHaveLength(0);
  });

  it('모든 tour-chip 이 min-h-[44px] 를 달고 렌더된다', () => {
    for (const lang of LANGS) {
      const chips = Array.from(renderPage(lang).container.querySelectorAll('button.tour-chip'));
      expect(chips.length, `${lang}: 칩이 하나도 없다`).toBeGreaterThan(0);
      for (const chip of chips) {
        expect(chip.className, `${lang}: "${chip.textContent}"`).toMatch(/min-h-\[44px\]/);
      }
      cleanup();
    }
  });

  it('토글 칩은 상태를 aria-pressed 로 노출한다 (스크린리더가 선택 여부를 읽을 수 있게)', () => {
    const chips = Array.from(renderPage('ko').container.querySelectorAll('button.tour-chip'));
    for (const chip of chips) {
      expect(chip.getAttribute('aria-pressed'), `"${chip.textContent}"`).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('편집형 SSOT — 로고 외 gradient/glow/glass 추가 금지', () => {
  it('이번 변경이 카드/목록에 새 gradient·glow 를 늘리지 않았다', () => {
    // 기존 다크 시스템의 그라디언트는 그대로 두되(이 PR 은 표시·접근성 정리 범위),
    // 새로 추가된 배경 그라디언트가 없는지 개수로 잠근다. 늘리려면 이 숫자부터 마주하게 된다.
    const cardSrc = read('src/components/tours/TourCard.tsx');
    const gradients = (cardSrc.match(/linear-gradient/g) || []).length;
    expect(gradients, 'TourCard 의 gradient 개수가 늘었다').toBeLessThanOrEqual(3);
    expect(cardSrc).not.toMatch(/box-shadow:\s*0 0 \d+px/);
  });

  it('framer-motion 을 새로 끌어오지 않았다', () => {
    expect(read('src/components/tours/TourCard.tsx')).not.toMatch(/framer-motion/);
    expect(read('src/pages/ToursPage.tsx')).not.toMatch(/framer-motion/);
  });

  it('지역·필터·목록·문의 섹션 표기를 네 언어로 제공한다', () => {
    const pageSrc = read('src/pages/ToursPage.tsx');
    expect(pageSrc).toContain("indexLabel: 'CocoTrip 地域案内'");
    expect(pageSrc).toContain("selectorLabel: 'CocoTrip 日程検索'");
    expect(pageSrc).toContain("catalogueSectionLabel: 'CocoTrip 旅游列表'");
    expect(pageSrc).toContain("conciergeLabel: 'CocoTrip 定制咨询'");
    expect(pageSrc).toContain('{tl.indexLabel}');
    expect(pageSrc).toContain('{tl.selectorLabel}');
    expect(pageSrc).toContain('{tl.catalogueSectionLabel}');
    expect(pageSrc).toContain('{tl.conciergeLabel}');
  });
});

describe('목록 전체 — Korea Editorial Concierge 문서형 셸', () => {
  const pageSrc = read('src/pages/ToursPage.tsx');
  const cardSrc = read('src/components/tours/TourCard.tsx');

  it('공용 편집형 토큰을 쓰는 전용 셸과 스타일시트를 연결한다', () => {
    const { container } = renderPage('ko');
    const shell = container.querySelector('[data-testid="tours-editorial-shell"]');

    expect(shell).not.toBeNull();
    expect(shell?.className).toMatch(/\bec-root\b/);
    expect(shell?.className).toMatch(/\btours-catalog-editorial\b/);
    expect(pageSrc).toMatch(/editorial-tours-catalog\.css/);
  });

  it('이전 refined 다크 셸과 페이지·카드 장식용 gradient/glow/glass를 제거한다', () => {
    expect(pageSrc).not.toMatch(/refined-tours|tours-shimmer|linear-gradient|boxShadow|backdrop-blur/);
    expect(cardSrc).not.toMatch(/linear-gradient|boxShadow|backdrop-blur|onMouseEnter|onMouseLeave/);
  });

  it('필터는 제목이 있는 의미 단위이고 결과 목록은 main 안에 있다', () => {
    const { container } = renderPage('en');
    const main = container.querySelector('main');
    const panel = container.querySelector('[data-testid="tours-filter-panel"]');

    expect(main).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('fieldset').length).toBeGreaterThanOrEqual(4);
    expect(panel?.querySelectorAll('legend').length).toBeGreaterThanOrEqual(4);
    expect(main?.querySelector('[data-testid="tours-grid"]')).not.toBeNull();
  });

  it('근거 없는 인기 목적지 주장을 지역 탐색 안내로 바꾼다', () => {
    const text = renderPage('en').container.textContent || '';
    expect(text).toContain('Browse by destination');
    expect(text).not.toContain('Popular Destinations');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * 모바일 발견 비용 — 필터 바텀시트 (design/tours-mobile-discovery, 2026-08-16).
 *
 * 첫 실제 상품까지의 스크롤을 줄이려고 모바일에서는 필터 본문을 접고
 * 네이티브 `<dialog>` 바텀시트로 옮겼다. 여기서 잠그는 건 **계약**이다 —
 * 실제 픽셀(첫 상품 <=950px, 44px, 16px, Escape, backdrop)은 jsdom 이 레이아웃을
 * 계산하지 못하므로 tests/e2e/tours-catalog-editorial.spec.ts 가 360/390 × 4언어로 잰다.
 *
 * jsdom 의 `<dialog>` 지원 수준에 기대지 않으려고 showModal/close 를 스텁으로 갈아끼운다.
 * 스텁은 실제 브라우저와 같은 순서로 `close` 이벤트를 쏜다 — Escape 든 닫기 버튼이든
 * backdrop 이든, 초점 복귀는 전부 그 이벤트 하나를 타고 돌아온다.
 */
describe('모바일 필터 시트 — 네이티브 dialog 계약', () => {
  const pageSrc = read('src/pages/ToursPage.tsx');
  const cssSrc = read('src/styles/editorial-tours-catalog.css');

  const TRIGGER_LABEL: Record<Lang, string> = {
    ko: '필터',
    en: 'Filters',
    ja: 'フィルター',
    zh: '筛选',
  };
  const CLOSE_LABEL: Record<Lang, string> = {
    ko: '필터 닫기',
    en: 'Close filters',
    ja: 'フィルターを閉じる',
    zh: '关闭筛选',
  };

  /** jsdom 버전과 무관하게 네이티브 dialog API 호출 자체를 관찰한다. */
  function stubDialog() {
    const proto = window.HTMLDialogElement.prototype;
    if (typeof proto.showModal !== 'function') proto.showModal = function () {};
    if (typeof proto.close !== 'function') proto.close = function () {};

    const showModal = vi.spyOn(proto, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    const close = vi.spyOn(proto, 'close').mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
    return { showModal, close };
  }

  const q = (container: HTMLElement, testId: string) =>
    container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  afterEach(() => vi.restoreAllMocks());

  for (const lang of LANGS) {
    it(`${lang} — 필터 열기/닫기 라벨이 현지 표기로 나온다`, () => {
      stubDialog();
      const { container } = renderPage(lang);

      const trigger = q(container, 'tours-filter-trigger');
      expect(trigger, `${lang}: 필터 트리거가 없다`).not.toBeNull();
      expect(trigger?.getAttribute('aria-label')).toBe(TRIGGER_LABEL[lang]);
      expect(trigger?.textContent).toContain(TRIGGER_LABEL[lang]);

      const close = q(container, 'tours-filter-dialog-close');
      expect(close?.getAttribute('aria-label')).toBe(CLOSE_LABEL[lang]);
    });
  }

  it('필터 본문은 네이티브 <dialog> 안에 있고 제목과 연결된다 (커스텀 오버레이 아님)', () => {
    stubDialog();
    const { container } = renderPage('ko');
    const dialog = q(container, 'tours-filter-dialog');

    expect(dialog?.tagName).toBe('DIALOG');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('tours-filter-dialog-title');
    expect(container.querySelector('#tours-filter-dialog-title')?.textContent).toBeTruthy();
    // 직접 만든 모달 스택(portal/backdrop div/body lock)을 다시 들이지 않는다.
    expect(pageSrc).not.toMatch(/createPortal|role="dialog"|aria-modal/);
  });

  it('트리거는 showModal() 로 열고, 닫기 버튼은 close() 로 닫는다', () => {
    const spies = stubDialog();
    const { container } = renderPage('en');
    const dialog = q(container, 'tours-filter-dialog');

    expect(dialog?.hasAttribute('open')).toBe(false);
    fireEvent.click(q(container, 'tours-filter-trigger') as HTMLElement);
    expect(spies.showModal).toHaveBeenCalledTimes(1);
    expect(dialog?.hasAttribute('open')).toBe(true);

    fireEvent.click(q(container, 'tours-filter-dialog-close') as HTMLElement);
    expect(spies.close).toHaveBeenCalledTimes(1);
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('backdrop(=dialog 자기 자신) 클릭은 닫고, 시트 내부 클릭은 안 닫는다', () => {
    const spies = stubDialog();
    const { container } = renderPage('en');
    const dialog = q(container, 'tours-filter-dialog') as HTMLElement;

    fireEvent.click(q(container, 'tours-filter-trigger') as HTMLElement);
    spies.close.mockClear();

    fireEvent.click(q(container, 'tours-filter-dialog-body') as HTMLElement);
    expect(spies.close, '시트 안을 눌렀는데 닫혔다').not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(spies.close, 'backdrop 을 눌렀는데 안 닫혔다').toHaveBeenCalledTimes(1);
  });

  it('닫힘 이벤트 하나로 초점이 트리거로 돌아온다 (Escape·버튼·backdrop 공통 경로)', () => {
    stubDialog();
    const { container } = renderPage('en');
    const trigger = q(container, 'tours-filter-trigger') as HTMLElement;
    const dialog = q(container, 'tours-filter-dialog') as HTMLElement;

    fireEvent.click(trigger);
    (q(container, 'tours-filter-dialog-close') as HTMLElement).focus();
    expect(document.activeElement).not.toBe(trigger);

    // 브라우저에서 Escape 가 쏘는 것과 같은 이벤트. 실제 Escape 키 자체는 e2e 가 잰다.
    dialog.dispatchEvent(new Event('close'));
    expect(document.activeElement, 'dialog 닫힘 후 초점이 필터 버튼으로 안 돌아왔다').toBe(trigger);

    // ref 로 잡고 close 이벤트로 되돌린다 — 이 패턴이 사라지면 위 단언이 먼저 깨진다.
    expect(pageSrc).toMatch(/useRef<HTMLDialogElement>\(null\)/);
    expect(pageSrc).toMatch(/useRef<HTMLButtonElement>\(null\)/);
    expect(pageSrc).toMatch(/addEventListener\('close'/);
    expect(pageSrc).toMatch(/removeEventListener\('close'/);
  });

  it('활성 필터 개수는 저장하지 않고 기존 필터 상태에서 파생한다', () => {
    stubDialog();
    const { container } = renderPage('ko');

    expect(q(container, 'tours-filter-count'), '초기 상태인데 활성 배지가 있다').toBeNull();

    // 관심사 칩 = 순수 토글. 가격·상품 의미는 안 건드리고 활성 개수만 움직인다.
    const body = q(container, 'tours-filter-dialog-body') as HTMLElement;
    const interest = body.querySelectorAll('fieldset')[2];
    const chip = interest.querySelector('button.tour-chip') as HTMLElement;

    fireEvent.click(chip);
    expect(q(container, 'tours-filter-count')?.textContent).toBe('1');

    fireEvent.click(chip);
    expect(q(container, 'tours-filter-count'), '해제했는데 배지가 남았다 — 파생 상태가 아니다').toBeNull();

    // useState 로 개수를 따로 들고 있으면 두 소스가 어긋난다.
    expect(pageSrc).toMatch(/const activeFilterCount =/);
    expect(pageSrc).not.toMatch(/setActiveFilterCount/);
  });

  it('필터 필드는 렌더러 하나를 데스크톱 패널과 시트가 같이 쓴다 (복붙 2벌 금지)', () => {
    stubDialog();
    const { container } = renderPage('en');

    expect((pageSrc.match(/const renderFilterFields =/g) || []).length).toBe(1);
    expect((pageSrc.match(/\{renderFilterFields\(\)\}/g) || []).length).toBe(2);

    const panelLegends = Array.from(
      (q(container, 'tours-filter-panel') as HTMLElement).querySelectorAll('legend'),
    ).map((node) => node.textContent);
    const sheetLegends = Array.from(
      (q(container, 'tours-filter-dialog-body') as HTMLElement).querySelectorAll('legend'),
    ).map((node) => node.textContent);

    expect(sheetLegends.length).toBeGreaterThanOrEqual(4);
    expect(sheetLegends).toEqual(panelLegends);
  });

  it('시트 본문의 overflow-y 가 실제로 스크롤된다 (죽은 스크롤 금지)', () => {
    // max-height + overflow:hidden 인 dialog 가 block 이면 본문 높이가 내용 전체라
    // 스크롤 여백이 0 이고 꼬리(주행 언어·정렬)가 잘려 나간다. 실제 픽셀은 e2e 가 잰다 —
    // 여기서는 그걸 가능하게 하는 선언 4개(flex 열 / 머리말 고정 / min-height:0 / overflow-y)를 잠근다.
    /** 셀렉터로 선언 블록 하나를 꺼낸다 — 선언 순서·줄바꿈에 흔들리지 않게. */
    const block = (selector: string): string => {
      const start = cssSrc.indexOf(`${selector} {`);
      expect(start, `${selector} 규칙이 없다`).toBeGreaterThanOrEqual(0);
      return cssSrc.slice(start, cssSrc.indexOf('}', start));
    };

    const dialog = block('.tours-catalog-filter-dialog');
    expect(dialog, '본문 높이를 제한할 max-height 가 없다').toMatch(/max-height:/);
    expect(dialog).toMatch(/display:\s*flex/);
    expect(dialog, 'flex 열이 아니면 본문이 줄어들 축이 없다').toMatch(/flex-direction:\s*column/);
    // display:flex 를 넣어도 닫힌 시트는 계속 숨어 있어야 한다(:not([open]) 이 더 구체적).
    expect(block('.tours-catalog-filter-dialog:not([open])')).toMatch(/display:\s*none/);

    expect(
      block('.tours-catalog-filter-dialog-head'),
      '머리말이 줄어들면 닫기 버튼이 44px 아래로 눌린다',
    ).toMatch(/flex-shrink:\s*0/);

    const body = block('.tours-catalog-filter-dialog-body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body, 'min-height:0 없이는 flex 자식이 안 줄어들어 overflow-y 가 죽는다').toMatch(/min-height:\s*0/);

    // 스크롤을 JS 로 흉내 내지 않는다 — 네이티브 dialog + CSS 만 쓴다.
    expect(pageSrc, 'body scroll lock 을 JS 로 다시 들였다').not.toMatch(/body\.style\.overflow/);
  });

  it('시트를 들이면서 nullish 병합 연산자·로고 밖 gradient·glow·glass 를 늘리지 않았다', () => {
    const nullishCoalescing = String.fromCharCode(63, 63);
    expect(pageSrc, 'ToursPage 에 nullish 병합 연산자가 새로 들어왔다').not.toMatch(
      new RegExp(`\\${nullishCoalescing[0]}\\${nullishCoalescing[1]}`),
    );
    expect(cssSrc, '로고 밖 gradient').not.toMatch(/(linear|radial|conic)-gradient\s*\(/);
    expect(cssSrc, 'glow').not.toMatch(/box-shadow:\s*0\s+0\s+[1-9]/);
    expect(cssSrc, 'glass').not.toMatch(/backdrop-filter|blur\(/);
    expect(pageSrc).not.toMatch(/framer-motion/);
  });

  it('모바일 바가 데스크톱 필터 패널·필드를 대체하지 않는다 (>=768 은 그대로)', () => {
    // 데스크톱은 바를 숨기고 필드를 그대로 보여준다 — 실제 가시성은 e2e 768/1440 이 잰다.
    expect(cssSrc).toMatch(/\.tours-catalog-filter-bar \{\s*display: none;/);
    expect(cssSrc).toMatch(/@media \(max-width: 767px\)/);
    // 시트 트리거는 필터 패널 안에 남는다 — 기존 legend/fieldset 계약과 같은 자리.
    const { container } = renderPage('en');
    const panel = q(container, 'tours-filter-panel') as HTMLElement;
    expect(panel.querySelector('[data-testid="tours-filter-trigger"]')).not.toBeNull();
  });
});
