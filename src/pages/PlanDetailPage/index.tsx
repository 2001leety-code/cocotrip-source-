// PlanDetailPage container: Firestore listener + swipe carousel + edit mode.
// Split from src/pages/PlanDetailPage.tsx (1144L) during P2 Lock release.
// LOCKED regions moved out:
//   - auto-translate useEffect  -> ./useAutoTranslate.ts
//   - handleDownloadPDF body    -> ./pdfGenerator.ts
// PDF button keeps `disabled={isPdfGenerating || isTranslating}` exactly as before.
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useIsMobile } from '@/hooks/use-mobile';
import { AlertCircle } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import { ReviewList } from '@/components/ReviewList';

import { useAutoTranslate } from './useAutoTranslate';
import { generatePDF } from './pdfGenerator';
import { DayTimeline } from './components/DayTimeline';
import { EditModeToggle } from './components/EditModeToggle';
import { AddStopModal } from './components/AddStopModal';
import { SwipeContainer } from './components/SwipeContainer';
import { SlideProgress } from './components/SlideProgress';
import { IntroSlide } from './components/IntroSlide';
import { OutroSlide } from './components/OutroSlide';
import { AdSlide } from './components/AdSlide';
import { usePlanEditor } from './hooks/usePlanEditor';
import { useSwipeNavigation } from './hooks/useSwipeNavigation';
import { buildSlides } from './lib/buildSlides';
import type { PlanDocument } from './types';
import { getPlanDetailUI } from './types';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';

export default function PlanDetailPage() {
  const { planId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { user, loading: authLoading } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const [plan, setPlan] = useState<PlanDocument | null>(null);
  const [error, setError] = useState<'notfound' | 'unauthorized' | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [addStopDay, setAddStopDay] = useState<number | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Plan editor (optimistic Firestore updates + auto transit recalc)
  const editor = usePlanEditor(planId || '', plan, setPlan);

  // Drag sensors with distance constraint for mobile scroll compatibility
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Build slide array from plan data
  const slides = useMemo(() => (plan ? buildSlides(plan) : []), [plan]);
  const { current, goToSlide } = useSwipeNavigation(slides.length);

  // Firestore listener
  useEffect(() => {
    if (!planId) { setError('notfound'); setLoading(false); return; }
    if (authLoading) return;
    setError(null);
    setLoading(true);
    const unsub = onSnapshot(doc(db, 'plans', planId), (snap) => {
      if (!snap.exists()) { setError('notfound'); setLoading(false); return; }
      const data = snap.data() as PlanDocument;
      const ownerCheck = !!(user && data.uid === user.uid);
      const hasToken = data.accessToken && data.accessToken === token;
      const isGuestPlan = !data.uid;
      const isPublicShared = data.isPublic === true;
      if (!ownerCheck && !hasToken && !isGuestPlan && !isPublicShared) { setError('unauthorized'); setLoading(false); return; }
      // PII masking for non-owner viewing public plan
      if (isPublicShared && !ownerCheck && !hasToken && !isGuestPlan) {
        delete data.uid; delete data.guestEmail;
        delete data.accessToken;
        if (data.input) {
          delete data.input.specialRequest;
          delete data.input.hotel_address;
          delete data.input.arrival_airport;
          delete data.input.departure_airport;
        }
        delete data.pricing;
      }
      setIsOwner(ownerCheck);
      setPlan(data);
      setLoading(false);
    }, (err) => {
      console.error('[PlanDetail] Firestore read error:', err);
      setError('notfound');
      setLoading(false);
    });
    return () => unsub();
  }, [planId, token, user, authLoading]);

  // share_visit tracking
  useEffect(() => {
    if (searchParams.get('shared') === '1' && planId) {
      trackEvent('share_visit', { plan_id: planId });
    }
  }, [planId, searchParams]);

  // Dynamic OG meta tags
  const days = useMemo(() => (plan?.itinerary?.days) || [], [plan]);
  usePageMeta({
    title: plan?.itinerary?.tour_title || 'Travel Plan',
    description: `${plan?.input?.area || 'Korea'} ${days.length}-day itinerary | CocoTrip`,
    ogImage: `https://cocotripkr.com/api/og-image?planId=${planId}`,
    ogUrl: `https://cocotripkr.com/my-plans/${planId}`,
  });

  // Auto-translate (locked hook - see useAutoTranslate.ts for invariants)
  const { isTranslating } = useAutoTranslate(plan, setPlan, language);

  // PDF download (locked module - see pdfGenerator.ts for invariants)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const handleDownloadPDF = useCallback(async () => {
    if (!plan) return;
    setIsPdfGenerating(true);
    try {
      const uiDict = getPlanDetailUI(t);
      await generatePDF(plan, uiDict);
    } finally {
      setIsPdfGenerating(false);
    }
  }, [plan, t]);

  // Loading / Error states
  if (loading) {
    const ui = getPlanDetailUI(t);
    return (
    <div className="min-h-screen bg-[#0a0b14] text-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#7C5CFC] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-white/40 text-sm">{ui.loadingPlan || 'Loading your plan...'}</p>
      </div>
    </div>
  );
  }

  if (error === 'notfound') {
    const ui = getPlanDetailUI(t);
    return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <AlertCircle className="w-16 h-16 text-red-400/40 mb-4" />
        <h1 className="text-xl font-bold mb-2">{ui.planNotFound || 'Plan Not Found'}</h1>
        <p className="text-white/40 text-sm mb-6">{ui.planNotFoundDesc || 'This plan may have been deleted or the link is invalid.'}</p>
        <Link to="/planner" className="px-6 py-3 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>{ui.createNewPlan || 'Create New Plan'}</Link>
      </div>
    </div>
  );
  }

  if (error === 'unauthorized') {
    const ui = getPlanDetailUI(t);
    return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <AlertCircle className="w-16 h-16 text-yellow-400/40 mb-4" />
        <h1 className="text-xl font-bold mb-2">{ui.accessDenied || 'Access Denied'}</h1>
        <p className="text-white/40 text-sm mb-6">{ui.accessDeniedDesc || "You don't have permission to view this plan."}</p>
      </div>
    </div>
  );
  }

  if (!plan) return null;

  // days already defined above via useMemo

  // Render each slide based on type
  const slideElements = slides.map((slide, idx) => {
    switch (slide.type) {
      case 'intro':
        return <IntroSlide key={`intro-${idx}`} plan={plan} planId={planId || ''} isTranslating={isTranslating} />;
      case 'day': {
        const dayIdx = slide.dayIndex || 0;
        return (
          <div key={`day-${dayIdx}`}>
            {/* Edit toggle floats at top of day slides */}
            <div className="flex justify-end mb-3">
              <EditModeToggle editMode={editMode} onToggle={() => setEditMode(!editMode)} />
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                const activeMatch = String(active.id).match(/^day-(\d+)-stop-(\d+)$/);
                const overMatch = String(over.id).match(/^day-(\d+)-stop-(\d+)$/);
                if (activeMatch && overMatch && activeMatch[1] === overMatch[1]) {
                  editor.reorderStops(parseInt(activeMatch[1], 10), parseInt(activeMatch[2], 10), parseInt(overMatch[2], 10), token);
                }
              }}
            >
              <DayTimeline
                day={days[dayIdx]}
                dayIndex={dayIdx}
                editMode={editMode}
                isRecalculating={editor.isRecalculating}
                onDeleteStop={(di, si) => editor.deleteStop(di, si, token)}
                onAddStop={(di) => setAddStopDay(di)}
              />
            </DndContext>
          </div>
        );
      }
      case 'ad':
        return <AdSlide key={`ad-${idx}`} adType={slide.adType || 'hotel'} plan={plan} />;
      case 'outro':
        return (
          <OutroSlide
            key={`outro-${idx}`}
            plan={plan}
            planId={planId || ''}
            token={token}
            isPdfGenerating={isPdfGenerating}
            isTranslating={isTranslating}
            isOwner={isOwner}
            onDownloadPDF={handleDownloadPDF}
          />
        );
      default:
        return null;
    }
  });

  return (
    <div className={`min-h-screen text-white ${isMobile ? 'bg-[#0a0412]' : 'bg-[#0a0b14]'}`}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="max-w-3xl mx-auto pt-20 pb-4">
        {/* Slide progress */}
        <SlideProgress current={current} total={slides.length} onDotClick={goToSlide} />

        {/* Swipe carousel */}
        <SwipeContainer
          current={current}
          onSlideChange={goToSlide}
          editMode={editMode}
        >
          {slideElements}
        </SwipeContainer>

        {/* AddStopModal: sibling to SwipeContainer, overlays regardless of current slide */}
        <AddStopModal
          open={addStopDay !== null}
          onClose={() => setAddStopDay(null)}
          onAdd={(stopData) => {
            if (addStopDay !== null) {
              editor.addStop(addStopDay, stopData, token);
              setAddStopDay(null);
            }
          }}
        />

        {/* Reviews Section */}
        <div className="max-w-4xl mx-auto px-4">
          <ReviewList targetType="plan" targetId={planId || ''} />
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
