// @vitest-environment jsdom
/** PR2 r8 — 같은 지점(≤50m, 서버가 합친 같은 숙소 표식)엔 좌표 기반 이동 대체 안내(도보·택시 카드)를 그리지 않는다. */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { planner: {} }, language: 'en' }) }));

import { TransitFallback } from '../../src/pages/PlanDetailPage/components/TransitFallback';

const P = { lat: 37.5636, lng: 126.9826 };

describe('TransitFallback — same spot', () => {
  it('two markers ≤ 50 m apart → nothing rendered', () => {
    const { container } = render(<TransitFallback prevLat={P.lat} prevLng={P.lng} prevName="Hotel" currLat={P.lat + 0.0002} currLng={P.lng} currName="Hotel" />);
    expect(container.textContent).toBe('');
  });
  it('500 m apart → the walk / taxi card is still shown', () => {
    const { container } = render(<TransitFallback prevLat={P.lat} prevLng={P.lng} prevName="A" currLat={P.lat + 0.0045} currLng={P.lng} currName="B" />);
    expect(container.textContent).toMatch(/walk/);
  });
});
