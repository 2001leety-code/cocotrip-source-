// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const { authState, firestore } = vi.hoisted(() => ({
  authState: { current: { user: null as { uid: string; email?: string } | null, loading: false } },
  firestore: {
    doc: vi.fn((...path: unknown[]) => path),
    getDoc: vi.fn(),
    setDoc: vi.fn(async () => undefined),
    onSnapshot: vi.fn(() => vi.fn()),
    collection: vi.fn((...path: unknown[]) => path),
    query: vi.fn((value: unknown) => value),
    orderBy: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState.current }));
vi.mock('firebase/firestore', () => firestore);
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/tour-availability-store', () => ({ fetchMonthAvailability: vi.fn(async () => new Map()) }));
vi.mock('@/lib/analytics', () => ({ trackDateSelect: vi.fn(), trackTourBookingStart: vi.fn(), trackTourStep: vi.fn() }));

import { TOURS } from '../../src/data/tours';

// Firebase adapters are replaced before the actual UI module is evaluated.
const { TourBookingDialog } = await vi.importActual<{
  TourBookingDialog: React.ComponentType<{
    tour: (typeof TOURS)[number]; language: 'en'; trigger: React.ReactNode;
  }>;
}>('../../src/components/tours/TourBookingDialog');

const tour = TOURS.find((candidate) => candidate.id === 'tour-seoul-city')!;
const snapshotKey = `cocotrip:wizard:tour:${tour.id}`;

function saveSnapshot(values: Record<string, unknown>) {
  localStorage.setItem(snapshotKey, JSON.stringify({ ts: Date.now(), step: values.step || 1, values }));
}

function renderDialog() {
  return render(
    <MemoryRouter>
      <TourBookingDialog tour={tour} language="en" trigger={<button type="button">Open booking</button>} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  authState.current = { user: null, loading: false };
  firestore.getDoc.mockReset();
  firestore.setDoc.mockClear();
  vi.useRealTimers();
});

describe('TourBookingDialog restored booking state', () => {
  it('clamps a restored hanbok count and clears an unavailable restored slot before persistence', async () => {
    vi.useFakeTimers();
    saveSnapshot({ pax: 2, hanbokCount: 4, selectedSlotId: 'stale-slot', step: 1 });
    renderDialog();

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const saved = JSON.parse(localStorage.getItem(snapshotKey) || '{}');
    expect(saved.values).toMatchObject({ pax: 2, hanbokCount: 2, selectedSlotId: null });
  });

  it('fills an arriving profile once and preserves a manually edited phone on a profile refresh', async () => {
    authState.current = { user: { uid: 'profile-a' }, loading: false };
    let resolveFirstProfile: (snapshot: { exists: () => boolean; data: () => Record<string, unknown> }) => void = () => {};
    firestore.getDoc.mockImplementationOnce(() => new Promise((resolve) => { resolveFirstProfile = resolve; }));
    saveSnapshot({ pax: 2, date: '2030-01-01', driverLang: 'en', step: 2, phone: '', selectedSlotId: null });
    const view = renderDialog();
    fireEvent.click(view.getByRole('button', { name: 'Open booking' }));

    await waitFor(() => expect(firestore.getDoc).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveFirstProfile({ exists: () => true, data: () => ({ phoneNumber: '010-1234-5678', countryCode: 'KR' }) });
    });
    const phone = await waitFor(() => {
      const input = document.querySelector('input[inputmode="tel"]') as HTMLInputElement;
      expect(input.value).toBe('1012345678');
      return input;
    });

    fireEvent.change(phone, { target: { value: '1011111111' } });
    let resolveSecondProfile: (snapshot: { exists: () => boolean; data: () => Record<string, unknown> }) => void = () => {};
    firestore.getDoc.mockImplementationOnce(() => new Promise((resolve) => { resolveSecondProfile = resolve; }));
    authState.current = { user: { uid: 'profile-b' }, loading: false };
    view.rerender(
      <MemoryRouter>
        <TourBookingDialog tour={tour} language="en" trigger={<button type="button">Open booking</button>} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(firestore.getDoc).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveSecondProfile({ exists: () => true, data: () => ({ phoneNumber: '010-9999-9999', countryCode: 'KR' }) });
    });

    expect((document.querySelector('input[inputmode="tel"]') as HTMLInputElement).value).toBe('1011111111');
    expect(firestore.setDoc).toHaveBeenCalled();
  });
});
