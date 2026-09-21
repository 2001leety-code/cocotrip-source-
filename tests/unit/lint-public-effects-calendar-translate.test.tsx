// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));

import { CalendarPicker } from '../../src/components/PlannerForm';
import { useAutoTranslate } from '../../src/pages/PlanDetailPage/useAutoTranslate';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';
import { getDoc } from 'firebase/firestore';

const calendarCopy: Record<string, unknown> = {
  calCheckIn: 'Check in', calCheckOut: 'Check out', calDepart: 'Depart', calReturn: 'Return',
  calNightsTravel: '{n} nights, {m} days', calDayTrip: 'Day trip', calConfirmN: 'Confirm {n} nights', calDaySelected: 'Confirm day trip',
  calYearMonth: '{month} {year}', calWeekdays: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  calMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const originalItinerary = { tour_title: 'Original', days: [] };
const originalPlan = {
  input: { language: 'en' },
  itinerary: originalItinerary,
} as PlanDocument;

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('public effects state', () => {
  // Travel startDate/endDate are inclusive: Jan 3–5 covers 3 travel days and 2 nights.
  it('keeps the calendar open while synchronizing only externally changed dates', () => {
    const onDateChange = vi.fn();
    const { rerender } = render(
      <CalendarPicker startDate="2030-01-03" endDate="2030-01-05" onDateChange={onDateChange} p={calendarCopy} />,
    );
    fireEvent.click(screen.getByText('Check in'));
    expect(screen.getByText('›')).toBeTruthy();

    rerender(<CalendarPicker startDate="2030-02-10" endDate="2030-02-12" onDateChange={onDateChange} p={calendarCopy} />);
    expect(screen.getByText('›')).toBeTruthy();
    expect(screen.getAllByText('2030-02-10').length).toBeGreaterThan(1);
  });

  it('translates, restores the original language, then translates again without a stale result', async () => {
    const responses = [
      { data: { translated: { tour_title: 'Japanese', days: [] } } },
      { data: { translated: { tour_title: 'Japanese again', days: [] } } },
    ];
    const fetchMock = vi.fn(() => Promise.resolve({ json: async () => responses.shift() }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ language }) => {
        const [plan, setPlan] = useState<PlanDocument | null>(originalPlan);
        return { ...useAutoTranslate(plan, setPlan, language), plan, setPlan };
      },
      { initialProps: { language: 'ja' } },
    );
    expect(result.current.isTranslating).toBe(true);
    await waitFor(() => expect(result.current.plan?.itinerary?.tour_title).toBe('Japanese'));
    expect(result.current.isTranslating).toBe(false);

    act(() => {
      result.current.setPlan((current) => current ? {
        ...current,
        itinerary: { ...current.itinerary },
      } : current);
    });
    expect(result.current.isTranslating).toBe(false);

    rerender({ language: 'en' });
    await waitFor(() => expect(result.current.plan?.itinerary?.tour_title).toBe('Original'));
    expect(result.current.isTranslating).toBe(false);

    rerender({ language: 'ja' });
    expect(result.current.isTranslating).toBe(true);
    await waitFor(() => expect(result.current.plan?.itinerary?.tour_title).toBe('Japanese again'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finishes a missing translation response and retries only after the language changes', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ json: async () => ({ data: { translated: null } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ language }) => {
        const [plan, setPlan] = useState<PlanDocument | null>(originalPlan);
        return useAutoTranslate(plan, setPlan, language);
      },
      { initialProps: { language: 'ja' } },
    );
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ language: 'ja' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ language: 'ko' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
  });

  it('retries a failed translation after switching languages', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ json: async () => ({ data: { translated: { tour_title: 'Korean', days: [] } } }) });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ language }) => {
        const [plan, setPlan] = useState<PlanDocument | null>(originalPlan);
        return { ...useAutoTranslate(plan, setPlan, language), plan };
      },
      { initialProps: { language: 'ja' } },
    );
    await waitFor(() => expect(result.current.translationError).toBe('temporary failure'));
    rerender({ language: 'ko' });
    await waitFor(() => expect(result.current.plan?.itinerary?.tour_title).toBe('Korean'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed cache result after changing back to the original language', async () => {
    let resolveCache!: (value: { exists: () => boolean; data: () => { itinerary: typeof originalItinerary; cachedAt: string; translatorVersion: number } }) => void;
    vi.mocked(getDoc).mockReturnValueOnce(new Promise((resolve) => { resolveCache = resolve; }) as never);
    const cachedPlan = { ...originalPlan, id: 'cached-plan' } as PlanDocument;
    const { result, rerender } = renderHook(
      ({ language }) => {
        const [plan, setPlan] = useState<PlanDocument | null>(cachedPlan);
        return { ...useAutoTranslate(plan, setPlan, language), plan };
      },
      { initialProps: { language: 'ja' } },
    );
    await waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    rerender({ language: 'en' });
    resolveCache({
      exists: () => true,
      data: () => ({ itinerary: { tour_title: 'Stale cache', days: [] }, cachedAt: new Date().toISOString(), translatorVersion: 2 }),
    });
    await waitFor(() => expect(result.current.plan?.itinerary?.tour_title).toBe('Original'));
    expect(result.current.isTranslating).toBe(false);
  });
});
