// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { fakeDb, fakeAuth, trackShare, updateDoc, doc, authListener, toastError } = vi.hoisted(() => ({
  fakeDb: {},
  fakeAuth: {},
  trackShare: vi.fn(),
  updateDoc: vi.fn(async () => {}),
  doc: vi.fn(() => ({})),
  authListener: vi.fn((_auth: unknown, next: (user: null) => void) => { next(null); return vi.fn(); }),
  toastError: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (...args: unknown[]) => authListener(...args as [unknown, (user: null) => void]) }));
vi.mock('firebase/firestore', () => ({ doc: (...args: unknown[]) => doc(...args), updateDoc: (...args: unknown[]) => updateDoc(...args) }));
vi.mock('@/lib/firebase', () => ({ auth: fakeAuth, db: fakeDb }));
vi.mock('@/lib/analytics', () => ({ trackShare: (...args: unknown[]) => trackShare(...args) }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn(async () => {}) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args), info: vi.fn() } }));

import { LanguageProvider } from '../../src/hooks/useLanguage';
import { ShareButton } from '../../src/pages/PlanDetailPage/components/ShareButton';

const plan = { isPublic: true, itinerary: { tour_title: 'Synthetic Seoul Plan' } } as never;
function renderShareButton(props: { plan?: unknown; planId?: string; isOwner?: boolean } = {}) {
  return render(
    <LanguageProvider>
      <ShareButton planId={props.planId || 'synthetic-plan'} plan={(props.plan || plan) as never} isOwner={props.isOwner || false} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('cocotrip_lang', 'en');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP request'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  localStorage.clear();
  trackShare.mockReset();
  doc.mockClear();
  updateDoc.mockReset();
  updateDoc.mockResolvedValue(undefined);
  authListener.mockClear();
  toastError.mockReset();
});

describe('PlanDetail ShareButton (real hooks, synthetic external boundaries)', () => {
  it('shares the public plan URL through Web Share and tracks the native share', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    renderShareButton({ isOwner: false });
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(share).toHaveBeenCalledWith({
      title: 'Synthetic Seoul Plan',
      url: 'https://cocotripkr.com/my-plans/synthetic-plan?shared=1',
    });
    expect(trackShare).toHaveBeenCalledWith('native', 'synthetic-plan');
    expect(authListener).toHaveBeenCalledWith(fakeAuth, expect.any(Function), expect.any(Function));
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('copies the public plan URL when Web Share is unavailable', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    renderShareButton({ isOwner: false });
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith('https://cocotripkr.com/my-plans/synthetic-plan?shared=1');
    expect(trackShare).toHaveBeenCalledWith('clipboard', 'synthetic-plan');
  });

  it('blocks an owner share while private and stays private when the Firestore toggle fails', async () => {
    const privatePlan = { isPublic: false, itinerary: { tour_title: 'Synthetic Seoul Plan' } } as never;
    const share = vi.fn(async () => {});
    updateDoc.mockRejectedValueOnce(new Error('synthetic Firestore rejection'));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    renderShareButton({ plan: privatePlan, isOwner: true });
    expect(screen.getByRole('button', { name: /share/i })).toBeDisabled();
    expect(share).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('switch')); });
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(doc).toHaveBeenCalledWith(fakeDb, 'plans', 'synthetic-plan');
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), { isPublic: true });
    expect(screen.getByRole('button', { name: /share/i })).toBeDisabled();
  });
});

