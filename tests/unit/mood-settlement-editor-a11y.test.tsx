// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

import { MoodSettlementEditor, type SettlementBooking } from '../../src/components/mood/MoodSettlementEditor';

const booking: SettlementBooking = {
  id: 'MOOD-20260820',
  date: '2026-08-20',
  startTime: '09:30',
  durationHours: 10,
  serviceType: 'vehicle',
  amountKRW: 537740,
  status: 'confirmed',
  revision: 2,
  breakdown: { baseKRW: 300000, distanceSurchargeKRW: 228540, tollKRW: 9200, km: 380.9 },
  tollMode: 'itemized' as const,
  tollEntries: [
    { label: '서울 → 평택', date: '2026-08-20 11:23', amountKRW: 5100, status: 'pending' as const, includedInSettlement: true, evidenceRef: '하이패스 캡처' },
  ],
};

beforeEach(() => {
  authFetchMock.mockReset();
});

afterEach(() => cleanup());

describe('MoodSettlementEditor — a11y fixes', () => {
  it('component renders without error', () => {
    const { container } = render(
      <MoodSettlementEditor
        booking={booking}
        mode="initial"
        onClose={() => {}}
        onCompleted={() => {}}
      />
    );
    expect(container.querySelector('section')).toBeTruthy();
  });

  it('no duplicate dom ids in document', () => {
    const { container } = render(
      <MoodSettlementEditor
        booking={booking}
        mode="initial"
        onClose={() => {}}
        onCompleted={() => {}}
      />
    );

    const allIds = Array.from(container.querySelectorAll('[id]')).map(el => el.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it('component contains min-h-[44px] styling for accessibility targets', () => {
    const { container } = render(
      <MoodSettlementEditor
        booking={booking}
        mode="initial"
        onClose={() => {}}
        onCompleted={() => {}}
      />
    );

    // Check for buttons and interactive elements with touch target sizing
    const touchTargets = container.querySelectorAll('[class*="min-h-[44px]"]');
    expect(touchTargets.length).toBeGreaterThan(0);
  });

  it('component contains focus-visible styling for keyboard navigation', () => {
    const { container } = render(
      <MoodSettlementEditor
        booking={booking}
        mode="initial"
        onClose={() => {}}
        onCompleted={() => {}}
      />
    );

    // Check for focus styling on interactive elements
    const focusStyled = container.querySelectorAll('[class*="focus-visible"]');
    expect(focusStyled.length).toBeGreaterThan(0);
  });
});
