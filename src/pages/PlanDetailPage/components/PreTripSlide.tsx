// PreTripSlide — 광고 1페이지로 통합 (eSIM + 공항픽업 + 호텔 + 항공).
// 사용자 가이드 (2026-05-03): "광고 1페이지 그다음 인트로 데이 1 2 3 이렇게만"
// → 기존 흩어진 ad slides + airportPickup slide를 단일 PreTrip slide에 모음.
//
// 각 카드는 adApplies()로 컨텍스트 검증 후 조건부 렌더링.
// 노출 추적은 IntersectionObserver — 슬라이드가 화면에 보일 때 한 번만 trackAdImpression.
import { useEffect, useRef, lazy, Suspense } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { trackAdImpression } from '@/lib/analytics';
import { adApplies } from '../lib/buildSlides';
import { EsimAd } from './ads/EsimAd';
import { HotelAd } from './ads/HotelAd';
import { FlightAd } from './ads/FlightAd';
import type { PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';

// 인라인 예약 카드 (T-5/6/7) 는 BraintreePaymentButton 을 트랜지티브로 가져오므로
// 메인 번들이 budget (365kB) 을 넘는다. PreTripSlide 가 항상 마운트되긴 하지만
// 인라인 카드들은 사용자가 결제까지 갈 때만 의미 있으므로 lazy 로 분리.
const AirportPickupAd = lazy(() =>
  import('./ads/AirportPickupAd').then(m => ({ default: m.AirportPickupAd })),
);
const CharterInlineAd = lazy(() =>
  import('./ads/CharterInlineAd').then(m => ({ default: m.CharterInlineAd })),
);
const TourPackageInlineAd = lazy(() =>
  import('./ads/TourPackageInlineAd').then(m => ({ default: m.TourPackageInlineAd })),
);

// Lazy 카드 placeholder — 카드 1개 정도 높이의 골격, 깜빡임 최소화.
function InlineCardSkeleton() {
  return (
    <div className="mb-6 rounded-2xl p-5 bg-white/[0.03] border border-white/[0.06] animate-pulse">
      <div className="h-5 w-1/2 bg-white/10 rounded mb-3" />
      <div className="space-y-2">
        <div className="h-12 bg-white/[0.05] rounded-xl" />
        <div className="h-12 bg-white/[0.05] rounded-xl" />
        <div className="h-12 bg-white/[0.05] rounded-xl" />
      </div>
    </div>
  );
}

interface PreTripSlideProps {
  plan: PlanDocument;
  /** 결제 메모 + 어드민 트래킹용. PlanDetailPage 가 useParams 로 받은 planId. */
  planId?: string;
}

export function PreTripSlide({ plan, planId }: PreTripSlideProps) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};
  const input = plan.input || {};
  const region = (input.destination as string) || ((input.regions as string[])?.[0]) || 'Seoul';
  const arrivalAirport = (input.arrival_airport as string) || 'ICN';
  const startDate = (input.startDate as string) || '';
  const pax = (input.pax as number) || (input.adults as number) || 2;

  const showHotel = adApplies('hotel', plan);
  const showFlight = adApplies('flight', plan);
  const showCharter = adApplies('charter', plan);

  const containerRef = useRef<HTMLDivElement>(null);
  const impressionTracked = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || impressionTracked.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          trackAdImpression('esim', 'preTrip');
          trackAdImpression('airportPickup', 'preTrip');
          if (showCharter) trackAdImpression('charter', 'preTrip');
          if (showHotel) trackAdImpression('hotel', 'preTrip');
          if (showFlight) trackAdImpression('flight', 'preTrip');
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [showHotel, showFlight, showCharter]);

  // 4-lang 헤더 텍스트 (i18n dict의 swipe 섹션 또는 fallback)
  const headerTitle = (sw as Record<string, string | undefined>).preTripTitle ||
    (language === 'ko' ? '여행 준비 안내'
      : language === 'ja' ? '旅行準備ガイド'
      : language === 'zh' ? '出行准备指南'
      : 'Pre-Trip Essentials');
  const headerSubtitle = (sw as Record<string, string | undefined>).preTripSubtitle ||
    (language === 'ko' ? '도착 전 확인하시면 한국 여행이 더 매끄러워져요'
      : language === 'ja' ? '到着前にご確認いただくと韓国旅行がよりスムーズになります'
      : language === 'zh' ? '出发前查看，让您的韩国之旅更顺畅'
      : 'Check before arrival for a smoother Korea trip');
  const sponsoredLabel = sw.sponsoredLabel || 'Sponsored';

  return (
    <div ref={containerRef} className="px-4 pt-4 pb-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{headerTitle}</h2>
          <p className="text-sm text-white/55">{headerSubtitle}</p>
        </div>

        {/* Sponsored 배지 — 광고임을 명확히 (규제 투명성) */}
        <div className="flex justify-end mb-3">
          <span className="text-[10px] text-white/55 bg-white/[0.04] border border-white/[0.06] rounded-full px-2.5 py-0.5 font-medium">
            {sponsoredLabel}
          </span>
        </div>

        {/* 카드 1: eSIM (항상 노출) */}
        <EsimAd />

        {/* 카드 2-4: 인라인 예약 카드들 — Suspense 로 묶어서 한 번에 lazy chunk 로드.
            2026-05-05: BraintreePaymentButton 트랜지티브 의존 → 메인 번들 budget 보호. */}
        <Suspense fallback={<div className="mt-4"><InlineCardSkeleton /></div>}>
          <div className="mt-4">
            <AirportPickupAd
              arrivalAirport={arrivalAirport}
              defaultDate={startDate}
              defaultPax={pax}
              planId={planId}
            />
          </div>
          {showCharter && (
            <div className="mt-4">
              <CharterInlineAd
                region={region}
                defaultDate={startDate}
                defaultPax={pax}
                planId={planId}
              />
            </div>
          )}
          {showCharter && (
            <div className="mt-4">
              <TourPackageInlineAd
                region={region}
                arrivalAirport={arrivalAirport}
                defaultDate={startDate}
                defaultPax={pax}
                planId={planId}
              />
            </div>
          )}
        </Suspense>

        {/* 카드 5: 호텔 (미예약 시) */}
        {showHotel && (
          <div className="mt-4">
            <HotelAd region={region} />
          </div>
        )}

        {/* 카드 6: 항공권 (출발 7일 이상 남았을 때) */}
        {showFlight && (
          <div className="mt-4">
            <FlightAd arrivalAirport={arrivalAirport} />
          </div>
        )}
      </div>
    </div>
  );
}
