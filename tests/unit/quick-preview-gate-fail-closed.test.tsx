// @vitest-environment jsdom
/**
 * Quick-preview fail-closed gate (2026-08-24, planner-trust-course, client
 * hardening A/B).
 *
 * `usePlannerHandlers.handleSubmit` must only unlock `quickSuccess` — the
 * status `PlannerPage/index.tsx` (index.tsx:309) gates BOTH `QuickPreviewCard`
 * and `PurchaseSection` on — when the server's 200 body parses cleanly
 * through `parseQuickPreviewResponse` (`quickPreviewContract.ts`). This tests
 * the actual hook behavior end to end (status/errorCode/resultQuick after a
 * real `handleSubmit` call against a mocked fetch), not just the parser
 * function in isolation — a helper passing its own unit tests does not prove
 * the hook actually wires it into the gate.
 *
 * `spotDetails[].candidateId` is a field the server does not emit yet
 * (`api/ai-planner-quick.js`, out of scope for this client-only change) — the
 * parser requires it anyway, ahead of that server follow-up. The "missing
 * candidateId" case below is that anticipated regression, not a hypothetical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../src/lib/guestReader', () => ({
  isGuestAnonEnabled: () => false,
  shouldAttachGuestAnonToken: () => false,
}));
vi.mock('../../src/lib/analytics', () => ({ markPlannerPendingComplete: () => {} }));
vi.mock('../../src/lib/posthog', () => ({ track: async () => {} }));

const { usePlannerHandlers } = await import('../../src/pages/PlannerPage/hooks/usePlannerHandlers');

const VALUES: Partial<PlannerFormValues> = {
  regions: ['Busan'],
  categories: ['Food'],
  durationDays: 3,
  pax: 2,
  reservation_status: 'nothing',
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** A fully valid quick-preview 200 body — every field the parser requires. */
function buildValidData(): Record<string, unknown> {
  return {
    marketingNarrative: 'A great first day exploring Busan with beaches and food.',
    themes: ['Food', 'Coast'],
    day1MarkdownTable:
      '| Time | Spot | Transit | Insider Tip |\n' +
      '|---|---|---|---|\n' +
      '| 10:00 | Gamcheon Culture Village | Start point | Go early for photos |\n' +
      '| 12:30 | Jagalchi Market | Subway Line 1, 10 min | Try the fresh sashimi |\n' +
      '| 15:00 | Haeundae Beach | Bus 100, 15 min | Sunset spot |',
    spotDetails: [
      { spot: 'Gamcheon Culture Village', type: 'attraction', candidateId: 'attr-1', key: 'gamcheon', lat: 35.0975, lng: 129.0107 },
      { spot: 'Jagalchi Market', type: 'food', candidateId: 'food-1', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', address: 'Busan, South Korea' },
      { spot: 'Haeundae Beach', type: 'spot', candidateId: 'spot-1', name: 'Haeundae Beach', address: 'Busan, South Korea' },
    ],
    deferredCategories: ['Kpop'],
    reflectedConditions: ['Your travel dates'],
  };
}

async function submit(data: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data }));
  const { result } = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: () => {} }));
  await act(async () => {
    await result.current.handleSubmit(VALUES as PlannerFormValues);
  });
  return result;
}

describe('quick preview gate — fail-closed on malformed 200', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('a fully valid response unlocks quickSuccess', async () => {
    const result = await submit(buildValidData());
    expect(result.current.status).toBe('quickSuccess');
    expect(result.current.errorCode).toBeNull();
  });

  it('missing candidateId (anticipated server field) stays in error — quickSuccess/PurchaseSection never open', async () => {
    const data = buildValidData();
    data.spotDetails = (data.spotDetails as Array<Record<string, unknown>>).map(({ candidateId: _candidateId, ...rest }) => rest);
    const result = await submit(data);
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('INVALID_RESPONSE');
    expect(result.current.resultQuick).toBeNull();
  });

  it('duplicate candidateId across spotDetails stays in error', async () => {
    const data = buildValidData();
    const details = data.spotDetails as Array<Record<string, unknown>>;
    details[1].candidateId = details[0].candidateId;
    const result = await submit(data);
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('INVALID_RESPONSE');
  });

  it('wrong-language table header (en table missing "Insider Tip") stays in error', async () => {
    const data = buildValidData();
    data.day1MarkdownTable = (data.day1MarkdownTable as string).replace('Insider Tip', 'Tip');
    const result = await submit(data);
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('INVALID_RESPONSE');
  });

  it('a spotDetails entry typed "unknown" (never allowed) stays in error', async () => {
    const data = buildValidData();
    const details = data.spotDetails as Array<Record<string, unknown>>;
    details[0] = { spot: details[0].spot, type: 'unknown', candidateId: 'attr-1' };
    const result = await submit(data);
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('INVALID_RESPONSE');
  });

  it('a food detail with no placeId/coords/address (no usable identity) stays in error', async () => {
    const data = buildValidData();
    const details = data.spotDetails as Array<Record<string, unknown>>;
    details[1] = { spot: details[1].spot, type: 'food', candidateId: 'food-1' };
    const result = await submit(data);
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('INVALID_RESPONSE');
  });

  it('non-ascending stop times stay in error', async () => {
    const data = buildValidData();
    data.day1MarkdownTable = (data.day1MarkdownTable as string).replace('| 15:00 | Haeundae Beach', '| 11:00 | Haeundae Beach');
    const result = await submit(data);
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('INVALID_RESPONSE');
  });
});
