// Outro slide: PDF download, WhatsApp, revision card, seasonal banner.
// Last slide in the swipe carousel.
import { Download, MessageCircle } from 'lucide-react';
import { BudgetTable } from './BudgetTable';
import { DepartureGuide } from './DepartureGuide';
import { SeasonalBanner } from './SeasonalBanner';
import { RevisionCard } from './RevisionCard';
import { ShareButton } from './ShareButton';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import type { PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';

interface OutroSlideProps {
  plan: PlanDocument;
  planId: string;
  token: string | null;
  isPdfGenerating: boolean;
  isTranslating: boolean;
  isOwner: boolean;
  onDownloadPDF: () => void;
}

export function OutroSlide({ plan, planId, token, isPdfGenerating, isTranslating, isOwner, onDownloadPDF }: OutroSlideProps) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};

  const it = plan.itinerary || {};
  const budget = it.daily_budget_summary || [];
  const departure = it.departure_guide;

  return (
    <div>
      <h2 className="text-xl font-bold text-center mb-6 bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
        {sw.outroTitle || 'Ready to go!'}
      </h2>

      {/* Budget Table */}
      {budget.length > 0 && <BudgetTable budget={budget as any} tMoney={(it.t_money_recommended_load as number | undefined) ?? 0} />}

      {/* Departure Guide */}
      {departure && <DepartureGuide guide={departure} />}

      {/* Action buttons - LOCKED: PDF button disabled condition must stay exact */}
      <div className="mt-8 space-y-3">
        <button onClick={onDownloadPDF} disabled={isPdfGenerating || isTranslating}
          className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
          {isPdfGenerating ? (
            <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> {sw.outroPdfCta || 'Generating PDF...'}</>
          ) : isTranslating ? (
            <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> {sw.translatingWait || 'Translating... please wait'}</>
          ) : (
            <><Download className="w-5 h-5" /> {sw.outroPdfCta || 'Download PDF itinerary'}</>
          )}
        </button>
        <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
          className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors">
          <MessageCircle className="w-5 h-5 text-green-400" /> WhatsApp Booking
        </a>

        {/* Share */}
        <ShareButton planId={planId} plan={plan} isOwner={isOwner} />
      </div>

      {/* Seasonal */}
      <SeasonalBanner />

      {/* Revision */}
      <RevisionCard plan={plan} planId={planId} token={token} />

      <div className="mb-16" />
    </div>
  );
}
