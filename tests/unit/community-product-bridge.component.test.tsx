// @vitest-environment jsdom
//
// 커뮤니티 → 자체 상품(플래너·차터) 연결 카드. (2026-08-02)
//
// 🔴 소스 문자열을 grep 하는 테스트는 증거가 아니다 — 컴포넌트가 렌더되지 않아도 통과한다.
//   그래서 실제로 렌더해서 링크가 보이는지, 클릭 시 어떤 속성이 나가는지 확인한다.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const trackEvent = vi.fn();
const posthogTrack = vi.fn();

// ⚠️ authFetch·storage-upload·useAuth 를 mock 하는 이유: 이들이 `@/lib/firebase` 를 끌어와
//    CI(FIREBASE_* env 없음)에서 수집 단계가 통째로 죽는다(선례: PR #1172).
vi.mock('../../src/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));
vi.mock('../../src/lib/posthog', () => ({ track: (...a: unknown[]) => posthogTrack(...a) }));
vi.mock('../../src/lib/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../src/lib/storage-upload', () => ({ uploadCommunityPhoto: vi.fn() }));
vi.mock('../../src/lib/appReady', () => ({ signalAppReady: vi.fn() }));
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en' }) }));

const { CommunityProductBridge } = await import('../../src/pages/CommunityPage');

void React;

/** 카드 하나를 라우터 안에서 렌더한다. */
function renderBridge(mobile = false) {
  return render(
    <MemoryRouter>
      <CommunityProductBridge mobile={mobile} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  trackEvent.mockClear();
  posthogTrack.mockClear();
});

describe('CommunityProductBridge', () => {
  it('플래너와 차터 두 자체 상품으로만 연결한다', () => {
    renderBridge();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/planner', '/charter']);
    // 아이콘만 있는 링크가 아니라 사람이 읽는 이름이 붙어 있어야 한다.
    expect(links[0]).toHaveAccessibleName(/itinerary/i);
    expect(links[1]).toHaveAccessibleName(/car quote/i);
  });

  it('클릭하면 product·placement·language 세 개만 보낸다', async () => {
    renderBridge();
    await userEvent.click(screen.getAllByRole('link')[0]);

    expect(trackEvent).toHaveBeenCalledWith('community_product_click', {
      product: 'planner', placement: 'community_right_rail', language: 'en',
    });
    expect(posthogTrack).toHaveBeenCalledWith('community_product_click', {
      product: 'planner', placement: 'community_right_rail', language: 'en',
    });
    // 개인정보·URL 이 속성에 섞여 나가지 않는지 키 자체를 확인한다.
    expect(Object.keys(trackEvent.mock.calls[0][1] as object).sort())
      .toEqual(['language', 'placement', 'product']);
  });

  it('모바일 카드는 노출 위치를 따로 구분해 보낸다', async () => {
    renderBridge(true);
    await userEvent.click(screen.getAllByRole('link')[1]);
    expect(trackEvent).toHaveBeenCalledWith('community_product_click', {
      product: 'charter', placement: 'community_mobile', language: 'en',
    });
  });
});
