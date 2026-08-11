// @vitest-environment jsdom
/**
 * 공개 화면에서 AI 를 "서비스 행위자"로 내세우지 않는다 — 렌더 수준 잠금 (2026-08-11).
 *
 * 배경: PR #1276 은 홈·마이페이지·투어 배지의 무근거/AI 브랜딩을 정리했지만, 라이브
 * 4언어 검증(PROD-VERIFY-1276)에서 3곳이 남았다.
 *   F1 `/map` 로그아웃 안내      — "Your AI itinerary routes are saved…"
 *   F2 `/region/:id` SEO 본문+FAQ — "AI itinerary — get a plan…" (JSON-LD 로 구글에도 갔다)
 *   F3 `/tours` 카드 배지         — `AI-CURATED` (#1276 의 필터에 이 태그가 빠져 있었다)
 *
 * 이 파일이 소스 문자열 대신 **렌더 결과**를 보는 이유: F3 은 구현 문자열
 * (`UNGROUNDED_BADGE_TAGS = new Set([...])`) 을 그대로 통과했다. 상수가 맞아도 그 상수를
 * 안 쓰는 두 번째 카드가 있으면 화면에는 그대로 나온다. 그래서 "화면에 뭐가 찍히나" 로 잠근다.
 *
 * 동시에 **지우면 안 되는 것**도 같이 잠근다 — 가격 문자열($9.90), 무료 개요, 정당한
 * 실제 태그(History/Nature/Multi-City). 진실성 청소가 상품 정보를 갉아먹으면 안 된다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

void React;

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
type Lang = (typeof LANGS)[number];

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

// ── 외부 의존(파이어베이스·리뷰 집계·지도 청크)은 이 검증의 대상이 아니다 ──────────────
vi.mock('../../src/components/WishlistButton', () => ({ WishlistToggle: () => null }));
vi.mock('../../src/hooks/useTourRatingAggregates', () => ({ useTourRatingAggregates: () => ({}) }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../src/sections/Header', () => ({ Header: () => null }));
vi.mock('../../src/sections/Footer', () => ({ Footer: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/DayRouteMap', () => ({ DayRouteMap: () => null }));

const mockAuthUser: { current: { uid: string } | null } = { current: null };
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: mockAuthUser.current }) }));

const mockLanguage: { current: Lang } = { current: 'en' };
vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: mockLanguage.current, t: {}, changeLanguage: () => {} }),
}));

// 로그인 상태에서 "플랜 0건" 을 재현한다 (MapPage 의 noPlansBody 분기).
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  doc: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => undefined }),
  getDocs: async () => ({ docs: [] as unknown[] }),
  limit: () => ({}),
  orderBy: () => ({}),
  query: () => ({}),
}));

const { TourCard } = await import('../../src/components/tours/TourCard');
const { TOURS } = await import('../../src/data/tours');
const { RegionSeoInfo } = await import('../../src/components/region/RegionSeoInfo');
const MapPage = (await import('../../src/pages/MapPage')).default;

type Tour = (typeof TOURS)[number];

/** 태그만 바꾼 실제 상품 1건 — 필드를 손으로 지어내면 렌더가 실제와 달라진다. */
function tourWithTags(tags: string[]): Tour {
  return { ...TOURS[0], tags: tags as Tour['tags'] };
}

function cardText(tags: string[], language: Lang = 'en'): string {
  const { container } = render(
    <MemoryRouter><TourCard tour={tourWithTags(tags)} language={language} /></MemoryRouter>,
  );
  return container.textContent || '';
}

// ─────────────────────────────────────────────────────────────────────────────
describe('F3 — /tours 카드 배지: AI-Curated 는 렌더되지 않는다', () => {
  it('AI-Curated 만 남으면 배지 자체가 없다 (Popular/Best Value 와 같은 취급)', () => {
    // `/AI/i` 는 못 쓴다 — 카드의 "View Det**ai**ls" 에 걸린다. 단어 경계로 본다.
    expect(cardText(['Popular', 'AI-Curated'])).not.toMatch(/\bAI\b/);
    expect(cardText(['Popular', 'AI-Curated'])).not.toMatch(/CURATED|POPULAR/i);
    expect(cardText(['Best Value', 'AI-Curated'])).not.toMatch(/CURATED|BEST VALUE/i);
  });

  it('대소문자·공백·하이픈·언더스코어 변형도 전부 막는다 (값이 어드민 입력에서 온다)', () => {
    // 실측 F3 의 원인은 정확 문자열 Set 이었다. 상품 데이터가 'AI Curated' 로 저장되면
    // 그 Set 은 그냥 통과시키고 카드에는 다시 AI 가 찍힌다.
    for (const variant of ['AI Curated', 'ai-curated', 'AI_CURATED', 'aicurated', ' AI-Curated ']) {
      expect(cardText([variant]), `변형 통과: ${variant}`).not.toMatch(/curated/i);
    }
    for (const variant of ['popular', 'POPULAR', 'Best  Value', 'best-value']) {
      expect(cardText([variant]), `변형 통과: ${variant}`).not.toMatch(/popular|best/i);
    }
  });

  it('정당한 실제 태그는 그대로 배지로 남는다 (청소가 상품 정보를 지우면 안 된다)', () => {
    expect(cardText(['Popular', 'AI-Curated', 'History'])).toContain('HISTORY');
    expect(cardText(['Nature'])).toContain('NATURE');
    expect(cardText(['Multi-City'])).toContain('MULTI-CITY');
  });

  it('배지가 사라져도 카드의 상품 정보(제목·가격)는 남는다', () => {
    const text = cardText(['Popular', 'AI-Curated']);
    expect(text).toContain(TOURS[0].title.en);
    expect(text).toContain(`$${TOURS[0].priceFrom.toLocaleString()}`);
  });

  it('실제 상품 데이터로 렌더해도 AI 배지가 하나도 안 나온다 (라이브 재현)', () => {
    // 라이브 실측: 카드 2장에 AI-CURATED. 정적 상품 목록 전체를 그대로 렌더해서 확인한다.
    const withAiTag = TOURS.filter((t) => (t.tags as string[]).some((x) => /ai/i.test(x)));
    expect(withAiTag.length, '상품 데이터에 AI-Curated 태그가 하나도 없다면 이 검사는 무의미하다').toBeGreaterThan(0);
    for (const tour of TOURS) {
      const { container } = render(
        <MemoryRouter><TourCard tour={tour} language="en" /></MemoryRouter>,
      );
      expect(container.textContent || '', `${tour.id} 카드에 AI 배지`).not.toMatch(/AI-?\s?CURATED/i);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/** 언어별 "AI 가 행위자" 표기. 한국어·일본어·중국어는 단어 경계가 없어 접두 그대로 본다. */
const AI_ACTOR: Record<Lang, RegExp[]> = {
  en: [/\bAI\b/, /AI itinerary/i, /AI planner/i, /AI-powered/i],
  ko: [/AI/, /AI가/, /AI 일정/],
  ja: [/AI/, /AIプラン/, /AI 旅程/],
  zh: [/AI/, /AI\s*行程/, /AI\s*规划/],
};

/** 지역 페이지가 **대신** 말해야 하는 것 — 한국 현지 데이터 · 실제 경로 · 여행 조건 · 일정. */
const REGION_MEANING: Record<Lang, RegExp[]> = {
  en: [/Korean local data/, /real subway and bus routes/, /city, dates and trip conditions/, /itinerar/i],
  ko: [/한국 현지 데이터/, /지하철·버스 실제 경로/, /도시·날짜·여행 조건/, /일정/],
  ja: [/韓国の現地データ/, /地下鉄・バスの実際のルート/, /都市・日程・旅行条件/, /旅程/],
  zh: [/韩国本地数据/, /地铁和公交实际路线/, /城市、日期和出行条件/, /行程/],
};

/** 결제·상품 의미는 한 글자도 바뀌면 안 된다 — 가격 문자열과 "개요는 무료". */
const REGION_COMMERCE: Record<Lang, RegExp[]> = {
  en: [/\$9\.90/, /the outline preview is free/],
  ko: [/\$9\.90/, /뼈대 미리보기는 무료입니다/],
  ja: [/\$9\.90/, /骨組みのプレビューは無料です/],
  zh: [/\$9\.90/, /框架预览免费/],
};

function regionText(regionId: string, language: Lang): string {
  const { container } = render(
    <RegionSeoInfo regionId={regionId} regionTitle="Seoul" language={language} />,
  );
  return container.textContent || '';
}

describe('F2 — /region/:id 본문·FAQ: AI 행위자 표기 없음, 가격/무료 개요는 보존', () => {
  for (const lang of LANGS) {
    it(`${lang} — 본문 어디에도 AI 를 행위자로 쓰지 않는다`, () => {
      const text = regionText('seoul', lang);
      for (const pattern of AI_ACTOR[lang]) expect(text, `${lang}: ${pattern}`).not.toMatch(pattern);
    });

    it(`${lang} — 한국 현지 데이터·실제 지하철/버스 경로·여행 조건 의미가 남아 있다`, () => {
      const text = regionText('seoul', lang);
      for (const pattern of REGION_MEANING[lang]) expect(text, `${lang}: ${pattern}`).toMatch(pattern);
    });

    it(`${lang} — 가격 $9.90 과 무료 개요 표기가 그대로다`, () => {
      const text = regionText('seoul', lang);
      for (const pattern of REGION_COMMERCE[lang]) expect(text, `${lang}: ${pattern}`).toMatch(pattern);
    });
  }

  it('플래너 대상이 아닌 도시(전주)도 AI 를 행위자로 쓰지 않는다 (else 분기)', () => {
    for (const lang of LANGS) {
      const text = regionText('jeonju', lang);
      for (const pattern of AI_ACTOR[lang]) expect(text, `jeonju/${lang}: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('구글에 보내는 FAQ 스키마(JSON-LD)에도 AI 행위자 표기가 없다', () => {
    // 화면만 고치고 스키마를 두면 구글에는 계속 AI 서비스로 색인된다.
    document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
    regionText('seoul', 'en');
    const script = document.getElementById('region-faq-seoul');
    expect(script, 'FAQ 스키마가 안 들어갔다').not.toBeNull();
    const json = script!.textContent || '';
    expect(json).not.toMatch(/\bAI\b/);
    expect(json).toMatch(/Korean local data/);
    expect(json).toMatch(/\$9\.90/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/** /map 이 대신 말해야 하는 것 — 저장된 한국 일정의 경로 · 실제 이동 구간. */
const MAP_SIGNED_OUT: Record<Lang, RegExp[]> = {
  en: [/saved Korea itineraries/, /kept in your account/],
  ko: [/저장한 한국 일정의 경로/, /계정에 보관/],
  ja: [/保存した韓国旅程のルート/, /アカウントに保管/],
  zh: [/已保存的韩国行程路线/, /账户/],
};

const MAP_NO_PLANS: Record<Lang, RegExp[]> = {
  en: [/Korea itinerary/, /subway, bus and walking legs/],
  ko: [/한국 일정/, /지하철·버스·도보 구간/],
  ja: [/韓国旅程/, /地下鉄・バス・徒歩区間/],
  zh: [/韩国行程/, /地铁、公交与步行路段/],
};

async function mapText(language: Lang, user: { uid: string } | null): Promise<string> {
  mockLanguage.current = language;
  mockAuthUser.current = user;
  const { container, findByText } = render(<MemoryRouter><MapPage /></MemoryRouter>);
  // 로그인 경로는 effect 안에서 refs 를 비우므로, 빈 상태 문구가 붙을 때까지 기다린다.
  if (user) await findByText(/routes to show yet|표시할 동선이|表示できるルート|没有可显示的路线/);
  return container.textContent || '';
}

describe('F1 — /map 빈 상태 안내: AI 가 일정을 만드는 주체가 아니다', () => {
  for (const lang of LANGS) {
    it(`${lang} — 로그아웃 안내에 AI 행위자 표기가 없고, 저장된 한국 일정 경로를 설명한다`, async () => {
      const text = await mapText(lang, null);
      for (const pattern of AI_ACTOR[lang]) expect(text, `${lang}: ${pattern}`).not.toMatch(pattern);
      for (const pattern of MAP_SIGNED_OUT[lang]) expect(text, `${lang}: ${pattern}`).toMatch(pattern);
    });

    it(`${lang} — 플랜 0건 안내도 AI 가 아니라 실제 이동 구간으로 설명한다`, async () => {
      const text = await mapText(lang, { uid: 'test-uid' });
      for (const pattern of AI_ACTOR[lang]) expect(text, `${lang}: ${pattern}`).not.toMatch(pattern);
      for (const pattern of MAP_NO_PLANS[lang]) expect(text, `${lang}: ${pattern}`).toMatch(pattern);
    });
  }
});
