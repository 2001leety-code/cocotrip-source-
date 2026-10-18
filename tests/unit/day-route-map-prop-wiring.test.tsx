// @vitest-environment jsdom
// Real index → DayTimeline → DayRouteMap and MapPage → DayRouteMap prop wiring.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlanDetailPage from '../../src/pages/PlanDetailPage';
import MapPage from '../../src/pages/MapPage';

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
const leaflet = vi.hoisted(() => ({ map: vi.fn(), polyline: vi.fn(), marker: vi.fn(), remove: vi.fn() }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
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
vi.mock('../../src/pages/PlanDetailPage/hooks/usePlanEditor', () => ({
  usePlanEditor: () => ({
    isRecalculating: false, deleteStop: () => {}, addStop: () => {}, reorderStops: () => {}, applyStopOrder: () => {},
  }),
}));
vi.mock('../../src/pages/PlanDetailPage/hooks/usePlanCompletionTracking', () => ({ usePlanCompletionTracking: () => {} }));
vi.mock('../../src/pages/PlanDetailPage/components/EditModeToggle', () => ({ EditModeToggle: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/AddStopModal', () => ({ AddStopModal: () => null }));
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
// Record the props each caller passes, then render the real map underneath.
vi.mock('../../src/pages/PlanDetailPage/components/DayRouteMap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pages/PlanDetailPage/components/DayRouteMap')>();
  const { createElement } = await import('react');
  type Props = Parameters<typeof actual.DayRouteMap>[0];
  return {
    DayRouteMap: (props: Props) => createElement('div', {
      'data-testid': 'route-map-props',
      'data-scope': props.routeScopeKey,
      'data-stops': props.stops.map(stop => stop.name || stop.display_name).join('|'),
    }, createElement(actual.DayRouteMap, props)),
  };
});
vi.mock('leaflet', () => {
  const layer = () => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis() });
  return { default: { ...leaflet, tileLayer: layer, divIcon: vi.fn(), latLngBounds: () => ({ extend: vi.fn() }) } };
});

const days = [
  { day: 1, stops: [
    { category: 'culture', name: 'Palace', lat: 37.58, lng: 126.98 },
    { category: 'culture', name: 'Museum', lat: 37.59, lng: 126.99 },
  ] },
  { day: 2, stops: [
    { category: 'market', name: 'Market', lat: 37.57, lng: 127.0 },
    { category: 'park', name: 'Forest', lat: 37.54, lng: 127.04 },
  ] },
];

function mapProps(nodes: HTMLElement[]) {
  return nodes.map(node => [node.getAttribute('data-scope'), node.getAttribute('data-stops')]);
}
function renderedMaps() {
  return mapProps(screen.queryAllByTestId('route-map-props'));
}
// SwipeContainer keeps inactive slides mounted but aria-hidden/inert.
function visibleMaps() {
  return mapProps(screen.queryAllByTestId('route-map-props').filter(node => !node.closest('[aria-hidden="true"]')));
}

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no layout; SectionTabs scrolls the active tab after a tab change.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, '', '/');
  leaflet.map.mockReturnValue({ fitBounds: vi.fn(), invalidateSize: vi.fn(), remove: leaflet.remove });
  leaflet.polyline.mockImplementation(() => ({ addTo: vi.fn() }));
  leaflet.marker.mockImplementation(() => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe('day route map prop wiring', () => {
  it('shows the selected day scope and stops from the plan page through DayTimeline without fetching routes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    firestore.onSnapshot.mockImplementation((_ref: unknown, next: (snap: unknown) => void) => {
      void Promise.resolve().then(() => next({
        exists: () => true,
        data: () => ({ uid: 'u1', status: 'ready', input: { language: 'en' }, itinerary: { tour_title: 'Trip', days } }),
      }));
      return () => {};
    });
    render(
      <MemoryRouter initialEntries={['/my-plans/p1']}>
        <Routes><Route path="/my-plans/:planId" element={<PlanDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(renderedMaps()).toEqual([
      ['p1:day:0', 'Palace|Museum'],
      ['p1:day:1', 'Market|Forest'],
    ]));
    // The intro slide opens first; no day map is visible yet.
    expect(visibleMaps()).toEqual([]);

    fireEvent.click(screen.getByRole('tab', { name: 'Day 2' }));
    expect(visibleMaps()).toEqual([['p1:day:1', 'Market|Forest']]);
    expect(screen.getByRole('tab', { name: 'Day 2' })).toHaveAttribute('aria-selected', 'true');
    expect(window.location.hash).toBe('#slide-2');
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Day 1' }));
    expect(visibleMaps()).toEqual([['p1:day:0', 'Palace|Museum']]);
    expect(window.location.hash).toBe('#slide-1');

    await waitFor(() => expect(leaflet.map).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the selected saved plan/day scope from MapPage without fetching routes', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    firestore.getDocs.mockResolvedValue({ docs: [{
      id: 'ref-1', data: () => ({ planId: 'p1', status: 'ready', createdAt: '2026-10-01T00:00:00.000Z', tourTitle: 'Trip' }),
    }] });
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ itinerary: { tour_title: 'Trip', days } }) });
    render(<MemoryRouter initialEntries={['/map']}><MapPage /></MemoryRouter>);
    await waitFor(() => expect(renderedMaps()).toEqual([['p1:day:0', 'Palace|Museum']]));
    fireEvent.click(screen.getByRole('tab', { name: 'Day 2' }));
    expect(renderedMaps()).toEqual([['p1:day:1', 'Market|Forest']]);
    expect(screen.getByRole('button', { name: 'Show transit route' })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
