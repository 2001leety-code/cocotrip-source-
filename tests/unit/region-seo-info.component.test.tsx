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
