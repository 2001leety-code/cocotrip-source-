// @vitest-environment jsdom
//
// /charter 비결제 견적 단계(Step1~5) 접근성·모바일 사용성·4언어 회귀 슬롯 (2026-08-11).
//
// 실측 근거 (local production build, vite preview, Playwright, 390/768/1440 × ko/en/ja/zh):
//   1) CocoStepper 의 단계 점이 곧 <button> 이라 클릭/키보드 타깃이 26×26px.
//      → 12조합 전부에서 6개 점 모두 44px 미달 (총 360건).
//   2) Step1 공항·도시 검색 input 34px(390) / "다른 출발지" 토글 34px(390),
//      Step4 인원 ± 버튼 28px(390) — 실제 사용자 조작부가 44px 미달.
//   3) ja/zh 화면에 앱 소유 영어 문구 노출:
//      Step1 검색 placeholder "Search airport / city ...", 도시 부제 "Hotels",
//      Step4 "1-7 pax" / "Premium Business".
//      원인 = Step1/Step3/Step4 의 `const lang = language === 'ko' ? 'ko' : 'en'`
//      (ja/zh 를 영어로 접어버림).
//
// 이 파일이 깨지면: 단계 점의 탭 타깃이 다시 줄었거나(hit 래퍼 제거),
// 일본어·중국어 사용자에게 영어가 다시 새고 있는 것이다.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CocoStepper } from '../../src/components/coco/CocoUI';
import { Step1Origin } from '../../src/components/charter/Step1Origin';
import { Step4PaxVehicle } from '../../src/components/charter/Step4PaxVehicle';
import type { WizardState } from '../../src/components/charter/types';
import { AIRPORTS_CATALOG, CITIES_CATALOG } from '../../src/data/charterPricing';

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...rest }: { children?: React.ReactNode }) =>
    React.createElement('a', rest, children),
}));

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

describe('CocoStepper — 44×44 hit target + 기존 게이트/의미 보존', () => {
  const labels = ['1', '2', '3', '4', '5', '6'];

  it('점(.coco-stepper-dot)은 시각 요소이고, 클릭/포커스 대상은 별도 hit 래퍼 버튼이다', () => {
    const { container } = render(
      <CocoStepper current={2} total={6} labels={labels} onStepClick={() => {}} />,
    );
    const hits = container.querySelectorAll('button.coco-stepper-hit');
    expect(hits).toHaveLength(6);
    // 시각 점은 버튼 자신이 아니라 자식 span — 점을 키우지 않고 타깃만 넓힌다.
    for (const hit of Array.from(hits)) {
      expect(hit.querySelector('span.coco-stepper-dot')).not.toBeNull();
      expect(hit.classList.contains('coco-stepper-dot')).toBe(false);
    }
  });

  it('완료/현재/미완료 의미와 aria 가 그대로다', () => {
    const { container } = render(
      <CocoStepper current={2} total={6} labels={labels} onStepClick={() => {}} />,
    );
    const dots = Array.from(container.querySelectorAll('span.coco-stepper-dot'));
    expect(dots[0].classList.contains('is-done')).toBe(true);
    expect(dots[1].classList.contains('is-done')).toBe(true);
    expect(dots[2].classList.contains('is-active')).toBe(true);
    expect(dots[3].classList.contains('is-done')).toBe(false);
    expect(dots[3].classList.contains('is-active')).toBe(false);

    const hits = Array.from(container.querySelectorAll('button.coco-stepper-hit'));
    expect(hits[2].getAttribute('aria-current')).toBe('step');
    expect(hits[0].getAttribute('aria-current')).toBeNull();
    expect(hits.map((h) => h.getAttribute('aria-label'))).toEqual(labels);
    // 미완료 단계는 이동 불가라는 사실을 보조기술에도 알린다 (포커스 순서는 유지).
    expect(hits[3].getAttribute('aria-disabled')).toBe('true');
    expect(hits[0].getAttribute('aria-disabled')).toBeNull();
    expect(hits.every((h) => !h.hasAttribute('disabled'))).toBe(true);
  });

  it('완료된 단계만 이동한다 (기존 클릭 게이트)', () => {
    const onStepClick = vi.fn();
    const { container } = render(
      <CocoStepper current={2} total={6} labels={labels} onStepClick={onStepClick} />,
    );
    const hits = Array.from(container.querySelectorAll('button.coco-stepper-hit'));
    fireEvent.click(hits[0]);
    expect(onStepClick).toHaveBeenCalledWith(0);
    onStepClick.mockClear();
    fireEvent.click(hits[2]); // 현재 단계
    fireEvent.click(hits[5]); // 미완료 단계
    expect(onStepClick).not.toHaveBeenCalled();
  });
});

describe('/charter Step1 출발지 — 4언어 (앱 소유 문구 영어 누출 0)', () => {
  const base = { origin: undefined } as unknown as WizardState;

  it.each(LANGS)('%s: 검색 placeholder 가 해당 언어다', (lang) => {
    const { container, unmount } = render(
      <Step1Origin state={base} patch={() => {}} language={lang} />,
    );
    const search = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    const ph = search.getAttribute('placeholder') || '';
    expect(ph.length).toBeGreaterThan(0);
    if (lang === 'ja' || lang === 'zh') {
      expect(ph).not.toContain('Search airport');
      expect(ph).toMatch(/[぀-ヿ㐀-鿿]/);
    }
    unmount();
  });

  it.each(['ja', 'zh'] as const)('%s: 도시 카드 부제에 "Hotels" 가 없다', (lang) => {
    const { container, unmount } = render(
      <Step1Origin state={base} patch={() => {}} language={lang} />,
    );
    expect(container.textContent || '').not.toContain('Hotels');
    unmount();
  });

  it.each(LANGS)('%s: 검색 입력과 "다른 출발지" 토글이 44px 타깃 클래스를 가진다', (lang) => {
    const { container, unmount } = render(
      <Step1Origin state={base} patch={() => {}} language={lang} />,
    );
    const search = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(search.className).toContain('min-h-[44px]');
    const buttons = Array.from(container.querySelectorAll('button'));
    const toggle = buttons[buttons.length - 1];
    expect(toggle.className).toContain('min-h-[44px]');
    unmount();
  });
});

// 2026-08-11 후속(Codex diff 리뷰 P2): 카드 제목은 카탈로그(pricing_spec)의 name_ko/name_en 만
// 있어서 ja/zh 에서도 name_en 이 그대로 떨어졌다 — "Incheon International", "Seoul Metro" 등
// 앱 소유 영어가 ja/zh pickup 카드에 노출. 가격 SSOT(pricing_spec)는 건드리지 않고 Step1 표시
// 전용 정적 매핑으로 덮는다. 이 describe 가 깨지면 그 매핑이 빠졌거나 노출 코드가 늘어난 것.
describe('/charter Step1 출발지 카드 — 노출 12개 공항·도시명 4언어', () => {
  const base = { origin: undefined } as unknown as WizardState;
  const airports = AIRPORTS_CATALOG as Record<string, { name_ko: string; name_en: string }>;
  const cities = CITIES_CATALOG as Record<string, { name_ko: string; name_en: string }>;

  // Step1 이 실제로 노출하는 코드 = PRIMARY 4 + SECONDARY 8.
  const EXPOSED = [
    'ICN', 'GMP', 'SEL_METRO', 'BUS_METRO',
    'PUS', 'CJU', 'TAE', 'CJJ', 'MWX', 'KWJ', 'RSU', 'USN',
  ] as const;

  const CITY_SUB = {
    ko: '호텔·숙소', en: 'Hotels', ja: 'ホテル・宿泊先', zh: '酒店·住宿',
  } as const;

  // ja/zh 기대 표기 (zh 는 사이트 표준인 간체 — 首尔/济州/丽水/机场).
  const LOCALIZED: Record<'ja' | 'zh', Record<string, string>> = {
    ja: {
      ICN: '仁川国際空港', GMP: '金浦国際空港', PUS: '金海国際空港', CJU: '済州国際空港',
      TAE: '大邱国際空港', CJJ: '清州国際空港', MWX: '務安国際空港', KWJ: '光州空港',
      RSU: '麗水空港', USN: '蔚山空港',
      SEL_METRO: 'ソウル市内', BUS_METRO: '釜山市内',
    },
    zh: {
      ICN: '仁川国际机场', GMP: '金浦国际机场', PUS: '金海国际机场', CJU: '济州国际机场',
      TAE: '大邱国际机场', CJJ: '清州国际机场', MWX: '务安国际机场', KWJ: '光州机场',
      RSU: '丽水机场', USN: '蔚山机场',
      SEL_METRO: '首尔市区', BUS_METRO: '釜山市区',
    },
  };

  // ko/en 은 회귀 방지용 — 기대값을 새로 박지 않고 카탈로그(기존 표시)에서 그대로 가져온다.
  const expectTitle = (code: string, lang: (typeof LANGS)[number]) => {
    const row = airports[code] || cities[code];
    if (lang === 'ko') return row.name_ko;
    if (lang === 'en') return row.name_en;
    return LOCALIZED[lang][code];
  };
  const expectSub = (code: string, lang: (typeof LANGS)[number]) =>
    code in airports ? `(${code})` : CITY_SUB[lang];

  it.each(LANGS)('%s: 12개 카드 제목·부제가 그 언어 표기다 (코드 검색 경로)', (lang) => {
    const { container, unmount } = render(
      <Step1Origin state={base} patch={() => {}} language={lang} />,
    );
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    for (const code of EXPOSED) {
      // 코드로 검색하면 그 카드 1장 + "다른 출발지" 토글만 남는다 → 카드 = buttons[0].
      fireEvent.change(input, { target: { value: code } });
      const buttons = Array.from(container.querySelectorAll('button'));
      expect(buttons).toHaveLength(2);
      expect(buttons[0].textContent).toBe(expectTitle(code, lang) + expectSub(code, lang));
    }
    unmount();
  });

  it.each(['ja', 'zh'] as const)('%s: 펼친 기본 화면에 12개 현지화 제목만 있고 카탈로그 영어명은 없다', (lang) => {
    const { container, unmount } = render(
      <Step1Origin state={base} patch={() => {}} language={lang} />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    fireEvent.click(buttons[buttons.length - 1]); // "다른 출발지" 토글
    const text = container.textContent || '';
    for (const code of EXPOSED) {
      expect(text).toContain(LOCALIZED[lang][code]);
      expect(text).not.toContain((airports[code] || cities[code]).name_en);
    }
    unmount();
  });

  const SEARCH_CASES = [
    { lang: 'ja', q: '仁川', code: 'ICN' },
    { lang: 'ja', q: 'ソウル', code: 'SEL_METRO' },
    { lang: 'ja', q: '麗水', code: 'RSU' },
    { lang: 'zh', q: '济州', code: 'CJU' },
    { lang: 'zh', q: '首尔', code: 'SEL_METRO' },
    { lang: 'zh', q: '丽水', code: 'RSU' },
    { lang: 'ko', q: '인천', code: 'ICN' },
    { lang: 'en', q: 'incheon', code: 'ICN' },
  ] as const;

  it.each(SEARCH_CASES)('$lang: "$q" 검색이 $code 카드를 찾는다', ({ lang, q, code }) => {
    const { container, unmount } = render(
      <Step1Origin state={base} patch={() => {}} language={lang} />,
    );
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: q } });
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe(expectTitle(code, lang) + expectSub(code, lang));
    unmount();
  });
});

describe('/charter Step4 인원·차종 — 4언어 + 44px 타깃', () => {
  const base = {
    paxCount: 2, adultCount: 2, childCount: 0, vehicle: 'staria',
  } as unknown as WizardState;

  // 사전(charterWizard) 문구는 jsdom 에서 locale chunk 가 안 붙어 영어로 떨어진다 —
  // 여기서는 컴포넌트가 직접 소유한 문구(차종 표시명·탑승 인원 범위)만 본다.
  it.each(['ja', 'zh'] as const)('%s: 차종명·인원범위에 영어 잔재가 없다', (lang) => {
    const { container, unmount } = render(
      <Step4PaxVehicle state={base} patch={() => {}} language={lang} />,
    );
    const text = container.textContent || '';
    expect(text).not.toContain('Premium Business');
    for (const en of ['1-7 pax', '1-6 pax', '10-15 pax', '16+ pax']) {
      expect(text).not.toContain(en);
    }
    expect(text).toMatch(/[぀-ヿ㐀-鿿]/);
    unmount();
  });

  it.each(LANGS)('%s: 인원 ± 버튼이 모바일에서도 44px 타깃이다', (lang) => {
    const { container, unmount } = render(
      <Step4PaxVehicle state={base} patch={() => {}} language={lang} />,
    );
    // CounterPanel 의 −/+ 버튼 = h-7 w-7(28px) 이었다. 이제 h-11 w-11(44px).
    expect(container.querySelectorAll('button.h-7.w-7')).toHaveLength(0);
    const counters = Array.from(container.querySelectorAll('button')).filter((b) =>
      /(^|\s)h-11(\s|$)/.test(b.className) && /(^|\s)w-11(\s|$)/.test(b.className),
    );
    expect(counters.length).toBeGreaterThanOrEqual(4);
    unmount();
  });
});
