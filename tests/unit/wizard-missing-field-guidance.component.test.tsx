// @vitest-environment jsdom
//
// 위저드 미작성 안내 (2026-08-18, 운영자 실사용 신고).
//
// 🔴 증상: 필수 항목을 비운 채 Next 를 누르면 그 칸 밑에 빨간 문구가 켜지긴 했는데
//   **화면이 움직이지 않았다.** 4페이지는 날짜·인원·공항·호텔·짐이 세로로 늘어선 긴
//   화면이라 아래쪽 Next 를 누른 사람에게 위쪽 문구는 안 보인다 → "버튼이 죽었다".
//   게다가 문구가 `wizardFillRequired`("여기 작성해주세요") 하나를 도시·날짜·공항이
//   같이 써서, 보이더라도 **어디를 말하는지 알 수 없었다.**
//
// 이 파일은 진짜 DOM 을 그려서 다음을 확인한다.
//   1) 못 넘어갈 때 onNext 가 안 불린다 (기존 동작 보존)
//   2) 남은 항목이 **항목별 문구**로 뜬다 (실제 ko.json 문자열로 대조)
//   3) 첫 빈 칸으로 **포커스가 이동**한다 (= 스크롤이 따라간다)
//   4) 요약의 줄을 누르면 그 칸으로 이동한다
//   5) 채우고 나면 통과한다
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ko from '../../src/i18n/locales/ko.json';
import { WizardStep0Reservation } from '../../src/components/WizardForm/WizardStep0Reservation';
import { WizardStep0Destination } from '../../src/components/WizardForm/WizardStep0Destination';
import { WizardMissingSummary } from '../../src/components/WizardForm/WizardMissing';
import { revealFirstMissing } from '../../src/components/WizardForm/missingFields';

void React;

const p = ko.planner as Record<string, string>;

/**
 * "그 칸으로 갔는가" 판정.
 *
 * 🕳️ 처음엔 `activeElement.textContent` 가 라벨을 포함하는지만 봤다가 헛통과했다 —
 *   포커스가 안 옮겨지면 activeElement 는 `document.body` 이고, body 는 두 라벨을
 *   **둘 다** 품고 있어서 무엇을 넣어도 통과한다. 그래서 body 를 명시적으로 배제하고,
 *   옆 칸의 라벨이 **없다**는 것까지 같이 본다.
 */
function expectFocusedSection(contains: string, notContains: string) {
  const el = document.activeElement as HTMLElement;
  expect(el).not.toBe(document.body);
  expect(el.getAttribute('tabindex')).toBe('-1');
  expect(el.textContent).toContain(contains);
  expect(el.textContent).not.toContain(notContains);
}

// jsdom 에는 scrollIntoView 가 없다. 없다고 테스트가 죽으면 안 되고, 호출 여부는
// 봐야 하므로 스텁으로 갈아끼운다. focus() 는 jsdom 이 실제로 구현한다 —
// 그래서 "어디로 갔는지"는 document.activeElement 로 진짜 확인할 수 있다.
const scrollSpy = vi.fn();
beforeEach(() => {
  scrollSpy.mockClear();
  Element.prototype.scrollIntoView = scrollSpy;
});

// ── 1) 예약 상황 스텝 — 여기만 CTA 가 `disabled` 로 잠겨 있었다 ────────────────
function renderReservation(over: Record<string, unknown> = {}) {
  const onNext = vi.fn();
  const props = {
    p,
    isMobile: false,
    status: null,
    setStatus: vi.fn(),
    arrivalAirport: '',
    setArrivalAirport: vi.fn(),
    arrivalTime: '',
    setArrivalTime: vi.fn(),
    hotelAddress: '',
    setHotelAddress: vi.fn(),
    mainCityKey: 'seoul',
    onNext,
    ...over,
  } as unknown as React.ComponentProps<typeof WizardStep0Reservation>;
  render(<WizardStep0Reservation {...props} />);
  return { onNext };
}

describe('예약 상황 스텝 — 회색 버튼 대신 이유를 말한다', () => {
  it('CTA 가 잠겨 있지 않다 (누를 수 있어야 이유를 들려줄 수 있다)', () => {
    renderReservation();
    const cta = screen.getByRole('button', { name: new RegExp(p.resNext) });
    expect(cta).not.toBeDisabled();
  });

  it('아무것도 안 고르고 누르면 — 진행 안 되고, 무엇이 빠졌는지 뜬다', () => {
    const { onNext } = renderReservation();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.resNext) }));

    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByText(p.wizardMissingTitle)).toBeInTheDocument();
    expect(screen.getAllByText(p.wizardMissingStatus).length).toBeGreaterThan(0);
  });

  it('항공편만 고르고 시각을 비우면 — 도착 시각을 콕 집어 말한다', () => {
    const { onNext } = renderReservation({ status: 'flight', arrivalAirport: 'ICN', arrivalTime: '' });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.resNext) }));

    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getAllByText(p.wizardMissingArrivalTime).length).toBeGreaterThan(0);
    // 공항은 채웠으니 공항 안내는 뜨지 않는다 — "다 비었다"고 뭉뚱그리지 않는다.
    expect(screen.queryByText(p.wizardMissingAirport)).toBeNull();
  });

  it('다 채우면 통과한다', () => {
    const { onNext } = renderReservation({ status: 'flight', arrivalAirport: 'ICN', arrivalTime: '14:30' });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.resNext) }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

// ── 2) 목적지 스텝 — 첫 빈 칸으로 실제로 이동하는가 ───────────────────────────
function renderDestination(over: Record<string, unknown> = {}) {
  const onNext = vi.fn();
  const props = {
    p,
    isMobile: false,
    mainCity: '',
    mainCityKey: '',
    extraCities: [],
    selectedCityKeys: [],
    selectedActivities: [],
    freeText: '',
    setMainCity: vi.fn(),
    setMainCityKey: vi.fn(),
    setExtraCities: vi.fn(),
    setSelectedActivities: vi.fn(),
    setFreeText: vi.fn(),
    allCities: [],
    canGoStep1: false,
    getCityName: (k: string) => k,
    toggleActivity: vi.fn(),
    toggleCity: vi.fn(),
    isCitySelected: () => false,
    onNext,
    setDateRange: vi.fn(),
    ...over,
  } as unknown as React.ComponentProps<typeof WizardStep0Destination>;
  render(<WizardStep0Destination {...props} />);
  return { onNext };
}

describe('목적지 스텝 — 첫 빈 칸으로 데려간다', () => {
  it('도시·활동 둘 다 비면 둘 다 말하고, 도시 칸으로 포커스가 간다', () => {
    const { onNext } = renderDestination();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.wizardFoodTitle) }));

    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getAllByText(p.wizardMissingCity).length).toBeGreaterThan(0);
    expect(screen.getAllByText(p.wizardMissingActivity).length).toBeGreaterThan(0);

    // 🔴 이 두 줄이 이 PR 의 핵심 — 예전에는 문구만 켜지고 화면이 안 움직였다.
    expect(scrollSpy).toHaveBeenCalled();
    expectFocusedSection(p.tripAreaLabel, p.wizardActivities);
  });

  it('도시만 채우면 남은 안내는 활동 하나, 포커스도 활동 칸으로', () => {
    renderDestination({ mainCity: 'Seoul', allCities: ['Seoul'], selectedCityKeys: ['seoul'] });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.wizardFoodTitle) }));

    expect(screen.queryByText(p.wizardMissingCity)).toBeNull();
    expectFocusedSection(p.wizardActivities, p.tripAreaLabel);
  });

  it('요약이 뜨기 전에는 조용하다 (첫 진입에 빨간 화면 금지)', () => {
    renderDestination();
    expect(screen.queryByText(p.wizardMissingTitle)).toBeNull();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('다 채우면 통과한다', () => {
    const { onNext } = renderDestination({
      mainCity: 'Seoul', allCities: ['Seoul'], selectedCityKeys: ['seoul'],
      selectedActivities: ['Food'], canGoStep1: true,
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.wizardFoodTitle) }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

// ── 3) 요약 위젯 자체 ─────────────────────────────────────────────────────────
describe('WizardMissingSummary — 줄을 누르면 그 칸으로', () => {
  it('빈 목록이면 아무것도 그리지 않는다', () => {
    const { container } = render(<WizardMissingSummary title="제목" missing={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('줄을 누르면 해당 칸에 포커스가 간다', () => {
    const target = document.createElement('div');
    target.tabIndex = -1;
    target.textContent = '날짜 칸';
    document.body.appendChild(target);

    render(
      <WizardMissingSummary
        title="제목"
        missing={[{ key: 'dates', label: '여행 날짜를 선택해주세요', ref: { current: target } }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '여행 날짜를 선택해주세요' }));
    expect(document.activeElement).toBe(target);
    expect(scrollSpy).toHaveBeenCalled();

    target.remove();
  });

  it('revealFirstMissing — 목록이 비면 아무 일도 안 한다 (빈 화면 스크롤 금지)', () => {
    revealFirstMissing([]);
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
