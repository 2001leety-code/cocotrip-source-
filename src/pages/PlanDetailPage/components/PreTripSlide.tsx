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
import { TrainsAd } from './ads/TrainsAd';
import { AirportToLodgingGuide } from './AirportToLodgingGuide';
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
  // 2026-05-09 (B9-36): region 추출 우선순위 변경 — 사용자 신고 "부산 plan 인데
  // TRIP EXTRAS 가 서울 옵션". 원인: input.destination 이 generic fallback 값
  // ('Korea' / 'Seoul') 인 경우 regions[0]='busan' 을 무시하고 'Seoul' 로 분기됨.
  // Fix: regions[0] (사용자가 wizard 에서 1순위로 고른 mainCity) 를 최우선.
  const regions0 = ((input.regions as string[])?.[0] || '').trim();
  const region = regions0 || (input.destination as string) || 'Seoul';
  const arrivalAirport = (input.arrival_airport as string) || 'ICN';
  const startDate = (input.startDate as string) || '';
  const pax = (input.pax as number) || (input.adults as number) || 2;

  const showHotel = adApplies('hotel', plan);
  const showFlight = adApplies('flight', plan);
  const showCharter = adApplies('charter', plan);
  const showTrain = adApplies('train', plan);
  const regions = ((input.regions as unknown as string[]) || []).filter(Boolean);
  const trainFromCity = regions[0];
  const trainToCity = regions[1];

  const containerRef = useRef<HTMLDivElement>(null);
  const impressionTracked = useRef(false);

  // 🔴 2026-07-30: 제휴 카드(eSIM·호텔·항공·기차)의 노출은 **각 카드가 스스로** 기록한다.
  //   이전에는 이 컨테이너가 화면에 들어오는 순간 아래쪽 카드까지 전부 "봤다" 로 찍었다.
  //   슬라이드 윗부분만 보고 넘긴 사용자도 6종을 모두 본 것으로 집계돼,
  //   노출 대비 클릭률이 실제보다 훨씬 낮게 보였다(= 보이지 않은 카드의 허위 노출).
  //
  //   여기 남은 것은 **제휴가 아닌 자체 상품**(공항픽업·차터)뿐이다. 이 둘은 별도 카드
  //   컴포넌트가 아니라 슬라이드 상단 본문에 직접 그려져 있어 슬라이드 진입 = 노출로
  //   봐도 과대 집계가 아니다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || impressionTracked.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          trackAdImpression('airportPickup', 'preTrip');
          if (showCharter) trackAdImpression('charter', 'preTrip');
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [showCharter]);

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
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight text-white mb-2">{headerTitle}</h2>
          <p className="text-sm text-white/55">{headerSubtitle}</p>
        </div>

        {/* Sponsored 배지 — 광고임을 명확히 (규제 투명성) */}
        <div className="flex justify-end mb-3">
          <span className="text-[12px] text-white/55 bg-white/[0.04] border border-white/[0.06] rounded-full px-2.5 py-0.5 font-medium">
            {sponsoredLabel}
          </span>
        </div>

        {/* 카드 1: eSIM (항상 노출) */}
        <EsimAd />

        {/* 2026-05-08 신규: 차터 미예약 사용자한테 공항→숙소 4-옵션 안내.
            Charter 예약자는 자동 미노출 (AirportToLodgingGuide 내부에서 분기).
            한국어 사용자는 단순화된 1줄 안내 + 캐리어 많을 때만 차터 CTA 노출.
            영어/일본어/중국어 사용자는 4 옵션 (공항철도/공항버스/택시/차터) + 자동 추천. */}
        <div className="mt-4">
          <AirportToLodgingGuide plan={plan} />
        </div>

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

        {/* 카드 7: KTX/SRT (다도시 plan 시) — batch 9 (2026-05-09) */}
        {showTrain && (
          <div className="mt-4">
            <TrainsAd fromCityKey={trainFromCity} toCityKey={trainToCity} />
          </div>
        )}
      </div>
    </div>
  );
}
