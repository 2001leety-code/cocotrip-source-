// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAILY_TOUR_PRICES } from '../../src/data/charterPricing';
import { charterUsdFromKrw } from '../../src/lib/charterUsd';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';

void React;

const languageState = vi.hoisted(() => ({ value: 'ko' }));

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' } }),
}));

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: languageState.value, t: { planner: {} } }),
}));

interface MockOption {
  productType: string;
  label: string;
  priceKRW: number;
  expectedUSD?: number;
  detail?: string;
}

vi.mock('../../src/pages/PlanDetailPage/components/ads/InlineBookingCard', () => ({
  InlineBookingCard: (props: { title: string; subtitle: string; options: MockOption[] }) => (
    <div data-testid="inline-booking-card">
      <span data-testid="inline-title">{props.title}</span>
      <span data-testid="inline-subtitle">{props.subtitle}</span>
      {props.options.map((option) => (
        <span
          key={option.productType}
          data-testid={`option-${option.productType}`}
          data-price={String(option.priceKRW)}
          data-expected-usd={String(option.expectedUSD || '')}
        >
          {option.label} · {option.detail}
        </span>
      ))}
    </div>
  ),
}));

vi.mock('../../src/pages/PlanDetailPage/components/ads/CharterInquireModal', () => ({
  CharterInquireModal: (props: {
    open: boolean;
    tourKey: string;
    quotedKRW: number;
    hours: number;
    planId: string;
  }) => props.open ? (
    <div
      data-testid="charter-inquiry-modal"
      data-tour-key={props.tourKey}
      data-price={String(props.quotedKRW)}
      data-hours={String(props.hours)}
      data-plan-id={props.planId}
    />
  ) : null,
}));

const { CharterInlineAd } = await import(
  '../../src/pages/PlanDetailPage/components/ads/CharterInlineAd'
);
const { CharterBanner } = await import(
  '../../src/pages/PlanDetailPage/components/ads/CharterBanner'
);

function planWithStop(stop: Record<string, string>): PlanDocument {
  return {
    itinerary: {
      days: [{ day: 1, theme: 'sample', stops: [stop] }],
    },
  };
}

beforeEach(() => {
  languageState.value = 'ko';
});

afterEach(() => {
  cleanup();
});

describe('실제 노출 차터 카드 가격 정본', () => {
  it('경주·전주 화면가는 정본 ₩600,000이고 서버 대조 USD도 함께 넘긴다', () => {
    render(<CharterInlineAd region="gyeongju" planId="plan-gj" />);
    const option = screen.getByTestId('option-charter_gyeongju');
    expect(option.getAttribute('data-price')).toBe(String(DAILY_TOUR_PRICES['gyeongju-jeonju'].priceKRW));
    expect(option.getAttribute('data-price')).toBe('600000');
    expect(option.getAttribute('data-expected-usd')).toBe(String(charterUsdFromKrw(600000)));
    expect(screen.getByTestId('inline-subtitle').textContent).toContain('10시간/일');
  });

  it('부산은 busan-day 정본 키의 ₩450,000·10시간을 사용한다', () => {
    render(<CharterInlineAd region="busan" planId="plan-busan" />);
    const option = screen.getByTestId('option-charter_busan');
    expect(option.getAttribute('data-price')).toBe(String(DAILY_TOUR_PRICES['busan-day'].priceKRW));
    expect(option.textContent).toContain('10시간');
  });

  it.each([
    ['慶州', 'option-charter_gyeongju'],
    ['庆州', 'option-charter_gyeongju'],
    ['全州', 'option-charter_gyeongju'],
    ['江陵', 'option-charter_gangwon'],
    ['ソウル', 'option-charter_seoul_city'],
    ['首尔', 'option-charter_seoul_city'],
  ])('번역된 주 지역 %s도 같은 가격표 상품으로 연결한다', (region, optionTestId) => {
    render(<CharterInlineAd region={region} planId="localized-region" />);
    expect(screen.getByTestId(optionTestId)).toBeTruthy();
  });

  it.each(['済州', '济州'])('지원 가격표가 없는 번역 지역 %s에는 서울 상품을 임의 노출하지 않는다', (region) => {
    render(<CharterInlineAd region={region} planId="unsupported-localized-region" />);
    expect(screen.queryByTestId('inline-booking-card')).toBeNull();
  });
});

describe('실제 노출 차터 카드 문의 연결', () => {
  it('플랜 추천을 보여주고 클릭하면 서버 검증용 키·가격으로 모달을 연다', () => {
    const plan = planWithStop({ display_name: '경복궁', name_en: 'Gyeongbokgung Palace' });
    render(<CharterInlineAd region="seoul" planId="plan-seoul" plan={plan} />);

    fireEvent.click(screen.getByRole('button', { name: '이 일정으로 견적 문의' }));
    const modal = screen.getByTestId('charter-inquiry-modal');
    expect(modal.getAttribute('data-tour-key')).toBe('seoul-city');
    expect(modal.getAttribute('data-price')).toBe('330000');
    expect(modal.getAttribute('data-hours')).toBe('8');
    expect(modal.getAttribute('data-plan-id')).toBe('plan-seoul');
  });

  it('부산 중심 복합 일정은 서울 장소가 함께 있어도 부산 정본 견적을 연다', () => {
    const plan: PlanDocument = {
      itinerary: {
        days: [{
          day: 1,
          theme: 'mixed',
          stops: [
            { name_en: 'Gyeongbokgung Palace' },
            { display_name: '해운대 해수욕장', name_en: 'Haeundae Beach' },
          ],
        }],
      },
    };
    render(<CharterInlineAd region="busan" planId="plan-busan-mixed" plan={plan} />);

    fireEvent.click(screen.getByRole('button', { name: '이 일정으로 견적 문의' }));
    const modal = screen.getByTestId('charter-inquiry-modal');
    expect(modal.getAttribute('data-tour-key')).toBe('busan-day');
    expect(modal.getAttribute('data-price')).toBe('450000');
    expect(modal.getAttribute('data-hours')).toBe('10');
  });

  it('legacy area만 있는 플랜도 prop보다 플랜 원본을 우선해 서버와 같은 견적을 연다', () => {
    const plan: PlanDocument = {
      input: { area: 'busan' },
      itinerary: {
        days: [{ day: 1, theme: 'legacy', stops: [{ name_en: 'Haeundae Beach' }] }],
      },
    };
    render(<CharterInlineAd region="Seoul" planId="legacy-area" plan={plan} />);

    fireEvent.click(screen.getByRole('button', { name: '이 일정으로 견적 문의' }));
    expect(screen.getByTestId('charter-inquiry-modal').getAttribute('data-tour-key')).toBe('busan-day');
  });

  it('미인식 주 지역은 서버처럼 전체 후보 중 일치하는 최고 참고가를 고른다', () => {
    const plan: PlanDocument = {
      input: { regions: ['Daegu'] },
      itinerary: {
        days: [{
          day: 1,
          theme: 'legacy mixed',
          stops: [{ name_en: 'Gyeongbokgung Palace' }, { name_en: 'Bulguksa Temple' }],
        }],
      },
    };
    render(<CharterInlineAd region="Daegu" planId="unknown-region" plan={plan} />);

    fireEvent.click(screen.getByRole('button', { name: '이 일정으로 견적 문의' }));
    expect(screen.getByTestId('charter-inquiry-modal').getAttribute('data-tour-key')).toBe('gyeongju-jeonju');
  });

  it.each([
    ['ko', '이 일정으로 견적 문의'],
    ['en', 'Request a quote for this plan'],
    ['ja', 'この日程で見積もりを依頼'],
    ['zh', '按此行程申请报价'],
  ])('%s 문의 버튼이 읽을 수 있는 문구와 44px 터치 높이를 가진다', (language, buttonLabel) => {
    languageState.value = language;
    const plan = planWithStop({ name: '경복궁', name_en: 'Gyeongbokgung Palace' });
    render(<CharterInlineAd region="seoul" planId="plan-lang" plan={plan} />);
    const button = screen.getByRole('button', { name: buttonLabel });
    expect(button.className).toContain('min-h-[44px]');
  });

  it('추천 근거가 없는 플랜에는 임의 견적 문의를 만들지 않는다', () => {
    const plan = planWithStop({ name: 'Unknown place without pricing keyword' });
    render(<CharterInlineAd region="seoul" planId="plan-none" plan={plan} />);
    expect(screen.queryByRole('button', { name: '이 일정으로 견적 문의' })).toBeNull();
  });
});

describe('전체 차터 배너 문의 연결', () => {
  it('부산 중심 복합 일정도 서버와 같은 부산 견적을 연다', () => {
    const days = [{
      day: 1,
      theme: 'mixed',
      stops: [{ name_en: 'Gyeongbokgung Palace' }, { name_en: 'Haeundae Beach' }],
    }];
    const plan = { input: { regions: ['釜山'] }, itinerary: { days } } as PlanDocument;
    render(<CharterBanner days={days} plan={plan} />);

    fireEvent.click(screen.getByRole('button', { name: /Request quote in-app/ }));
    const modal = screen.getByTestId('charter-inquiry-modal');
    expect(modal.getAttribute('data-tour-key')).toBe('busan-day');
    expect(modal.getAttribute('data-price')).toBe('450000');
    expect(modal.getAttribute('data-hours')).toBe('10');
  });

  it('서울 시내와 남이섬이 함께 있으면 서버처럼 더 높은 근교 견적을 연다', () => {
    const days = [{
      day: 1,
      theme: 'mixed',
      stops: [{ name: 'irrelevant', display_name: '경복궁' }, { name_en: 'Nami Island' }],
    }];
    const plan = { input: { regions: ['ソウル'] }, itinerary: { days } } as PlanDocument;
    render(<CharterBanner days={days} plan={plan} />);

    fireEvent.click(screen.getByRole('button', { name: /Request quote in-app/ }));
    expect(screen.getByTestId('charter-inquiry-modal').getAttribute('data-tour-key')).toBe('seoul-suburb');
  });
});
