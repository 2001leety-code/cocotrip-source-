// @vitest-environment jsdom
// Real wizard, request builder, quick handler, response parser and preview card.
// Only Firebase, Gemini and telemetry boundaries are replaced. No live keys.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WizardForm, type WizardInitialValues } from '../../src/components/WizardForm';
import { usePlannerHandlers } from '../../src/pages/PlannerPage/hooks/usePlannerHandlers';
import { QuickPreviewCard } from '../../src/pages/PlannerPage/components/QuickPreviewCard';
import { useLanguage } from '../../src/hooks/useLanguage';
import quickHandler from '../../api/ai-planner-quick.js';

const boundary = vi.hoisted(() => ({ model: vi.fn(), writes: new Map<string, unknown>(), requests: [] as Record<string, unknown>[] }));
vi.mock('../../src/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: null) => void) => { callback(null); return () => {}; },
}));
vi.mock('../../src/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('../../src/lib/analytics', () => ({ trackEvent: vi.fn(), markPlannerPendingComplete: vi.fn() }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (value: number) => value } }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    runTransaction: async (run: (tx: unknown) => unknown) => run({
      get: async (ref: { path: string }) => ({ exists: boundary.writes.has(ref.path), data: () => boundary.writes.get(ref.path) }),
      set: (ref: { path: string }, data: unknown) => boundary.writes.set(ref.path, data),
    }),
  }),
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: boundary.model }; } },
}));

const initial: WizardInitialValues = {
  reservationStatus: 'flight', arrivalAirport: 'PUS', arrivalTime: '09:00',
  regions: ['Busan'], categories: ['Kpop'], pax: 2,
  startDate: '2099-01-10', endDate: '2099-01-12',
};
const modelReply = {
  themes: ['Culture'], marketingNarrative: 'Explore Busan on your first day in this coastal city.',
  day1MarkdownTable: '| Time | Spot | Transit | Insider Tip |\n|---|---|---|---|\n| 10:00 | Haeundae Night | Start point | Arrive early |\n| 12:00 | Busan Museum | Bus 15 min | Check the special exhibits |\n| 14:00 | Beomeosa | Walk 10 min | Visit during quiet hours |',
};

function Journey({ values = initial }: { values?: WizardInitialValues }) {
  const { t } = useLanguage();
  const flow = usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: () => {} });
  return <>
    <WizardForm initialValues={values} isLoading={flow.status === 'loadingQuick'} onSubmit={flow.handleSubmit} />
    <output data-testid="preview-status">{flow.status}:{flow.errorCode}</output>
    {flow.resultQuick && <QuickPreviewCard p={t.planner} language="en" resultQuick={flow.resultQuick} />}
  </>;
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); boundary.writes.clear(); boundary.requests.length = 0;
  vi.stubEnv('GEMINI_API_KEY', 'offline-journey-test');
  boundary.model.mockReset().mockResolvedValue({ response: { text: () => JSON.stringify(modelReply) } });
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe('/api/ai-planner-quick');
    const body = JSON.parse(String(options.body)); boundary.requests.push(body);
    let code = 200; let payload = '';
    const res = { writeHead(status: number) { code = status; }, end(value: string) { payload = value; } };
    await quickHandler({ method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body }, res);
    return new Response(payload, { status: code, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('planner wizard → real quick handler → rendered preview', () => {
  async function openReview() {
    render(<MemoryRouter><Journey /></MemoryRouter>);
    const review = await screen.findByRole('button', { name: 'Step 5: Review + free preview' });
    await waitFor(() => expect(review).not.toBeDisabled());
    fireEvent.click(review);
    return screen.findByRole('button', { name: 'See day one free' });
  }

  it('valid reviewed input reaches the real handler and produces a usable preview', async () => {
    fireEvent.click(await openReview());
    await waitFor(() => expect(screen.getByTestId('preview-status')).toHaveTextContent('quickSuccess'));
    expect(boundary.requests).toHaveLength(1);
    expect(boundary.requests[0]).toMatchObject({ regions: ['Busan'], durationDays: 3, pax: 2, reservation_status: 'flight', arrival_airport: 'PUS' });
    expect(boundary.model).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Beomeosa', { exact: true })).toBeVisible();
    expect(screen.getAllByRole('link').some(link => link.getAttribute('href')?.includes('google.com/maps'))).toBe(true);
  });

  it('missing reservation input keeps the actual wizard at the first step and makes no request', async () => {
    render(<MemoryRouter><Journey values={{}} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Continue/i }));
    expect(await screen.findByText('Still needed before you continue')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Step 5: Review + free preview' })).toBeDisabled();
    expect(boundary.requests).toHaveLength(0);
    expect(boundary.model).not.toHaveBeenCalled();
  });

  it('a server generation failure does not unlock a usable preview or retry the HTTP request', async () => {
    boundary.model.mockRejectedValue(new Error('synthetic provider failure'));
    fireEvent.click(await openReview());
    await waitFor(() => expect(screen.getByTestId('preview-status')).toHaveTextContent('error:'));
    expect(boundary.requests).toHaveLength(1);
    expect(screen.queryByText('Beomeosa', { exact: true })).toBeNull();
  });

  it('releases the submit guard after failure so a later submit retries', async () => {
    boundary.model
      .mockRejectedValueOnce(new Error('synthetic provider failure'))
      .mockRejectedValueOnce(new Error('synthetic provider failure'))
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify(modelReply) } });
    const button = await openReview();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('preview-status')).toHaveTextContent('error:'));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('preview-status')).toHaveTextContent('quickSuccess'));
    expect(boundary.requests).toHaveLength(2);
    expect(boundary.model).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Beomeosa', { exact: true })).toBeVisible();
  });

  it('two clicks while generation is pending issue only one request', async () => {
    const pending: ((value: unknown) => void)[] = [];
    boundary.model.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    const button = await openReview();
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(boundary.requests.length).toBeGreaterThan(0));
    await waitFor(() => expect(pending).toHaveLength(boundary.requests.length));
    const count = boundary.requests.length;
    await act(async () => { pending.forEach(release => release({ response: { text: () => JSON.stringify(modelReply) } })); });
    expect(count).toBe(1);
  });
});
