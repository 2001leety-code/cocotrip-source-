// @vitest-environment jsdom
/**
 * TourSectionTabs — MRT 벤치마킹 P1 (2026-08-19).
 * PlanDetailPage/components/SectionTabs.tsx 와 같은 sticky 스타일 + nav/aria-current 계약을 지키는지,
 * 클릭 시 해당 섹션 id 로 scrollIntoView 하는지 확인한다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { TourSectionTabs } from '../../src/components/tours/TourSectionTabs';

void React;

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  // jsdom 은 scrollIntoView 를 구현하지 않는다 — section-tabs-mount-no-page-scroll-1272 와 동일 패턴.
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => cleanup());

const TABS = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'overview', label: 'Overview' },
  { id: 'cancellation', label: 'Cancellation' },
];

describe('TourSectionTabs', () => {
  it('탭이 1개 이하면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<TourSectionTabs tabs={[{ id: 'only', label: 'Only' }]} />);
    expect(container.firstChild).toBeNull();
  });

  it('nav + button 계약(tablist/tab role 없음)을 지키며, sticky top-14 md:top-16 스타일을 쓴다 (SectionTabs.tsx 정합)', () => {
    const { container, getByRole, getAllByRole } = render(<TourSectionTabs tabs={TABS} />);
    const nav = container.querySelector('nav');
    expect(nav?.className).toMatch(/sticky/);
    expect(nav?.className).toMatch(/top-14/);
    expect(nav?.className).toMatch(/md:top-16/);
    expect(getByRole('navigation')).toBe(nav);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(getAllByRole('button')).toHaveLength(TABS.length);
  });

  it('첫 탭이 기본 active(aria-current=true) 상태다', () => {
    const { getAllByRole } = render(<TourSectionTabs tabs={TABS} />);
    const tabs = getAllByRole('button');
    expect(tabs[0]).toHaveAttribute('aria-current', 'true');
    expect(tabs[1]).not.toHaveAttribute('aria-current');
    for (const tab of tabs) expect(tab).not.toHaveAttribute('aria-selected');
  });

  it('탭 클릭 시 해당 섹션으로 scrollIntoView 하고 aria-current 를 옮긴다', () => {
    document.body.innerHTML = '<div id="cancellation"></div>';
    const { getAllByRole } = render(<TourSectionTabs tabs={TABS} />);
    const tabs = getAllByRole('button');
    fireEvent.click(tabs[2]);

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(tabs[2]).toHaveAttribute('aria-current', 'true');
    expect(tabs[0]).not.toHaveAttribute('aria-current');
  });

  it('탭 버튼은 키보드 포커스 가능한 네이티브 button 이다', () => {
    const { getAllByRole } = render(<TourSectionTabs tabs={TABS} />);
    for (const tab of getAllByRole('button')) {
      expect(tab.tagName).toBe('BUTTON');
      expect(tab).toHaveAttribute('type', 'button');
    }
  });
});
