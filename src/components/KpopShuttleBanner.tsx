import { useState, useMemo } from 'react';
import { Music, MapPin, Calendar, ExternalLink, Star, Minus, Plus, ArrowRight, Info } from 'lucide-react';
import { getUpcomingConcerts } from '@/data/kpopConcerts';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  p: Record<string, string | undefined>;
}

const SEL = 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white';
const UNSEL = 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:border-white/20';

export function KpopShuttleBanner({ p }: Props) {
  const { language, t: globalT } = useLanguage();
  const concerts = useMemo(() => getUpcomingConcerts(), []);
  const t = ((globalT as Record<string, unknown>).ads as Record<string, Record<string, string>> | undefined)?.kpopShuttle ?? {} as Record<string, string>;
  const lk = ({ ko: 'ko', en: 'en', ja: 'en', zh: 'en' } as const)[language] ?? 'en'; // concert data: ko/en only; ja/zh → en fallback

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickup, setPickup] = useState('');
  const [tripType, setTripType] = useState<'oneway' | 'roundtrip'>('oneway');
  const [pax, setPax] = useState(2);

  const selected = concerts.find(c => c.id === selectedId) ?? null;
  const unitPrice = tripType === 'oneway' ? (selected?.oneWayPrice ?? 35000) : (selected?.roundTripPrice ?? 65000);
  const totalPrice = unitPrice * pax;
  const canBook = selected && pickup && pax > 0;

  if (concerts.length === 0) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(124,92,252,0.08)',
        border: '1px solid rgba(124,92,252,0.2)',
      }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <Music className="w-5 h-5 text-[#7C5CFC]" />
          <h3 className="text-lg font-bold text-white">{t.title}</h3>
        </div>
        <p className="text-xs text-white/55 ml-7">{t.subtitle}</p>
      </div>

      {/* Concert Cards - Horizontal Scroll */}
      <div className="px-5 pb-4">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin" style={{ scrollbarWidth: 'thin' }}>
          {concerts.map(concert => {
            const isSelected = selectedId === concert.id;
            const isHighlight = concert.highlight;
            return (
              <button
                key={concert.id}
                type="button"
                onClick={() => { setSelectedId(concert.id); setPickup(''); }}
                className="relative shrink-0 w-[260px] rounded-xl p-4 text-left transition-all duration-200"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: isHighlight
                    ? '2px solid #7C5CFC'
                    : isSelected
                    ? '1.5px solid rgba(124,92,252,0.5)'
                    : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: isHighlight ? '0 0 20px rgba(124,92,252,0.15)' : undefined,
                }}
              >
                {/* ARMY PICK badge for BTS */}
                {isHighlight && (
                  <div className="absolute -top-2.5 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider text-white"
                    style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
                    <Star className="w-2.5 h-2.5" />
                    {t.armyPick}
                  </div>
                )}

                {/* Artist */}
                <p className="font-bold text-white text-sm mt-1">{concert.artist}</p>
                <p className="text-[11px] text-white/50 leading-tight mt-0.5">{concert.tourName}</p>

                {/* Date */}
                <div className="flex items-center gap-1.5 mt-2.5 text-xs text-white/60">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>{lk === 'ko' ? concert.dateDisplayKo : concert.dateDisplay}</span>
                </div>

                {/* Venue */}
                <div className="flex items-center gap-1.5 mt-1 text-xs text-white/50">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span>{lk === 'ko' ? concert.venueKo : concert.venue}</span>
                </div>

                {/* Note + Badges */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {concert.soldOut && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                      {t.soldOut}
                    </span>
                  )}
                  {concert.shuttleAvailable && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                      {t.shuttleAvailable}
                    </span>
                  )}
                </div>

                {/* Naver Map */}
                <a
                  href={concert.naverMapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 mt-2.5 text-[10px] text-[#7C5CFC] hover:text-[#A78BFA] transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.naverMap}
                </a>
              </button>
            );
          })}
        </div>
      </div>

      {/* Booking Section */}
      {selected && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/[0.06] pt-4">
          {/* Pickup Points */}
          <div>
            <p className="text-xs text-white/55 mb-2">{t.pickupPoint}</p>
            <div className="flex flex-wrap gap-2">
              {(lk === 'ko' ? selected.pickupPointsKo : selected.pickupPoints).map((point, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPickup(selected.pickupPoints[idx])}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 ${
                    pickup === selected.pickupPoints[idx] ? SEL : UNSEL
                  }`}
                >
                  {point}
                </button>
              ))}
            </div>
          </div>

          {/* Trip Type Toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTripType('oneway')}
              className={`py-2.5 rounded-xl border text-sm font-bold text-center transition-all duration-200 ${tripType === 'oneway' ? SEL : UNSEL}`}
            >
              {t.oneWay} - \u20A9{selected.oneWayPrice.toLocaleString('ko-KR')}
            </button>
            <button
              type="button"
              onClick={() => setTripType('roundtrip')}
              className={`py-2.5 rounded-xl border text-sm font-bold text-center transition-all duration-200 ${tripType === 'roundtrip' ? SEL : UNSEL}`}
            >
              {t.roundTrip} - \u20A9{selected.roundTripPrice.toLocaleString('ko-KR')}
            </button>
          </div>

          {/* Passengers */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">{t.passengers}</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPax(p => Math.max(1, p - 1))}
                className="w-7 h-7 rounded-lg border border-white/15 flex items-center justify-center text-white/60 hover:border-white/30 transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-bold text-white w-6 text-center">{pax}</span>
              <button
                type="button"
                onClick={() => setPax(p => Math.min(8, p + 1))}
                className="w-7 h-7 rounded-lg border border-white/15 flex items-center justify-center text-white/60 hover:border-white/30 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Price Calculation */}
          <div className="bg-white/[0.04] rounded-xl px-4 py-3">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>
                {tripType === 'oneway' ? t.oneWay : t.roundTrip}: \u20A9{unitPrice.toLocaleString('ko-KR')} x {pax}
              </span>
              <span className="text-sm font-bold text-white">
                {t.total} \u20A9{totalPrice.toLocaleString('ko-KR')}
              </span>
            </div>
          </div>

          {/* PayPal Button */}
          {canBook && (
            <PayPalBookingButton
              productType={tripType === 'oneway' ? 'kpop_shuttle_oneway' : 'kpop_shuttle_roundtrip'}
              passengers={pax}
              dateStart={selected.dates[0]}
              dateEnd={selected.dates[selected.dates.length - 1]}
              priceKRW={totalPrice}
              p={p}
              lang={language}
              pickupLocation={pickup}
              dropoffLocation={selected.venue}
              vehicleType="staria"
              memo={`${selected.artist} - ${selected.tourName}`}
            />
          )}

          {/* Ticket Note */}
          <div className="flex items-start gap-2 text-[11px] text-white/55 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t.ticketNote}</span>
          </div>
        </div>
      )}

      {/* No selection prompt */}
      {!selected && (
        <div className="px-5 pb-4 flex items-center gap-2 text-xs text-white/55">
          <ArrowRight className="w-3.5 h-3.5" />
          {t.selectConcert}
        </div>
      )}
    </div>
  );
}
