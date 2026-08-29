// @vitest-environment jsdom
//
// 지역 페이지 공개 정보 섹션 (2026-08-06).
//
// 왜 잠그나: GSC 실측에서 `/region/*` 9개가 크롤러 기준 1,611~1,747자였다. 색인된
// `/charter` 는 4,980자, 색인이 **거부된** `/planner` 는 939자다. 갔다가 거부당한 페이지는
// 안 가본 페이지보다 나쁘다(구글이 다시 오지 않는다). 그래서 본문량과 "지어내지 않았나" 를
// 테스트로 고정한다.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RegionSeoInfo } from '../../src/components/region/RegionSeoInfo';
import { REGION_TOUR_SOURCE, MULTICITY_REGIONS } from '../../src/components/region/regionTourSource';
import { INDEXABLE_ROUTES } from '../../src/lib/seoRoutes';
import { getToursByRegion } from '../../src/data/tours';
import { CITY_CHIPS } from '../../src/components/WizardForm/data';
import {
  INDEXING_CONTENT_REGION_IDS,
  REGION_DECISION_GUIDES,
} from '../../src/components/region/regionDecisionContent';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

void React;

const REGION_IDS = INDEXABLE_ROUTES.filter((r) => r.startsWith('/region/')).map((r) => r.replace('/region/', ''));

function textOf(regionId: string, language = 'en', regionTitle = regionId.toUpperCase()): string {
  const { container } = render(
    <RegionSeoInfo regionId={regionId} regionTitle={regionTitle} language={language} />,
  );
  return container.textContent || '';
}

// regionDetail.<id>.title (ko) — src/i18n/locales/ko.json 실측. 받침 있는/없는 지역명이
// 섞여 있어서 은/을 을 하드코딩하면 절반은 문법이 깨진다.
const REGION_KO_TITLE: Record<string, string> = {
  seoul: '서울', busan: '부산', gyeongju: '경주', danyang: '단양',
  chuncheon: '춘천', ganghwa: '강화도', incheon: '인천', paju: '파주', jeonju: '전주',
};
const REGION_HAS_BATCHIM = new Set(['seoul', 'busan', 'danyang', 'chuncheon', 'incheon']);

describe('RegionSeoInfo — 색인 거부를 막는 본문', () => {
  it('Crawled-not-indexed 7개 지역만 고유 선택 안내를 갖는다', () => {
    expect(Object.keys(REGION_DECISION_GUIDES).sort()).toEqual([...INDEXING_CONTENT_REGION_IDS].sort());

    const fingerprints = new Set<string>();
    for (const regionId of INDEXING_CONTENT_REGION_IDS) {
      const { container, unmount } = render(
        <RegionSeoInfo regionId={regionId} regionTitle={regionId.toUpperCase()} language="en" />,
      );
      const guide = container.querySelector('[data-testid="region-decision-guide"]');
      expect(guide, `${regionId}: 고유 선택 안내 없음`).not.toBeNull();
      fingerprints.add(guide?.textContent || '');
      unmount();
    }
    expect(fingerprints.size).toBe(INDEXING_CONTENT_REGION_IDS.length);

    for (const regionId of ['seoul', 'chuncheon']) {
      const { container, unmount } = render(
        <RegionSeoInfo regionId={regionId} regionTitle={regionId.toUpperCase()} language="en" />,
      );
      expect(container.querySelector('[data-testid="region-decision-guide"]')).toBeNull();
      unmount();
    }
  });

  it('고유 선택 안내 문구가 지역 7개 × 4개 언어로 비어 있지 않다', () => {
    for (const regionId of INDEXING_CONTENT_REGION_IDS) {
      const guide = REGION_DECISION_GUIDES[regionId];
      for (const language of ['ko', 'en', 'ja', 'zh'] as const) {
        expect(guide.bestFor[language].length, `${regionId}.${language}.bestFor`).toBeGreaterThan(40);
        expect(guide.movement[language].length, `${regionId}.${language}.movement`).toBeGreaterThan(40);
        if (guide.flow.kind === 'editorial') {
          expect(guide.flow.lead[language].length, `${regionId}.${language}.flow.lead`).toBeGreaterThan(20);
          expect(guide.flow.steps.every((step) => step[language].length > 8)).toBe(true);
        }
      }
    }
  });

  it('상품형 하루 흐름은 tours.ts의 실제 stop·시간을 그대로 렌더한다', () => {
    const allTours = getToursByRegion('All');
    for (const regionId of INDEXING_CONTENT_REGION_IDS) {
      const guide = REGION_DECISION_GUIDES[regionId];
      if (guide.flow.kind !== 'tour') continue;

      const tour = allTours.find((entry) => entry.id === guide.flow.tourId);
      expect(tour, `${regionId}: ${guide.flow.tourId} 상품 없음`).toBeDefined();
      expect(tour?.stops?.length, `${regionId}: 실제 stop 없음`).toBeGreaterThan(0);

      const { container, unmount } = render(
        <RegionSeoInfo regionId={regionId} regionTitle={regionId.toUpperCase()} language="en" />,
      );
      const guideElement = container.querySelector('[data-testid="region-decision-guide"]');
      expect(guideElement).toHaveTextContent(tour?.stops?.[0].time || 'missing-time');
      expect(guideElement).toHaveTextContent(tour?.stops?.[0].name.en || 'missing-stop');
      expect(guideElement?.querySelector(`a[href="/tours/${tour?.slug}"]`)).not.toBeNull();
      unmount();
    }
  });

  it('플래너 링크는 CITY_CHIPS가 실제로 지원하는 지역에만 붙는다', () => {
    for (const regionId of INDEXING_CONTENT_REGION_IDS) {
      if (!REGION_DECISION_GUIDES[regionId].actions?.includes('planner')) continue;
      expect(CITY_CHIPS.some((chip) => chip.key === regionId), `${regionId}: 미지원 플래너 링크`).toBe(true);
    }
  });

  it('전주 오목대 일본어 표기를 梧木台로 유지한다', () => {
    const guide = REGION_DECISION_GUIDES.jeonju;
    expect(guide.flow.kind).toBe('editorial');
    if (guide.flow.kind !== 'editorial') return;
    expect(guide.flow.steps.map((step) => step.ja).join(' ')).toContain('梧木台');
    expect(guide.flow.steps.map((step) => step.ja).join(' ')).not.toContain('五福台');
  });

  it('전주 명소 locale은 ko/en을 보존하고 ja/zh 오목대를 梧木台로 맞춘다', () => {
    expect(ko.regionDetail.jeonju.attractions[4].name).toBe('오목대');
    expect(en.regionDetail.jeonju.attractions[4].name).toBe('Omokdae');
    expect(ja.regionDetail.jeonju.attractions[4].name).toBe('梧木台');
    expect(zh.regionDetail.jeonju.attractions[4].name).toBe('梧木台');
  });

  it('각 고유 안내는 과하지 않은 2~3개의 실제 내부 href로 다음 콘텐츠에 연결된다', () => {
    for (const regionId of INDEXING_CONTENT_REGION_IDS) {
      const { container, unmount } = render(
        <RegionSeoInfo regionId={regionId} regionTitle={regionId.toUpperCase()} language="en" />,
      );
      const guide = container.querySelector('[data-testid="region-decision-guide"]');
      const anchors = [...(guide?.querySelectorAll('a[href]') || [])];
      const hrefs = anchors.map((anchor) => anchor.getAttribute('href') || '');

      expect(anchors.length, `${regionId}: 링크 수 ${anchors.length}`).toBeGreaterThanOrEqual(2);
      expect(anchors.length, `${regionId}: 링크 수 ${anchors.length}`).toBeLessThanOrEqual(3);
      expect(new Set(hrefs).size, `${regionId}: 중복 링크`).toBe(hrefs.length);
      expect(hrefs.every((href) => href.startsWith('/') && !href.startsWith('//'))).toBe(true);
      unmount();
    }
  });

  it('밝은 지역 화면의 선택 안내에 흰색 전용 색을 다시 넣지 않는다', () => {
    const { container } = render(
      <RegionSeoInfo regionId="jeonju" regionTitle="Jeonju" language="en" />,
    );
    const guide = container.querySelector('[data-testid="region-decision-guide"]');
    expect(guide).not.toBeNull();
    expect(guide?.querySelectorAll('[class*="text-white"], [class*="border-white"], [class*="outline-white"]')).toHaveLength(0);
    expect(guide).toHaveClass('border-ec-line', 'text-ec-ink-2');
    expect(guide?.querySelector('nav h3')).toHaveClass('text-ec-ink');
    for (const link of guide?.querySelectorAll('a[href]') || []) {
      expect(link).toHaveClass('border-ec-line-2', 'bg-ec-raised', 'text-ec-ink', 'focus-visible:ring-ec-brand');
      expect(link.querySelector('small')).toHaveClass('text-ec-ink-3');
    }
  });

  it('상품 동선과 비예약 하루 제안의 제목을 4개 언어에서 구분한다', () => {
    const expected = {
      ko: { tour: '공개 상품의 실제 동선', editorial: '하루 구성 제안 (예약 일정 아님)' },
      en: { tour: 'Route in the published product', editorial: 'Suggested day shape (not a booked itinerary)' },
      ja: { tour: '公開商品の実際の行程', editorial: '1日の組み立て案（予約行程ではありません）' },
      zh: { tour: '公开产品的实际路线', editorial: '一日安排建议（非预订行程）' },
    } as const;

    for (const language of ['ko', 'en', 'ja', 'zh'] as const) {
      const tour = render(
        <RegionSeoInfo regionId="paju" regionTitle="Paju" language={language} />,
      );
      expect(tour.container.querySelector('#paju-day-flow')).toHaveTextContent(expected[language].tour);
      tour.unmount();

      const editorial = render(
        <RegionSeoInfo regionId="incheon" regionTitle="Incheon" language={language} />,
      );
      expect(editorial.container.querySelector('#incheon-day-flow')).toHaveTextContent(expected[language].editorial);
      expect(editorial.container.querySelector('#incheon-day-flow')).not.toHaveTextContent(expected[language].tour);
      editorial.unmount();
    }
  });

  it('인천 연계 정적 상품을 예약 가능하다고 보장하지 않는다', () => {
    const movement = REGION_DECISION_GUIDES.incheon.movement;
    expect(movement.ko).toContain('현재 공개된');
    expect(movement.en).toContain('current published');
    expect(movement.ja).toContain('現在公開されている');
    expect(movement.zh).toContain('当前公开的');
    expect(Object.values(movement).join(' ')).not.toMatch(/예약 가능한|bookable|予約できる|可预订/);
  });

  it('sitemap 의 지역 페이지가 전부 투어 매핑 표에 있다', () => {
    // 새 지역 페이지를 추가하고 이 표를 안 고치면 그 페이지만 조용히 투어 0건이 된다.
    expect(REGION_IDS.length).toBeGreaterThan(0);
    for (const id of REGION_IDS) {
      expect(Object.prototype.hasOwnProperty.call(REGION_TOUR_SOURCE, id), `${id} 매핑 없음`).toBe(true);
    }
  });

  it('매핑한 TourRegion 이 실제로 투어를 돌려준다', () => {
    // `TourRegion` 이름이 바뀌면 getToursByRegion 이 빈 배열을 주고, 화면은 조용히
    // "투어 상품 없음" 으로 바뀐다 — 에러가 안 난다. 그래서 여기서 잡는다.
    for (const [id, source] of Object.entries(REGION_TOUR_SOURCE)) {
      if (!source) continue;
      expect(getToursByRegion(source).length, `${id} → ${source} 투어 0건`).toBeGreaterThan(0);
    }
  });

  it('멀티시티로 표시하는 지역은 멀티시티 상품이 실제로 들르는 곳이다', () => {
    const multicity = getToursByRegion('Multi-City');
    expect(multicity.length).toBeGreaterThan(0);
    const title = multicity.map((t) => t.title.en.toLowerCase()).join(' ');
    for (const id of MULTICITY_REGIONS) {
      expect(title.includes(id), `멀티시티 상품명에 ${id} 없음 — 안 들르는 도시를 광고 중`).toBe(true);
    }
  });

  it('지역 9개 전부 본문이 1,500자 이상 나온다', () => {
    for (const id of REGION_IDS) {
      const text = textOf(id);
      expect(text.length, `${id} 본문 ${text.length}자`).toBeGreaterThanOrEqual(1500);
    }
  });

  it('4개 언어 전부 본문이 나온다', () => {
    // ⚠️ 언어별 기준을 같게 두면 안 된다. 같은 내용이라도 중국어·일본어는 글자수가 훨씬 적다
    //   (실측 seoul: en 1,9xx · zh 988). 색인 판정에 실제로 걸리는 건 프리렌더가 내보내는
    //   기본 언어(영어)이고, 이 검사의 목적은 "4개 언어가 실제로 렌더되나" 다.
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const text = textOf('seoul', lang);
      expect(text.length, `${lang} 본문 ${text.length}자`).toBeGreaterThanOrEqual(800);
    }
  });

  it('투어 상품이 없는 지역은 투어가 있다고 쓰지 않는다', () => {
    const noTourIds = REGION_IDS.filter((id) => !REGION_TOUR_SOURCE[id] && !MULTICITY_REGIONS.has(id));
    expect(noTourIds.length, '투어 없는 지역이 하나도 없다면 이 검사는 무의미하다').toBeGreaterThan(0);
    for (const id of noTourIds) {
      const text = textOf(id);
      expect(text).toContain('no set tour product');
      // 다른 지역 투어 제목이 새어 들어오면 안 된다.
      expect(text).not.toContain('Full-Day Tour');
    }
  });

  it('플래너 대상이 아닌 도시를 대상이라고 쓰지 않는다', () => {
    const covered = REGION_IDS.filter((id) => CITY_CHIPS.some((c) => c.key === id));
    const notCovered = REGION_IDS.filter((id) => !CITY_CHIPS.some((c) => c.key === id));
    expect(covered.length).toBeGreaterThan(0);
    expect(notCovered.length).toBeGreaterThan(0);

    for (const id of covered) {
      // 2026-08-11: 대상 도시 분기를 가르는 문구가 'AI itinerary' 에서 실제 능력 설명으로 바뀌었다.
      //   (`tests/unit/public-ai-actor-copy.component.test.tsx` 가 AI 행위자 표기 재발을 잠근다)
      expect(textOf(id), `${id} 는 플래너 대상인데 안내가 없다`).toContain('written automatically from Korean local data');
    }
    for (const id of notCovered) {
      expect(textOf(id), `${id} 는 플래너 대상이 아닌데 대상처럼 썼다`).toContain('not one of the cities');
    }
  });

  it('한국어 지역명과 조사 사이에 공백이 없고, 받침 유무에 맞는 조사가 붙는다', () => {
    // 실측(PR #1280 P3): "서울 을"처럼 실제 지역명 뒤에 조사 앞 공백이 남았다. 지역 9개는
    // 받침 있는 이름(서울=ㄹ, 부산=ㄴ, 단양=ㅇ, 춘천=ㄴ, 인천=ㄴ)과 받침 없는 이름(경주, 강화도,
    // 파주, 전주)이 섞여 있어서 조사를 하드코딩하면 절반은 문법이 깨진다.
    for (const id of REGION_IDS) {
      const title = REGION_KO_TITLE[id];
      expect(title, `${id}: 테스트에 ko 제목 매핑이 없다`).toBeTruthy();
      const text = textOf(id, 'ko', title);

      expect(text, `${id}: "${title}" 뒤 조사 앞에 공백이 남았다`).not.toMatch(
        new RegExp(`${title} (은|는|을|를)`),
      );

      const [eun, eul] = REGION_HAS_BATCHIM.has(id) ? ['은', '을'] : ['는', '를'];
      expect(
        text.includes(`${title}${eun}`) || text.includes(`${title}${eul}`),
        `${id}: "${title}${eun}"/"${title}${eul}" 가 안 보인다 — helper 미적용 의심`,
      ).toBe(true);
    }
  });

  it('구글에 보내는 FAQ 문구가 화면 문구와 같다', () => {
    // 스키마를 따로 적어두면 정책이 바뀔 때 화면과 구글이 다른 말을 한다.
    document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
    const text = textOf('seoul');
    const script = document.getElementById('region-faq-seoul');
    expect(script, 'FAQ 스키마가 안 들어갔다').not.toBeNull();

    const faq = JSON.parse(script!.textContent || '{}') as {
      mainEntity?: Array<{ name: string; acceptedAnswer?: { text: string } }>;
    };
    expect(faq.mainEntity?.length).toBeGreaterThanOrEqual(5);
    for (const entry of faq.mainEntity || []) {
      expect(text, `질문이 화면에 없다: ${entry.name}`).toContain(entry.name);
      expect(text, `답이 화면에 없다: ${entry.name}`).toContain(entry.acceptedAnswer?.text || '');
    }
  });
});
