// Outro slide: PDF download, WhatsApp, revision card, seasonal banner.
// Last slide in the swipe carousel.
import { Download, MessageCircle } from 'lucide-react';
import { BudgetTable } from './BudgetTable';
import { DepartureGuide } from './DepartureGuide';
import { SeasonalBanner } from './SeasonalBanner';
import { RevisionCard } from './RevisionCard';
import { ShareButton } from './ShareButton';
import { HotelAd } from './ads/HotelAd';
// B9-17 (2026-05-09): TRIP EXTRAS 차터 — 기존 WhatsApp 문의 modal 패턴 (legacy
// CharterBanner) 에서 인라인 결제 패턴 (CharterInlineAd) 으로 통일. PreTripSlide
// 와 동일 funnel — 사용자가 wrap-up / pre-trip 어디서든 같은 흐름으로 결제 가능.
import { CharterInlineAd } from './ads/CharterInlineAd';
import { CarRentalAd } from './ads/CarRentalAd';
import { FlightAd } from './ads/FlightAd';
import { AccommodationRecommendation } from './AccommodationRecommendation';
import { useLanguage } from '@/hooks/useLanguage';
import { BRAND } from '@/lib/design-tokens';
import type { PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';
import { getOutroExtras } from '../lib/buildSlides';

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
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};

  const it = plan.itinerary || {};
  const budget = it.daily_budget_summary || [];
  const departure = it.departure_guide;
  const input = plan.input || {};
  // B9-28 (2026-05-09): 사용자에게 보여주는 region 텍스트는 원본 입력값 우선.
  // input.area 는 cityNameToAreaKey 의 normalized key (예: "seoul_city", "busan")
  // 로 raw 식별자가 그대로 노출되는 버그 (HotelAd "Best rates for seoul_city
  // hotels"). 사용자가 입력한 destination / regions[0] (한/영/일/중) 우선,
  // 마지막에만 normalize key 또는 'Seoul' fallback.
  const rawRegion =
    (input.destination as string) ||
    ((input.regions as string[] | undefined)?.[0]) ||
    (input.area as string) ||
    'Seoul';
  // 누적된 underscore key (seoul_city, seoul_suburb 등) 가 어떤 경로로든 들어와도
  // 사용자에게 보여줄 때는 단어로 정리 (seoul_city → Seoul).
  const region = rawRegion.replace(/_city$|_suburb$/i, '').replace(/_/g, ' ').trim() || 'Seoul';
  const arrivalAirport = (input.arrival_airport as string) || 'ICN';
  // D-option: ads that didn't make the slide cut surface here as a card grid.
  const extras = getOutroExtras(plan);
  // B9-17: 차터 광고에 인라인 결제용 컨텍스트 — 시작일/인원/planId.
  const startDate = (input.startDate as string) || '';
  const pax = (input.pax as number) || (input.adults as number) || 2;

  return (
    <div>
      <h2 className="text-xl font-bold text-center mb-6 bg-clip-text text-transparent" style={{ backgroundImage: BRAND.gradient.primary }}>
        {sw.outroTitle || 'Ready to go!'}
      </h2>

      {/* Budget Table */}
      {budget.length > 0 && <BudgetTable budget={budget as any} tMoney={(it.t_money_recommended_load as number | undefined) || 0} />}

      {/* Departure Guide — B9-33: plan 전달 시 호텔 주소 hub 추출 + 직행 버스 카드 노출 */}
      {departure && <DepartureGuide guide={departure} plan={plan} />}

      {/* Action buttons - LOCKED: PDF button disabled condition must stay exact */}
      <div className="mt-8 space-y-3">
        <button onClick={onDownloadPDF} disabled={isPdfGenerating || isTranslating}
          className="w-full py-4 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: BRAND.gradient.primary }}>
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
          <MessageCircle className="w-5 h-5 text-green-400" /> {sw.whatsappBooking || 'WhatsApp Booking'}
        </a>

        {/* Share */}
        <ShareButton planId={planId} plan={plan} isOwner={isOwner} />
      </div>

      {/* B9-20 (2026-05-09 round 4): AI 호텔 추천 카드.
          위치: Gemini 응답 JSON 의 root → persistPlan 이 itinerary 통째로 저장 →
          Firestore plan.itinerary.accommodation. legacy plan 은 root level 에 있을
          수 있어 두 위치 모두 fallback. 어필리에이트 HotelAd 광고와는 별개 — 이건
          itinerary 분석 후 "이 플랜에 딱 맞는 한 채" 의 server-curated 추천. */}
      {(() => {
        const acc = (it.accommodation as Record<string, unknown> | undefined)
          || (plan.accommodation as Record<string, unknown> | undefined);
        if (!acc || typeof acc !== 'object' || Object.keys(acc).length === 0) return null;
        return (
          <AccommodationRecommendation
            acc={acc}
            region={region}
            labelTitle={sw.accomRecTitle}
            labelWhy={sw.accomRecWhy}
            labelTip={sw.accomRecTip}
            labelAffiliateNote={sw.accomRecAffiliateNote}
          />
        );
      })()}

      {/* Trip Extras (D-option ad cards moved out of slides) */}
      {extras.length > 0 && (
        <div className="mt-8">
          <p className="text-[11px] uppercase tracking-wider text-white/55 font-semibold mb-3">
            {sw.outroExtrasTitle || 'Trip extras'}
          </p>
          <div className="space-y-3">
            {extras.includes('hotel') && <HotelAd region={region} />}
            {extras.includes('flight') && <FlightAd arrivalAirport={arrivalAirport} />}
            {extras.includes('charter') && (
              <CharterInlineAd
                region={rawRegion}
                defaultDate={startDate}
                defaultPax={pax}
                planId={planId}
              />
            )}
            {extras.includes('carRental') && <CarRentalAd region={region} />}
          </div>
        </div>
      )}

      {/* Seasonal — 2026-05-08: plan 을 전달해야 main city 기반 region 필터링이 작동.
          미전달 시 (예: 다른 곳에서 사용) 모든 spot 노출 (legacy fallback). */}
      <SeasonalBanner plan={plan} />

      {/* Revision */}
      <RevisionCard plan={plan} planId={planId} token={token} />

      <div className="mb-16" />
    </div>
  );
}
