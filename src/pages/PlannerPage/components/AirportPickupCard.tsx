// Airport pickup selection + PayPal booking.
// LOCKED region -- PayPalBookingButton lifted verbatim from legacy PlannerPage.tsx L823-884.
import { useState } from 'react';
import { Plane } from 'lucide-react';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { PICKUP_PRICES } from '@/config/affiliateLinks';

export function AirportPickupCard({ arrivalAirport, p, lang }: { arrivalAirport?: string; p: PlannerDict; lang: string }) {
  const code = arrivalAirport ?? 'ICN';
  const prices: { destination: string; price: string }[] = PICKUP_PRICES[code] ?? PICKUP_PRICES['ICN'];
  const [selectedDest, setSelectedDest] = useState<string | null>(null);

  const selectedPrice = selectedDest
    ? prices.find(r => r.destination === selectedDest)
    : null;
  const priceKRW = selectedPrice
    ? parseInt(selectedPrice.price.replace(/[^\d]/g, ''), 10)
    : 0;

  return (
    <div className="rounded-2xl border border-[rgba(196,149,106,.3)] p-5 mt-6"
      style={{ background: 'linear-gradient(135deg, rgba(196,149,106,0.08) 0%, rgba(10,16,32,0.95) 100%)' }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[rgba(196,149,106,.15)] border border-[rgba(196,149,106,.3)] flex items-center justify-center shrink-0">
          <Plane className="w-6 h-6 text-[#C4956A]" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight mb-0.5">{p.airport_pickup_title}</p>
          <p className="text-xs text-[#D4A574]/80 font-medium">{p.airport_pickup_desc}</p>
          <p className="text-[11px] text-white/40 mt-1">{p.airport_pickup_driver}</p>
        </div>
        <span className="shrink-0 text-[10px] text-[#C4956A] border border-[rgba(196,149,106,.35)] rounded-full px-2.5 py-1 font-semibold">{code}</span>
      </div>

      <p className="text-xs text-white/40 mb-2">{p.airport_pickup_select}</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {prices.map((row, i) => (
          <button key={i} type="button" onClick={() => setSelectedDest(row.destination)}
            className={`rounded-xl px-3 py-2 flex items-center gap-2 border transition-all duration-200 ${
              selectedDest === row.destination
                ? 'border-[#C4956A] bg-[rgba(196,149,106,.12)] text-[#D4A574]'
                : 'bg-white/[0.04] border-white/10 hover:border-white/25'
            }`}>
            <span className="text-xs text-white/50">{row.destination}</span>
            <span className={`text-xs font-bold ${selectedDest === row.destination ? 'text-[#C4956A]' : 'text-[#D4A574]'}`}>{row.price}</span>
          </button>
        ))}
      </div>

      {selectedDest && priceKRW > 0 ? (
        <PayPalBookingButton
          productType={`airport_${code.toLowerCase()}_${selectedDest.replace(/[^a-zA-Z\uAC00-\uD7A3]/g, '_').toLowerCase()}`}
          passengers={1}
          dateStart=""
          dateEnd=""
          priceKRW={priceKRW}
          p={p}
          lang={lang}
          pickupLocation={code}
          dropoffLocation={selectedDest}
          vehicleType="staria"
          memo={`Airport Pickup: ${code} → ${selectedDest}`}
        />
      ) : (
        <p className="text-xs text-white/30 text-center py-2">{p.airport_pickup_select_hint}</p>
      )}
    </div>
  );
}
