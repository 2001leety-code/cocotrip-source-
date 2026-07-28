// Intro slide: plan title, date, stats, arrival guide.
// First slide in the swipe carousel.
import { Calendar, MapPin, Users, CreditCard, MessageCircle } from 'lucide-react';
import { ArrivalGuide } from './ArrivalGuide';
import { ShareMiniIcon } from './ShareButton';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument, PlanDay } from '../types';
import { getPlanDetailDict } from '../types';

// 차량 내부키 → 고객용 라벨 (vehicleLabel[백엔드 humanize] 없을 때만 폴백 — staria_8 같은 raw 키 노출 방지).
const VEHICLE_LABELS: Record<string, string> = {
  staria_8: 'Private Staria Van (up to 7)', staria: 'Private Staria Van',
  sprinter: 'Mercedes Sprinter (8-12)', bus: 'Private Bus', vip: 'VIP Vehicle',
};

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
  const days = it.days || [];
  // B9-29 (2026-05-09): arrival_guide 누락/빈 객체 시 통계 카드 아래 빈 placeholder
  // 노출 버그. ArrivalGuide 컴포넌트는 guide.steps / guide.route_to_hotel 둘 다
  // 비어 있어도 헤더 + 빈 토글 영역을 항상 렌더 → 사용자에게 의미 없는 빈 박스.
  // 둘 중 하나라도 실제 데이터가 있을 때만 마운트.
  const arrivalRaw = it.arrival_guide as
    | { steps?: unknown[]; route_to_hotel?: unknown }
    | undefined;
  const hasArrivalContent = !!arrivalRaw && (
    (Array.isArray(arrivalRaw.steps) && arrivalRaw.steps.length > 0) ||
    !!arrivalRaw.route_to_hotel
  );
  const arrival = hasArrivalContent ? arrivalRaw : null;
  const input = plan.input || {};

  // 2026-06-23 (운영자 #3): pax 누락 시 "undefined pax" / 통계카드 "Pax: undefined" 노출 버그.
  // adults(없으면 pax)를 안전하게 숫자화 — 둘 다 없으면 null → 해당 세그먼트/카드 값 숨김.
  const adultsNum = Number(input.adults);
  const paxRaw = Number(input.pax);
  const childrenNum = Number(input.children || 0);
  const hasAdults = Number.isFinite(adultsNum) && adultsNum > 0;
  const hasPax = Number.isFinite(paxRaw) && paxRaw > 0;
  // 총 인원: adults(+children) 우선, 없으면 pax. 둘 다 없으면 null.
  const paxTotal = hasAdults
    ? adultsNum + (Number.isFinite(childrenNum) ? childrenNum : 0)
    : hasPax
      ? paxRaw
      : null;

  return (
    <div>
      {/* Title */}
      <div className="text-center mb-8">
        {isTranslating && (
          <div className="inline-flex items-center gap-2 bg-[#7C5CFC]/20 border border-[#7C5CFC]/30 rounded-full px-4 py-1.5 mb-3 text-[14px] text-[#7C5CFC]">
            <div className="w-3 h-3 border border-[#7C5CFC] border-t-transparent rounded-full animate-spin" />
            Translating...
          </div>
        )}
        {!isTranslating && translationError && (
          <div className="inline-flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-full px-4 py-1.5 mb-3 text-[14px] text-amber-200">
            <span aria-hidden>⚠</span>
            <span>{sw.translationFailedShowingOriginal || 'Translation unavailable — showing original'}</span>
          </div>
        )}
        {/* 🔴 2026-07-28: h1 → h2. 이 슬라이드와 페이지 헤더(index.tsx)가 동시에 h1 을
            내보내 한 화면에 h1 이 둘이었다. 문서 제목은 헤더 하나로 통일하고 여기는
            섹션 제목으로 낮춘다(보이는 크기·스타일은 그대로). */}
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight bg-clip-text text-transparent" style={{ backgroundImage: 'var(--coco-cta-gradient)' }}>
          {it.tour_title || sw.introTitle || 'Your Korea Trip'}
        </h2>
        <div className="flex items-center justify-center mt-1">
          <ShareMiniIcon planId={planId} plan={plan} isOwner={isOwner} />
        </div>
        <p className="text-white/55 text-sm mt-2">

          {input.startDate}
          {/* 2026-06-23 (운영자 #3): pax 값 있을 때만 노출 — 없으면 "undefined pax" 방지. */}
          {hasAdults ? ` | ${adultsNum} adults` : hasPax ? ` | ${paxRaw} pax` : ''}
          {childrenNum > 0 && ` + ${childrenNum} children`}
          {(() => { const pr = plan.pricing as Record<string, any> | undefined; const v = pr?.vehicleLabel || (pr?.vehicle ? (VEHICLE_LABELS[pr.vehicle] || pr.vehicle) : ''); return v ? ` | ${v}` : ''; })()}
        </p>
        {Array.isArray((input as Record<string, any>).regions) && (input as Record<string, any>).regions.length > 0 && (
          <p className="text-white/75 text-sm mt-1.5 font-semibold tracking-wide">
            {((input as Record<string, any>).regions as string[]).map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join('  →  ')}
          </p>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { icon: <Calendar className="w-4 h-4" />, label: sw.introDaysLabel || 'Days', value: String(days.length || '-') },
          { icon: <MapPin className="w-4 h-4" />, label: 'Stops', value: String(days.reduce((s: number, d: PlanDay) => s + (d.stops?.length || 0), 0)) },
          // 2026-06-23 (운영자 #3): paxTotal null 시 '-' 폴백 (Days 카드와 동일 패턴) — "undefined" 방지.
          { icon: <Users className="w-4 h-4" />, label: 'Pax', value: paxTotal != null ? String(paxTotal) : '-' },
          { icon: <CreditCard className="w-4 h-4" />, label: 'T-money', value: formatKRW(it.t_money_recommended_load || 0) },
        ].map((item, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-center">
            <span className="text-white/55 flex justify-center mb-1">{item.icon}</span>
            <p className="text-[14px] text-white/55">{item.label}</p>
            <p className="text-sm font-bold">{item.value}</p>
          </div>
        ))}
      </div>

      {/* 상단 고객 CTA — 공유 제안서에서 바로 맞춤/문의 (전환 동선 앞당김). */}
      <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
        className="w-full mb-6 py-3.5 rounded-2xl text-base font-bold text-white flex items-center justify-center gap-2 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors">
        <MessageCircle className="w-5 h-5 text-green-400" /> {sw.customizeWhatsApp || 'Customize this trip on WhatsApp'}
      </a>

      {/* Arrival Guide */}
      {arrival && <ArrivalGuide guide={arrival as any} />}

      {/* batch 9 fix (B9-14, 2026-05-09): swipe hint \uc81c\uac70 \u2014 5/3 batch 1 (PR #211) \uc5d0\uc11c
          \uc2a4\uc640\uc774\ud504 \uae30\ub2a5 \uc790\uccb4\ub97c \uc81c\uac70\ud588\uc73c\ub098 \uc548\ub0b4 \ubb38\uad6c\ub9cc \uc794\uc874. i18n key 'swipeHint' \ub294
          \ud0c0 locale \uc77c\uad00\uc131 \uc704\ud574 \uc794\uc874 (\uc0ac\uc6a9 \uc548 \ud568, harmless). */}
    </div>
  );
}
