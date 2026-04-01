import { useState, useMemo } from 'react';
import { Music, MapPin, Calendar, ExternalLink, Star, Minus, Plus, ArrowRight, Info } from 'lucide-react';
import { getUpcomingConcerts } from '@/data/kpopConcerts';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';

interface Props {
  language: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any;
}

const T: Record<string, Record<string, string>> = {
  ko: {
    title: 'K-pop 콘서트 셔틀',
    subtitle: '코코트립 공식 셔틀 서비스',
    pickupPoint: '픽업 포인트 선택',
    oneWay: '편도',
    roundTrip: '왕복',
    passengers: '인원',
    ticketNote: '셔틀은 공연 티켓 보유자만 이용 가능합니다',
    soldOut: '티켓 매진',
    shuttleAvailable: '셔틀 운행',
    bookShuttle: '셔틀 예약',
    selectConcert: '공연을 선택하세요',
    total: '합계',
    armyPick: 'ARMY PICK',
    naverMap: '네이버 지도',
  },
  en: {
    title: 'K-pop Concert Shuttle',
    subtitle: 'CocoTrip Official Shuttle Service',
    pickupPoint: 'Select pickup point',
    oneWay: 'One way',
    roundTrip: 'Round trip',
    passengers: 'Passengers',
    ticketNote: 'Shuttle available for concert ticket holders only',
    soldOut: 'Sold Out',
    shuttleAvailable: 'Shuttle available',
    bookShuttle: 'Book Shuttle',
    selectConcert: 'Select a concert',
    total: 'Total',
    armyPick: 'ARMY PICK',
    naverMap: 'Naver Map',
  },
  ja: {
    title: 'K-popコンサートシャトル',
    subtitle: 'CocoTrip公式シャトルサービス',
    pickupPoint: '乗車地点を選択',
    oneWay: '片道',
    roundTrip: '往復',
    passengers: '人数',
    ticketNote: 'シャトルはコンサートチケット保有者のみご利用可能です',
    soldOut: 'チケット完売',
    shuttleAvailable: 'シャトル運行中',
    bookShuttle: 'シャトル予約',
    selectConcert: 'コンサートを選択',
    total: '合計',
    armyPick: 'ARMY PICK',
    naverMap: 'Naver Map',
  },
  zh: {
    title: 'K-pop演唱会班车',
    subtitle: 'CocoTrip官方班车服务',
    pickupPoint: '选择接送地点',
    oneWay: '单程',
    roundTrip: '往返',
    passengers: '人数',
    ticketNote: '班车仅供持有演唱会门票者乘坐',
    soldOut: '票已售罄',
    shuttleAvailable: '班车可用',
    bookShuttle: '预订班车',
    selectConcert: '请选择演唱会',
    total: '合计',
    armyPick: 'ARMY PICK',
    naverMap: 'Naver Map',
  },
};

const SEL = 'border-[rgba(124,92,252,0.5)] bg-[rgba(124,92,252,0.12)] text-[#A78BFA]';
const UNSEL = 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/25';

export function KpopShuttleBanner({ language, p }: Props) {
  const concerts = useMemo(() => getUpcomingConcerts(), []);
  const t = T[language] ?? T.en;
  const lk = language === 'ko' ? 'ko' : 'en';

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
        <p className="text-xs text-white/40 ml-7">{t.subtitle}</p>
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
            <p className="text-xs text-white/40 mb-2">{t.pickupPoint}</p>
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
          <div className="flex items-start gap-2 text-[11px] text-white/35 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t.ticketNote}</span>
          </div>
        </div>
      )}

      {/* No selection prompt */}
      {!selected && (
        <div className="px-5 pb-4 flex items-center gap-2 text-xs text-white/30">
          <ArrowRight className="w-3.5 h-3.5" />
          {t.selectConcert}
        </div>
      )}
    </div>
  );
}
