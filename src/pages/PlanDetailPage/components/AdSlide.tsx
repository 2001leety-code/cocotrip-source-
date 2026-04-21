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
import type { AdCategory } from '../lib/buildSlides';
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
  const region = input.destination || (input.regions && input.regions[0]) || 'Seoul';

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
        return <CharterBanner days={days} />;
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
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div ref={containerRef} className="relative" onClick={handleAdClick}>
      {/* Sponsored badge (regulatory transparency) */}
      <div className="flex justify-end mb-2">
        <span className="text-[10px] text-white/30 bg-white/[0.04] border border-white/[0.06] rounded-full px-2.5 py-0.5 font-medium">
          {sw.sponsoredLabel || 'Sponsored'}
        </span>
      </div>
      {renderAd()}
    </div>
  );
}

