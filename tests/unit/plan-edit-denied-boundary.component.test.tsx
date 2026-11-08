// @vitest-environment jsdom
// Real PlanDetailPage + real usePlanEditor; child event drivers and external services mocked.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlanDetailPage from '../../src/pages/PlanDetailPage';

void React;
const firestore = vi.hoisted(() => ({
  doc: vi.fn(() => ({})), onSnapshot: vi.fn(), collection: vi.fn(() => ({})), query: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})), limit: vi.fn(() => ({})), getDocs: vi.fn(), getDoc: vi.fn(),
  updateDoc: vi.fn(), setDoc: vi.fn(),
}));
const session = vi.hoisted(() => ({
  auth: { user: { uid: 'u1', email: '' }, loading: false },
  language: { language: 'en', t: {}, changeLanguage: () => {} },
}));
const effects = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), authFetch: vi.fn(), optimizeRejected: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: effects.error, success: effects.success } }));
vi.mock('@/lib/authFetch', () => ({ authFetch: effects.authFetch }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/lib/firebase-auth', () => ({ auth: { get currentUser() { return session.auth.user; } } }));
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => session.auth }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => session.language }));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('../../src/hooks/useWizardPersistence', () => ({ clearPlannerWizardSnapshot: () => {} }));
vi.mock('../../src/lib/analytics', () => ({ trackEvent: () => {} }));
vi.mock('../../src/lib/posthog', () => ({ track: () => {} }));
vi.mock('../../src/sections/Header', () => ({ Header: () => null }));
vi.mock('../../src/sections/Footer', () => ({ Footer: () => null }));
vi.mock('../../src/components/ReviewList', () => ({ ReviewList: () => null }));
vi.mock('../../src/components/ui/states', () => ({ EcLoading: () => null, EcEmpty: () => null, EcError: () => null }));
vi.mock('../../src/pages/PlanDetailPage/useAutoTranslate', () => ({
  useAutoTranslate: () => ({ isTranslating: false, translationError: null }),
}));
vi.mock('../../src/pages/PlanDetailPage/pdfGenerator', () => ({ generatePDF: () => Promise.resolve() }));
vi.mock('../../src/pages/PlanDetailPage/hooks/usePlanCompletionTracking', () => ({ usePlanCompletionTracking: () => {} }));
vi.mock('../../src/pages/PlanDetailPage/components/EditModeToggle', () => ({ EditModeToggle: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ErrorState', () => ({ ErrorState: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/PlanDocumentMasthead', () => ({ PlanDocumentMasthead: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/PlanDocumentState', () => ({ PlanDocumentState: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ReportPlanModal', () => ({ ReportPlanModal: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/RecommendedRestaurants', () => ({ RecommendedRestaurants: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/PreTripSlide', () => ({ PreTripSlide: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/IntroSlide', () => ({ IntroSlide: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/OutroSlide', () => ({ OutroSlide: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ActivityGuideSlide', () => ({ ActivityGuideSlide: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/AdSlide', () => ({ AdSlide: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/QualityWarningsPanel', () => ({ QualityWarningsPanel: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/UserPlanNoticesPanel', () => ({ UserPlanNoticesPanel: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/TransitArrow', () => ({ TransitArrow: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/TransitFallback', () => ({ TransitFallback: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/SortableStopCard', () => ({ SortableStopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/StopCard', () => ({ StopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/CharterCTA', () => ({ CharterCTA: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/RouteInsightCard', () => ({ RouteInsightCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/OptimizePanel', () => ({ OptimizePanel: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/LodgingBookend', () => ({ LodgingBookend: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ActivityMetaChips', () => ({ ActivityMetaChips: () => null }));

vi.mock('../../src/pages/PlanDetailPage/components/SwipeContainer', () => ({ SwipeContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../src/pages/PlanDetailPage/components/SectionTabs', () => ({ SectionTabs: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/DayTimeline', () => ({ DayTimeline: (p: { day: { stops: { name?: string }[] }; onDeleteStop: (d: number, s: number) => void; onAddStop: (d: number) => void; onApplyOrder: (d: number, o: number[]) => Promise<void> }) => <div>
  <output data-testid="stops">{p.day.stops.map(s => s.name).join('|')}</output>
  <button onClick={() => p.onDeleteStop(0, 0)}>Delete driver</button>
  <button onClick={() => p.onAddStop(0)}>Add driver</button>
  <button onClick={() => { void p.onApplyOrder(0, [1, 0]).catch(effects.optimizeRejected); }}>Optimize driver</button>
</div> }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
 const original = await importOriginal<typeof import('@dnd-kit/core')>();
 return { ...original, DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (e: { active: { id: string }; over: { id: string } }) => void }) => <div>{children}<button onClick={() => onDragEnd({ active: { id: 'day-0-stop-0' }, over: { id: 'day-0-stop-1' } })}>Drag driver</button></div> };
});
let scopeId = 0;
beforeEach(() => {
 session.auth.user.uid = 'u' + (++scopeId);
 vi.clearAllMocks();
 vi.stubGlobal('crypto', { randomUUID: () => 'synthetic-request', subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
 vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); }));
 vi.spyOn(console, 'error').mockImplementation(() => {});
 firestore.onSnapshot.mockImplementation((_ref: unknown, optionsOrNext: unknown, callback: unknown) => {
  const next = (typeof optionsOrNext === 'function' ? optionsOrNext : callback) as (s: unknown) => void;
  void Promise.resolve().then(() => next({ exists: () => true, data: () => ({ planId: 'synthetic', uid: session.auth.user.uid, status: 'ready', input: { language: 'en' }, itinerary: { tour_title: 'Synthetic', days: [{ day: 1, stops: [{ name: 'Alpha', category: 'culture' }, { name: 'Beta', category: 'culture' }] }] } }) }));
  return () => {};
 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('real page/editor denied-save integration', () => {
 it.each(['delete', 'add', 'drag', 'optimize'] as const)('%s catches at UI boundary with one error notice and no recalculation', async kind => {
  let rejectWrite!: (e: unknown) => void;
  effects.authFetch.mockImplementation(() => new Promise<Response>((_r, reject) => { rejectWrite = reject; }));
  const unhandled = vi.fn(); window.addEventListener('unhandledrejection', unhandled);
  render(<MemoryRouter initialEntries={['/my-plans/synthetic']}><Routes><Route path="/my-plans/:planId" element={<PlanDetailPage />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('stops')).toHaveTextContent('Alpha|Beta'));
  await act(async () => { await Promise.resolve(); });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: kind === 'delete' ? 'Delete driver' : kind === 'add' ? 'Add driver' : kind === 'drag' ? 'Drag driver' : 'Optimize driver' }));
  if (kind === 'add') {
   fireEvent.change(screen.getByLabelText('Place name'), { target: { value: 'Gamma' } });
   fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
  }
  expect(effects.authFetch).toHaveBeenCalledTimes(1);
  expect(effects.authFetch.mock.calls[0][0]).toBe('/api/plan-edit');
  expect(Object.keys(JSON.parse(effects.authFetch.mock.calls[0][1].body)).sort()).toEqual(['expectedFingerprint', 'operation', 'planId', 'requestId']);
  expect(firestore.updateDoc).not.toHaveBeenCalled();
  await act(async () => { rejectWrite(Object.assign(new Error('synthetic denied'), { code: 'permission-denied' })); });
  expect(screen.getByTestId('stops')).toHaveTextContent('Alpha|Beta');
  const notice = screen.getByText('The save result is not yet confirmed. Check the same request in this tab.'); expect(notice).toBeVisible(); expect(notice).toHaveTextContent('not yet confirmed'); expect(effects.error).not.toHaveBeenCalled(); expect(effects.success).not.toHaveBeenCalled();
  if (kind === 'optimize') expect(effects.optimizeRejected).toHaveBeenCalledTimes(1);
  if (kind === 'add') { expect(screen.getByRole('alert')).toHaveTextContent('not yet confirmed'); expect(screen.getByLabelText('Place name')).toHaveValue('Gamma'); }
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(effects.authFetch).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); expect(unhandled).not.toHaveBeenCalled();
  window.removeEventListener('unhandledrejection', unhandled);
 });
});
