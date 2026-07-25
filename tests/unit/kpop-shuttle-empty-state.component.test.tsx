// @vitest-environment jsdom
/**
 * K-pop 셔틀 배너 빈 상태 회귀 가드 (2026-07-25).
 *
 * 이전: 예정 공연 0건이면 `return null` → 차터 K-pop 탭이 **아무 설명 없는 빈 화면**.
 *   손님은 고장인지 품절인지 알 수 없었다. 2026-07 감사 시점 10건 중 7건이 만료라
 *   실제로 소멸 직전이었다.
 *
 * 이제: 안내 문구 + 문의(WhatsApp) 경로를 렌더한다. 이 테스트는 다시 무음(null)이 되면 실패한다.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

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

// 결제 버튼은 PayPal SDK 를 끌어오므로 렌더에서 제외 (빈 상태 경로에선 쓰이지도 않음).
vi.mock('../../src/components/PayPalBookingButton', () => ({ PayPalBookingButton: () => null }));

// 공연 목록을 0건으로 강제 — 데이터가 마른 미래 상태를 재현한다.
vi.mock('../../src/data/kpopConcerts', () => ({
  getUpcomingConcerts: () => [],
  KPOP_CONCERTS: [],
}));

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: {} }),
}));

const { KpopShuttleBanner } = await import('../../src/components/KpopShuttleBanner');

describe('KpopShuttleBanner — 예정 공연 0건', () => {
  it('무음(null) 대신 안내 문구를 렌더한다', () => {
    const { container } = render(<KpopShuttleBanner p={{}} />);
    expect(container.innerHTML.length, '빈 화면으로 돌아갔다 — 회귀').toBeGreaterThan(0);
    expect(screen.getByText(/No K-pop concert shuttles scheduled/i)).toBeTruthy();
  });

  it('문의 경로(WhatsApp 링크)를 제공한다', () => {
    render(<KpopShuttleBanner p={{}} />);
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.includes('wa.me'));
    expect(link, '빈 상태에서 손님이 취할 다음 행동이 없다').toBeTruthy();
  });
});
