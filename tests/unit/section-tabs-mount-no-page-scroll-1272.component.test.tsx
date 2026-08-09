// @vitest-environment jsdom
//
// #1272 P2 (2026-08-10) — 플랜 상세를 열면 페이지가 스스로 내려가 헤더·제목이 사라졌다.
//
// Pre-fix: SectionTabs 의 `useEffect([activeKey])` 가 마운트 즉시
//   `active.scrollIntoView({ block: 'nearest', inline: 'center' })` 를 호출했다.
//   block:'nearest' 는 "이미 보이면 안 움직인다"는 뜻이지 "세로로 안 움직인다"는 뜻이
//   아니다. 이 탭 스트립은 모바일 히어로+요약 카드 아래(문서 y≈760~985)라 마운트
//   시점엔 항상 폴드 밖 → 브라우저가 문서를 170~220px 세로로 끌어내렸다.
//   결과: 공용 헤더와 플랜 제목이 첫 화면에서 밀려나고, tests/visual 의 T1
//   (header above the fold) baseline 이 그 스크롤된 프레임으로 굳었다.
//
// Post-fix: 세로 포함 스크롤은 "활성 섹션이 실제로 바뀐 뒤"(사용자가 탭·Day 칩을
//   누른 경우)에만. 마운트/StrictMode 재실행에서는 컨테이너 scrollLeft 만 만진다 —
//   문서 스크롤은 구조적으로 불가능해진다.
//
// 이 파일이 깨지면: 플랜을 여는 순간 다시 페이지가 점프하거나(1번), 탭을 눌러도
//   해당 Day 본문이 시야로 오지 않는다(2번 = P93 회귀).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SectionTabs } from '../../src/pages/PlanDetailPage/components/SectionTabs';
import type { Slide } from '../../src/pages/PlanDetailPage/lib/buildSlides';

void React;

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: {}, changeLanguage: () => {} }),
}));

const SLIDES: Slide[] = [
  { type: 'intro' },
  { type: 'day', dayIndex: 0 },
  { type: 'day', dayIndex: 1 },
  { type: 'outro' },
];

const scrollIntoView = vi.fn();
const scrollLeftWrites: number[] = [];
let origScrollLeft: PropertyDescriptor | undefined;

beforeEach(() => {
  scrollIntoView.mockClear();
  scrollLeftWrites.length = 0;
  // jsdom 은 scrollIntoView 를 구현하지 않고, scrollLeft 는 대입해도 사라진다.
  // 두 경로를 각각 관측 가능하게 바꿔 끼운다.
  Element.prototype.scrollIntoView = scrollIntoView;
  origScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
  Object.defineProperty(Element.prototype, 'scrollLeft', {
    configurable: true,
    get: () => 0,
    set: (v: number) => { scrollLeftWrites.push(v); },
  });
});

afterEach(() => {
  if (origScrollLeft) Object.defineProperty(Element.prototype, 'scrollLeft', origScrollLeft);
});

describe('#1272 P2 — SectionTabs 마운트가 문서를 세로로 스크롤하지 않는다', () => {
  it('마운트: scrollIntoView 를 호출하지 않고 가로 정렬만 한다', () => {
    render(<SectionTabs slides={SLIDES} current={0} onJump={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    // 가로 정렬 경로는 돌았다 (jsdom 은 레이아웃이 0 이라 값 자체는 0).
    expect(scrollLeftWrites.length).toBeGreaterThan(0);
  });

  it('#slide-N 딥링크처럼 첫 활성 탭이 0번이 아니어도 문서는 그대로', () => {
    render(<SectionTabs slides={SLIDES} current={2} onJump={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollLeftWrites.length).toBeGreaterThan(0);
  });

  it('사용자가 섹션을 바꾸면(P93) 활성 탭을 가로 중앙 + 시야로 끌어온다', () => {
    const { rerender } = render(<SectionTabs slides={SLIDES} current={0} onJump={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<SectionTabs slides={SLIDES} current={2} onJump={() => {}} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ inline: 'center', block: 'nearest' });
  });

  it('같은 활성 탭으로 리렌더가 반복돼도(스트리밍 패치·StrictMode) 스크롤 안 함', () => {
    const { rerender } = render(<SectionTabs slides={SLIDES} current={1} onJump={() => {}} />);
    rerender(<SectionTabs slides={[...SLIDES]} current={1} onJump={() => {}} />);
    rerender(<SectionTabs slides={[...SLIDES]} current={1} onJump={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
