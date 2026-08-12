// Ad slide renderer -- dispatches to the correct ad component based on adType.
// Every ad slide displays a "Sponsored" badge (regulatory transparency).
// GA4: tracks ad_impression (visibility) and ad_click events.
import { useEffect, useRef } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { trackAdImpression, trackAdClick } from '@/lib/analytics';
import { HotelAd } from './ads/HotelAd';
import { CharterBanner } from './ads/CharterBanner';
import { AirportPickupAd } from './ads/AirportPickupAd';
import { EsimAd } from './ads/EsimAd';
import { CarRentalAd } from './ads/CarRentalAd';
import { FlightAd } from './ads/FlightAd';
import type { AdCategory } from '@/config/promotionRules';
import type { PlanDocument } from '../types';
import { getPlanDetailDict } from '../types';

interface AdSlideProps {
  adType: AdCategory;
  plan: PlanDocument;
}

export function AdSlide({ adType, plan }: AdSlideProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};
  const input = plan.input || {};
  const days = (plan.itinerary && plan.itinerary.days) || [];
  const region = (input.destination as string) || ((input.regions as string[])?.[0]) || 'Seoul';

  // ── GA4 Impression tracking (IntersectionObserver) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const impressionTracked = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || impressionTracked.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          trackAdImpression(adType, 'plan_detail');
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [adType]);

  // ── GA4 Click tracking ──
  const handleAdClick = () => {
    trackAdClick(adType, 'plan_detail');
  };

  const renderAd = () => {
    switch (adType) {
      case 'hotel':
        return <HotelAd region={region} />;
      case 'charter':
        return <CharterBanner days={days} plan={plan} />;
      case 'esim':
        return <EsimAd />;
      case 'carRental':
        return <CarRentalAd region={region} />;
      case 'flight':
        return <FlightAd arrivalAirport={input.arrival_airport || 'ICN'} />;
      case 'airportPickup':
        return <AirportPickupAd arrivalAirport={input.arrival_airport || 'ICN'} />;
      default:
        return null;
    }
  };

  return (
    // 2026-08-02: jsx-a11y 플러그인이 이 레포 eslint 설정에 없어서, 남아 있던
    // `eslint-disable-next-line jsx-a11y/...` 주석 자체가 "규칙 없음" 오류를 냈다. 주석 제거.
    <div ref={containerRef} data-testid="plan-ad-slide" className="relative" onClick={handleAdClick}>
      {/* Sponsored badge (regulatory transparency) */}
      <div className="flex justify-end mb-2">
        <span className="ec-chip text-[12px] font-medium text-ec-ink-3">
          {sw.sponsoredLabel || 'Sponsored'}
        </span>
      </div>
      {renderAd()}
    </div>
  );
}

