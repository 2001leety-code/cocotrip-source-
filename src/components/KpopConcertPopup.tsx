import { useState, useMemo } from 'react';
import { X, Music, Calendar, MapPin, ExternalLink, Star, Minus, Plus, Info, ArrowRight } from 'lucide-react';
import { getUpcomingConcerts } from '@/data/kpopConcerts';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';
import { useLanguage } from '@/hooks/useLanguage';

const SEL  = 'border-[rgba(124,92,252,0.6)] bg-[rgba(124,92,252,0.15)] text-[#A78BFA]';
const UNSEL = 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/25 hover:text-white/80';

export function KpopConcertPopup() {
  const { language, t: globalT } = useLanguage();
  const t = (globalT as any).ads?.kpopConcert ?? {} as Record<string, string>;
  const lk = ({ ko: 'ko', en: 'en', ja: 'en', zh: 'en' } as const)[language] ?? 'en'; // concert data: ko/en only; ja/zh → en fallback

  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickup, setPickup] = useState('');
  const [tripType, setTripType] = useState<'oneway' | 'roundtrip'>('oneway');
  const [pax, setPax] = useState(2);

  const concerts = useMemo(() => getUpcomingConcerts(), []);
  const selected = concerts.find(c => c.id === selectedId) ?? null;
  const unitPrice = tripType === 'oneway'
    ? (selected?.oneWayPrice ?? 35000)
    : (selected?.roundTripPrice ?? 65000);
  const totalPrice = unitPrice * pax;
  const canBook = selected && pickup && pax > 0;

  if (concerts.length === 0 || dismissed) return null;

  return (
    <>
      {/* ── 플로팅 트리거 버튼 — 모바일: 하단 우측 작게 / 데스크톱: 기존 위치 ── */}
      <div className="fixed bottom-4 right-3 sm:bottom-6 sm:top-auto sm:right-24 z-50 flex items-center gap-1">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2.5 rounded-full text-white text-[10px] sm:text-sm font-bold shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 4px 20px rgba(124,92,252,0.45)' }}
        >
          <Music className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">{t.trigger}</span>
          <span className="sm:hidden">K-pop</span>
          <span className="ml-0.5 px-1 py-0.5 rounded-full bg-white/25 text-[9px] sm:text-[10px] font-black">
            {concerts.length}
          </span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-white/80 hover:text-white transition-colors"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          aria-label="Close"
        >
          <X className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
        </button>
      </div>

      {/* ── 모달 오버레이 ── */}
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl flex flex-col"
            style={{ background: '#13132a', border: '1px solid rgba(124,92,252,0.25)' }}
          >
            {/* 헤더 */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 pt-5 pb-4"
              style={{ background: '#13132a', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <div className="flex items-center gap-2">
                  <Music className="w-5 h-5 text-[#7C5CFC]" />
                  <h2 className="text-lg font-bold text-white">{t.modalTitle}</h2>
                </div>
                <p className="text-xs text-white/40 ml-7 mt-0.5">{t.modalSub}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 콘서트 목록 */}
            <div className="px-5 py-4 space-y-3">
              {concerts.length === 0 && (
                <p className="text-center text-white/40 py-8 text-sm">{t.noUpcoming}</p>
              )}
              {concerts.map(concert => {
                const isSelected = selectedId === concert.id;
                const isHighlight = concert.highlight;
                return (
                  <button
                    key={concert.id}
                    type="button"
                    onClick={() => { setSelectedId(concert.id); setPickup(''); }}
                    className="w-full text-left rounded-2xl p-4 transition-all duration-200"
                    style={{
                      background: isSelected ? 'rgba(124,92,252,0.12)' : 'rgba(255,255,255,0.04)',
                      border: isHighlight
                        ? `2px solid ${isSelected ? '#7C5CFC' : 'rgba(124,92,252,0.5)'}`
                        : isSelected
                        ? '1.5px solid rgba(124,92,252,0.4)'
                        : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* 아티스트 + 배지 */}
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-bold text-white text-sm">{concert.artist}</span>
                          {isHighlight && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
                              <Star className="w-2.5 h-2.5" />{t.armyPick}
                            </span>
                          )}
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
                        {/* 투어명 */}
                        <p className="text-xs text-white/45 leading-snug mb-2">{concert.tourName}</p>
                        {/* 날짜 + 장소 */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <div className="flex items-center gap-1.5 text-xs text-white/55">
                            <Calendar className="w-3 h-3 shrink-0 text-[#7C5CFC]" />
                            <span>{lk === 'ko' ? concert.dateDisplayKo : concert.dateDisplay}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-white/45">
                            <MapPin className="w-3 h-3 shrink-0 text-[#EA537E]" />
                            <span>{lk === 'ko' ? concert.venueKo : concert.venue}</span>
                          </div>
                        </div>
                      </div>
                      {/* 가격 + 지도 */}
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-white/40 mb-0.5">{t.oneWay}</p>
                        <p className="text-sm font-bold text-[#A78BFA]">₩{concert.oneWayPrice.toLocaleString('ko-KR')}</p>
                        <a
                          href={concert.naverMapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mt-2 text-[10px] text-[#7C5CFC] hover:text-[#A78BFA] transition-colors"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          {t.naverMap}
                        </a>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 예약 섹션 */}
            {selected && (
              <div className="px-5 pb-6 space-y-4 border-t border-white/[0.06] pt-4">
                {/* 픽업 */}
                <div>
                  <p className="text-xs text-white/40 mb-2">{t.pickupPoint}</p>
                  <div className="flex flex-wrap gap-2">
                    {(lk === 'ko' ? selected.pickupPointsKo : selected.pickupPoints).map((point, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPickup(selected.pickupPoints[idx])}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${pickup === selected.pickupPoints[idx] ? SEL : UNSEL}`}
                      >
                        {point}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 편도/왕복 */}
                <div className="grid grid-cols-2 gap-2">
                  {(['oneway', 'roundtrip'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setTripType(type)}
                      className={`py-2.5 rounded-xl border text-sm font-bold text-center transition-all ${tripType === type ? SEL : UNSEL}`}
                    >
                      {type === 'oneway' ? t.oneWay : t.roundTrip}
                      {' '}₩{(type === 'oneway' ? selected.oneWayPrice : selected.roundTripPrice).toLocaleString('ko-KR')}
                    </button>
                  ))}
                </div>

                {/* 인원 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">{t.passengers}</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setPax(p => Math.max(1, p - 1))}
                      className="w-7 h-7 rounded-lg border border-white/15 flex items-center justify-center text-white/60 hover:border-white/30 transition-colors">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-bold text-white w-6 text-center">{pax}</span>
                    <button type="button" onClick={() => setPax(p => Math.min(8, p + 1))}
                      className="w-7 h-7 rounded-lg border border-white/15 flex items-center justify-center text-white/60 hover:border-white/30 transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 금액 */}
                <div className="flex items-center justify-between bg-white/[0.04] rounded-xl px-4 py-3">
                  <span className="text-xs text-white/50">
                    {tripType === 'oneway' ? t.oneWay : t.roundTrip} ₩{unitPrice.toLocaleString('ko-KR')} × {pax}
                  </span>
                  <span className="text-sm font-bold text-white">
                    {t.total} ₩{totalPrice.toLocaleString('ko-KR')}
                  </span>
                </div>

                {/* PayPal */}
                {canBook && (
                  <PayPalBookingButton
                    productType={tripType === 'oneway' ? 'kpop_shuttle_oneway' : 'kpop_shuttle_roundtrip'}
                    passengers={pax}
                    dateStart={selected.dates[0]}
                    dateEnd={selected.dates[selected.dates.length - 1]}
                    priceKRW={totalPrice}
                    p={globalT.planner}
                    lang={language}
                    pickupLocation={pickup}
                    dropoffLocation={selected.venue}
                    vehicleType="staria"
                    memo={`${selected.artist} - ${selected.tourName}`}
                  />
                )}

                {/* 안내 */}
                <div className="flex items-start gap-2 text-[11px] text-white/35 leading-relaxed">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t.ticketNote}</span>
                </div>
              </div>
            )}

            {/* 선택 안내 */}
            {!selected && concerts.length > 0 && (
              <div className="px-5 pb-5 flex items-center gap-2 text-xs text-white/30">
                <ArrowRight className="w-3.5 h-3.5" />
                {t.selectConcert}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
