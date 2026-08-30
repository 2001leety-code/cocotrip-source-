import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const INDEX = read('src/pages/PlanDetailPage/index.tsx');
const MASTHEAD = read('src/pages/PlanDetailPage/components/PlanDocumentMasthead.tsx');
const STATE = read('src/pages/PlanDetailPage/components/PlanDocumentState.tsx');
const TABS = read('src/pages/PlanDetailPage/components/SectionTabs.tsx');
const SWIPE = read('src/pages/PlanDetailPage/components/SwipeContainer.tsx');
const DAY = read('src/pages/PlanDetailPage/components/DayTimeline.tsx');
const STOP = read('src/pages/PlanDetailPage/components/StopCard.tsx');
const CONSTANTS = read('src/pages/PlanDetailPage/constants.tsx');
const TRANSIT = read('src/pages/PlanDetailPage/components/TransitArrow.tsx');
const EDIT = read('src/pages/PlanDetailPage/components/EditModeToggle.tsx');
const ADD_STOP = read('src/pages/PlanDetailPage/components/AddStopModal.tsx');
const INTRO = read('src/pages/PlanDetailPage/components/IntroSlide.tsx');
const PRE_TRIP = read('src/pages/PlanDetailPage/components/PreTripSlide.tsx');
const ACTIVITY_GUIDE = read('src/pages/PlanDetailPage/components/ActivityGuideSlide.tsx');
const OUTRO = read('src/pages/PlanDetailPage/components/OutroSlide.tsx');
const AD = read('src/pages/PlanDetailPage/components/AdSlide.tsx');
const REVIEW_WRITE = read('src/components/ReviewWriteModal.tsx');
const ERROR = read('src/pages/PlanDetailPage/components/ErrorState.tsx');
const ROUTE_MAP = read('src/pages/PlanDetailPage/components/DayRouteMap.tsx');
const LIGHTBOX = read('src/pages/PlanDetailPage/components/Lightbox.tsx');
const TRANSIT_FALLBACK = read('src/pages/PlanDetailPage/components/TransitFallback.tsx');
const LODGING = read('src/pages/PlanDetailPage/components/LodgingBookend.tsx');
const ACTIVITY = read('src/pages/PlanDetailPage/components/ActivityMetaChips.tsx');
const SORTABLE = read('src/pages/PlanDetailPage/components/SortableStopCard.tsx');
const CONFIRM = read('src/pages/PlanDetailPage/components/ConfirmDialog.tsx');
const CHARTER = read('src/pages/PlanDetailPage/components/CharterCTA.tsx');
const INSIGHT = read('src/pages/PlanDetailPage/components/RouteInsightCard.tsx');
const OPTIMIZE = read('src/pages/PlanDetailPage/components/OptimizePanel.tsx');
const COMPARISON = read('src/pages/PlanDetailPage/components/TransitVsCharterCard.tsx');
const REVIEWS = read('src/components/ReviewList.tsx');
const REVIEW_CARD = read('src/components/ReviewCard.tsx');
const DAY_LABEL = read('src/pages/PlanDetailPage/lib/dayLabel.ts');
const CSS = read('src/index.css');
const EDITORIAL_CSS = read('src/styles/editorial.css');

describe('PlanDetailPage editorial execution document', () => {
  it('uses the shared paper shell and common state primitives', () => {
    expect(INDEX).toMatch(/className=[^\n]*ec-root/);
    expect(INDEX).toMatch(/data-testid="plan-document"/);
    expect(INDEX).toMatch(/<PlanDocumentMasthead/);
    expect(INDEX).toMatch(/<PlanDocumentState/);
    for (const primitive of ['EcLoading', 'EcEmpty', 'EcError']) expect(STATE).toContain(primitive);
  });

  it('removes the retired glossy mobile and refined seams', () => {
    expect(INDEX).not.toMatch(/MobilePlanResultHero|REFINED|refined-plandetail|planner-detail-mobile-ai/);
    expect(CSS).toMatch(/\.planner-detail-mobile-ai/);
  });

  it('keeps the existing data, editor, PDF, report, and review wiring', () => {
    for (const contract of [
      'onSnapshot',
      'usePlanEditor',
      'generatePDF',
      'ReportPlanModal',
      'ReviewList',
      'QualityWarningsPanel',
      'UserPlanNoticesPanel',
    ]) {
      expect(INDEX).toContain(contract);
    }
  });

  it('renders a factual document masthead without AI marketing', () => {
    expect(MASTHEAD).toMatch(/data-testid="plan-document-masthead"/);
    expect(MASTHEAD).toMatch(/<dl/);
    expect(MASTHEAD).toMatch(/documentRouteNote/);
    expect(MASTHEAD).not.toMatch(/AI itinerary|AI 일정|AI 旅程|AI 行程|gradient|backdrop-blur|shadow-\[/i);
  });

  it('uses no gradients, hard-coded dark palette, or framer-motion in owned display files', () => {
    for (const source of [
      INDEX, MASTHEAD, STATE, TABS, SWIPE, DAY, STOP, CONSTANTS, TRANSIT, EDIT, INTRO, ERROR,
      ADD_STOP, ROUTE_MAP, TRANSIT_FALLBACK, LODGING, ACTIVITY, SORTABLE, CONFIRM,
      CHARTER, INSIGHT, OPTIMIZE, COMPARISON, LIGHTBOX, PRE_TRIP, ACTIVITY_GUIDE, OUTRO, AD,
    ]) {
      expect(source).not.toMatch(/gradient|#0a0b14|text-white|bg-white\/\[|framer-motion/i);
    }
  });

  it('renders opaque modal scrims instead of unsupported token opacity utilities', () => {
    expect(ADD_STOP).toContain('bg-black/45');
    expect(ADD_STOP).toContain('data-testid="plan-add-stop-scrim"');
    expect(LIGHTBOX).toContain('bg-black/90');
    expect(LIGHTBOX).toContain('data-testid="plan-lightbox"');
    expect(ADD_STOP).not.toContain('bg-ec-inverse/');
    expect(LIGHTBOX).not.toContain('bg-ec-inverse/');
  });

  it('keeps every auxiliary slide on the paper palette', () => {
    expect(PRE_TRIP).toContain('data-testid="plan-pre-trip-slide"');
    expect(ACTIVITY_GUIDE).toContain('data-testid="plan-activity-guide-slide"');
    expect(OUTRO).toContain('data-testid="plan-outro-slide"');
    expect(AD).toContain('data-testid="plan-ad-slide"');
  });

  it('keeps navigation and editing controls at least 44px and fields at 16px', () => {
    expect(TABS).toMatch(/min-h-\[44px\]/);
    expect(TABS).toContain('top-14');
    expect(TABS).toContain('md:top-16');
    expect(EDIT).toMatch(/className=\{`ec-btn /);
    expect(EDIT).toContain('data-testid="plan-edit-toggle"');
    expect(EDIT).not.toContain('ec-btn-sm');
    expect(TRANSIT).not.toMatch(/min-h-\[36px\]/);
    expect(TRANSIT).not.toContain('ec-btn-sm');
    expect(EDITORIAL_CSS).toMatch(/--ec-button-height:\s+44px/);
    expect(ROUTE_MAP).toMatch(/data-route-map-control/);
    expect(CSS).toMatch(/\[data-testid="day-route-map"\] \.leaflet-control-zoom a[\s\S]*width: 44px/);
    expect(SORTABLE).toMatch(/h-11 w-11/);
    expect(CONFIRM).toMatch(/role="alertdialog"/);
    expect(CONFIRM).toContain("event.key === 'Escape'");
    expect(CONFIRM).toContain("event.key !== 'Tab'");
    expect(ADD_STOP).toMatch(/text-base/);
    expect(ADD_STOP).toMatch(/min-h-\[44px\]/);
    expect(ADD_STOP).toContain('data-testid="plan-add-stop-modal"');
    expect(DAY).toContain('data-testid="plan-add-stop"');
    expect(ADD_STOP).toContain("event.key === 'Escape'");
    expect(ADD_STOP).toContain('element.getClientRects().length > 0');
    expect(ADD_STOP).toContain("t.a11y?.close || 'Close'");
    expect(SORTABLE).toContain('data-testid="plan-stop-mobile-edit-controls"');
    expect(SORTABLE).toContain('data-testid="plan-stop-user-added"');
    expect(SORTABLE).toContain("editMode ? 'relative mb-2 ml-auto w-fit");
    expect(SORTABLE).not.toContain('rounded-ec-pill');
  });

  it('uses the paper-compatible review surface without changing review actions', () => {
    expect(INDEX).toMatch(/<ReviewList[^>]*surface="paper"/);
    expect(REVIEWS).toMatch(/surface\?: 'legacy' \| 'paper'/);
    for (const contract of ["action: 'list'", 'ReviewCard', 'ReviewWriteModal']) expect(REVIEWS).toContain(contract);
    expect(REVIEWS).toContain('(paper || reviews.length > 0)');
    expect(REVIEW_CARD).toContain('useState<{ src: string; index: number } | null>');
    expect(REVIEW_CARD).toContain('String(lightbox.index)');
    expect(REVIEW_CARD).toContain('src={lightbox.src}');
  });

  it('localizes conditional stop details on the document surface', () => {
    for (const key of ['ui.pdfReservationRequired', 'ui.pdfRecommended', 'ui.bookOnline']) {
      expect(STOP).toContain(key);
    }
    expect(STOP).not.toMatch(/>Reservation required<|>Recommended<|> Book online/);
  });

  it('supports normal, loading, empty, error, not-found, permission, and partial state hooks', () => {
    expect(STATE).toContain('plan-detail-${kind}');
    for (const state of ['loading', 'empty', 'error', 'not-found', 'permission', 'partial']) expect(STATE).toContain(`'${state}'`);
    expect(INDEX).toContain('plan-document-ready');
    expect(INDEX).toMatch(/kind="not-found"[\s\S]*?to="\/planner"[\s\S]*?ui\.createNewPlan/);
    expect(STATE).not.toMatch(/className="ec-card">\s*<Ec(?:Empty|Error)/);
  });

  it('adds the document copy to all four locales with identical keys', () => {
    const localeKeys = ['documentEyebrow', 'documentIntro', 'documentRouteNote', 'documentReady', 'documentPartial', 'emptyPlanTitle', 'emptyPlanBody', 'backToPlans', 'refreshPage', 'bookOnline', 'openPhoto'];
    for (const locale of ['ko', 'en', 'ja', 'zh']) {
      const parsed = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      const ui = parsed.planDetail.ui;
      for (const key of localeKeys) expect(ui[key]).toEqual(expect.any(String));
      for (const deadKey of ['planHeaderBadge', 'planOptimizeChip', 'planStayChip', 'planStatOptimize', 'planStatDistance', 'planTravelersSuffix', 'planStopsSuffix']) {
        expect(ui).not.toHaveProperty(deadKey);
      }
      expect(parsed.planDetail.swipe.tabsNavLabel).toEqual(expect.any(String));
      expect(parsed.planDetail.swipe.translationInProgress).toEqual(expect.any(String));
      expect(parsed.planDetail.day1ArrivalOnlyTitle).toEqual(expect.any(String));
      expect(parsed.planDetail.day1ArrivalOnlyHint).toContain('{{time}}');
    }
  });

  it('shows the late-arrival note only for a lodging-only first day', () => {
    expect(DAY).toContain("stops.length === 1 && stops[0]?.category === 'lodging'");
  });

  it('formats day labels natively in all four languages', () => {
    expect(TABS).toContain('formatDayLabel');
    expect(DAY).toContain('dayLabelParts');
    for (const label of ['일차', '日目', "prefix: '第'", "suffix: '天'"]) expect(DAY_LABEL).toContain(label);
  });

  it('localizes duplicate route labels and excludes visually hidden modal controls', () => {
    expect(INTRO).toContain('regionNames[key.toLowerCase()]');
    expect(DAY).toContain('regionNames[cityKey.toLowerCase()]');
    expect(REVIEW_WRITE).toContain('element.getClientRects().length > 0');
    expect(REVIEW_WRITE).toContain('setError(validationError)');
    expect(REVIEW_WRITE).toContain('focusIsOutside');
    expect(LIGHTBOX).toContain("e.key === 'Tab'");
    expect(LIGHTBOX).toContain('previousFocus?.focus()');
    expect(INTRO).not.toContain('<h2');
    expect(INTRO).toContain('countVisibleStops');
    expect(read('src/pages/PlanDetailPage/components/ShareButton.tsx')).toContain('data-testid="plan-share-mini"');
    expect(read('src/pages/PlanDetailPage/components/ShareButton.tsx')).toContain('min-h-[44px]');
    expect(CONFIRM).toContain('}, [open]);');
    expect(ADD_STOP).toContain('}, [open]);');
    expect(REVIEW_WRITE).toContain('}, [paper]);');
    expect(LIGHTBOX).toContain('}, []);');
  });

  it('keeps traveler totals factual and streaming progress localized', () => {
    expect(MASTHEAD).toContain('const hasAdults = Number.isFinite(adults) && adults > 0');
    expect(MASTHEAD).toContain(': hasPax ? pax : 0');
    expect(MASTHEAD).toContain('{ icon: CalendarRange, label: ui.documentStartDate');
    expect(INDEX).toContain('formatDayLabel(language, streamingProgress)');
    expect(INDEX).toContain('body={streamingTimedOut ? ui.streamingTimeoutBody : ui.partialPlanBody}');
    expect(INDEX).toContain('getPlanDocumentStatus(plan, Boolean(isStreamingInProgress))');
  });
});
