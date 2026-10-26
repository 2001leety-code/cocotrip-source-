// Intro slide: plan title, date, stats, arrival guide.
// First slide in the swipe carousel.
import { CreditCard, MessageCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { ArrivalGuide } from './ArrivalGuide';
import { ShareMiniIcon } from './ShareButton';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';
import { noMealStopsInfo } from '../lib/userPlanNotices';

// 차량 내부키 → 고객용 라벨 (vehicleLabel[백엔드 humanize] 없을 때만 폴백 — staria_8 같은 raw 키 노출 방지).
const VEHICLE_LABELS: Record<string, string> = {
  staria_8: 'Private Staria Van (up to 7)', staria: 'Private Staria Van',
  sprinter: 'Mercedes Sprinter (8-12)', bus: 'Private Bus', vip: 'VIP Vehicle',
};
type PricingSummary = { vehicleLabel?: string; vehicle?: string };
type ArrivalGuideProps = ComponentProps<typeof ArrivalGuide>;

interface IntroSlideProps {
  plan: PlanDocument;
  planId: string;
  isTranslating: boolean;
  translationError?: string | null;
  isOwner?: boolean;
}

export function IntroSlide({ plan, planId, isTranslating, translationError, isOwner }: IntroSlideProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};

  const it = plan.itinerary || {};
  // B9-29 (2026-05-09): arrival_guide 누락/빈 객체 시 통계 카드 아래 빈 placeholder
  // 노출 버그. ArrivalGuide 컴포넌트는 guide.steps / guide.route_to_hotel 둘 다
  // 비어 있어도 헤더 + 빈 토글 영역을 항상 렌더 → 사용자에게 의미 없는 빈 박스.
  // 둘 중 하나라도 실제 데이터가 있을 때만 마운트.
  const arrivalRaw = it.arrival_guide as ArrivalGuideProps['guide'] | undefined;
  const hasArrivalContent = !!arrivalRaw && (
    (Array.isArray(arrivalRaw.steps) && arrivalRaw.steps.length > 0) ||
    !!arrivalRaw.route_to_hotel
  );
  const arrival = hasArrivalContent ? arrivalRaw : null;
  const input = plan.input || {};
  const regionNames = ((t as unknown as { planner?: { regionNames?: Record<string, string> } }).planner?.regionNames) || {};
  const regions = Array.isArray((input as Record<string, unknown>).regions)
    ? ((input as Record<string, unknown>).regions as string[])
    : [];
  const localizedRegions = regions.map((region) => {
    const key = String(region || '').trim();
    return regionNames[key.toLowerCase()] || regionNames[key] || key;
  }).filter(Boolean);

  const pricing = plan.pricing as PricingSummary | undefined;
  const vehicleLabel = pricing?.vehicleLabel || (pricing?.vehicle ? (VEHICLE_LABELS[pricing.vehicle] || pricing.vehicle) : '');

  // JA 라벨이 좁은 폰에서 '旅 / 程' 로 쪼개지지 않도록 '旅程' 앞에서만 줄바꿈 허용 (문구 자체는 그대로).
  const whatsAppLabel = sw.customizeWhatsApp || 'Customize this trip on WhatsApp';
  const whatsAppSplitAt = whatsAppLabel.indexOf('旅程');
  const whatsAppChunks = whatsAppSplitAt > 0
    ? [whatsAppLabel.slice(0, whatsAppSplitAt), whatsAppLabel.slice(whatsAppSplitAt)]
    : null;

  // 2026-10-26: 2일+ 여행 식사 stop 0 — 접히지 않는 안내(자동 보정 패널과 별개). 원인은 확인될 때만 붙인다.
  const noMeal = noMealStopsInfo(it as never, input as never);
  const nm = ((pd as unknown as { noMealNotice?: Record<string, string> }).noMealNotice) || {};
  const noMealReasons = [
    noMeal.lateArrival ? (nm.lateArrival || 'late arrival') : '',
    noMeal.earlyDeparture ? (nm.earlyDeparture || 'early departure') : '',
  ].filter(Boolean).join(nm.joiner || ' · ');
  const noMealText = noMealReasons
    ? String(nm.withReasons || 'This itinerary has no meal stops ({{reasons}}).').replace('{{reasons}}', noMealReasons)
    : (nm.plain || 'This itinerary has no meal stops.');

  const tMoneyLoad = Number(it.t_money_recommended_load);
  const hasTMoneyLoad = Number.isFinite(tMoneyLoad) && tMoneyLoad > 0;

  return (
    <div>
      {/* Intro status and quick actions */}
      <div className="mb-4">
        {isTranslating && (
          <div className="ec-chip ec-chip-brand mb-3" role="status" aria-live="polite">
            <div className="h-3 w-3 animate-pulse rounded-full bg-ec-brand" aria-hidden />
            {sw.translationInProgress || 'Translating...'}
          </div>
        )}
        {!isTranslating && translationError && (
          <div className="ec-chip mb-3 border-ec-notice text-ec-notice" role="status">
            <span aria-hidden>!</span>
            <span>{sw.translationFailedShowingOriginal || 'Translation unavailable — showing original'}</span>
          </div>
        )}
        <div className="flex items-center">
          <ShareMiniIcon planId={planId} plan={plan} isOwner={isOwner} />
        </div>
        {vehicleLabel && <p className="ec-body-sm mt-3" data-testid="plan-intro-vehicle">{vehicleLabel}</p>}
        {localizedRegions.length > 1 && (
          <p className="mt-1.5 text-[14px] font-semibold tracking-wide text-ec-ink-2">
            {localizedRegions.join('  →  ')}
          </p>
        )}
        {noMeal.show && (
          <p className="mt-3 border-l-2 border-ec-line-2 bg-ec-sunken px-3 py-2.5 text-[13px] leading-relaxed text-ec-ink-2" role="note" data-testid="plan-intro-no-meal">
            {noMealText}
          </p>
        )}
      </div>

      {/* 일수·장소·인원·출발일은 마스트헤드에 한 번만 표시 — 여기선 T-money 권장 충전액만 유지 (유효 양수일 때만). */}
      {hasTMoneyLoad && (
        <div className="mb-6 flex items-center gap-3 border-y border-ec-line px-2 py-3" data-testid="plan-intro-tmoney">
          <CreditCard className="h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
          <p className="text-[14px] text-ec-ink-3">T-money</p>
          <p className="ec-figure ml-auto text-[14px]">{formatKRW(tMoneyLoad)}</p>
        </div>
      )}

      {/* 상단 고객 CTA — 공유 제안서에서 바로 맞춤/문의 (전환 동선 앞당김). */}
      <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
        className="plan-intro-whatsapp ec-btn ec-btn-secondary mb-6 w-full">
        <MessageCircle className="h-5 w-5 text-ec-success" aria-hidden /> <span className="plan-intro-whatsapp-label">{whatsAppChunks
          ? whatsAppChunks.map((chunk, i) => <span key={i} className="plan-intro-whatsapp-chunk">{chunk}</span>)
          : whatsAppLabel}</span>
      </a>

      {/* Arrival Guide */}
      {arrival && <ArrivalGuide guide={arrival} />}

      {/* batch 9 fix (B9-14, 2026-05-09): swipe hint \uc81c\uac70 \u2014 5/3 batch 1 (PR #211) \uc5d0\uc11c
          \uc2a4\uc640\uc774\ud504 \uae30\ub2a5 \uc790\uccb4\ub97c \uc81c\uac70\ud588\uc73c\ub098 \uc548\ub0b4 \ubb38\uad6c\ub9cc \uc794\uc874. i18n key 'swipeHint' \ub294
          \ud0c0 locale \uc77c\uad00\uc131 \uc704\ud574 \uc794\uc874 (\uc0ac\uc6a9 \uc548 \ud568, harmless). */}
    </div>
  );
}
