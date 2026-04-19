// Ad slide renderer -- dispatches to the correct ad component based on adType.
// Every ad slide displays a "Sponsored" badge (regulatory transparency).
import { useLanguage } from '@/hooks/useLanguage';
import { HotelAd } from './ads/HotelAd';
import { CharterBanner } from './ads/CharterBanner';
import { AirportPickupAd } from './ads/AirportPickupAd';
import { EsimAd } from './ads/EsimAd';
import { CarRentalAd } from './ads/CarRentalAd';
import { FlightAd } from './ads/FlightAd';
import type { AdCategory } from '../lib/buildSlides';

interface AdSlideProps {
  adType: AdCategory;
  plan: any;
}

export function AdSlide({ adType, plan }: AdSlideProps) {
  const { t } = useLanguage();
  const pd = (t as any).planDetail || {};
  const sw = pd.swipe || {};
  const input = plan.input || {};
  const days = (plan.itinerary && plan.itinerary.days) || [];
  const region = input.destination || (input.regions && input.regions[0]) || 'Seoul';

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
    <div className="relative">
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
