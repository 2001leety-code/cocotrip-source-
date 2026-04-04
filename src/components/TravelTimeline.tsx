import { useState, type ReactNode } from 'react';
import {
  MapPin, Clock, CreditCard, Train, Car, Bus,
  ExternalLink, Plane, Building2, UtensilsCrossed,
  ShoppingBag, DollarSign, Navigation, Footprints, ArrowDown
} from 'lucide-react';
import { PayPalBookingButton } from '@/components/PayPalBookingButton';

// ── 타입 ────────────────────────────────────────────
interface Coordinates { lat: number; lng: number }
interface TransportToNext {
  method: string; detail: string; durationMin: number; costKRW: string;
  charterRecommended?: string; charterCostEstimate?: string;
}
interface TimelinePlace {
  order: number; name: string; nameEn: string; category: string;
  address: string; coordinates: Coordinates;
  duration?: string; admissionFee?: string; tips: string;
  transportToNext?: TransportToNext;
  travelTimeFromPrev?: number;
  travelDistanceKm?: number;
  transitDataError?: boolean;
  naverTransitUrl?: string;
  naverDrivingUrl?: string;
}
interface TimelineDay {
  day: number; date: string; places: TimelinePlace[];
}
interface TravelTimelineProps {
  itinerary: TimelineDay[];
  p: any; lang: string; passengers: number;
}

// ── 택시 요금 추정 ────────────────────────────
function estimateTaxiFare(distanceKm: number): number {
  const BASE_FARE = 4800;
  const BASE_DIST = 1.6;
  const PER_100M  = 100;
  if (distanceKm <= BASE_DIST) return BASE_FARE;
  const extraDist = (distanceKm - BASE_DIST) * 10;
  return Math.round(BASE_FARE + extraDist * PER_100M);
}

// ── 카테고리별 아이콘 + 색상 ─────────────────────
const CAT_STYLES: Record<string, { icon: ReactNode; bg: string; border: string; text: string }> = {
  'K-pop':     { icon: <MapPin className="w-4 h-4" />,          bg: 'bg-purple-500/20', border: 'border-purple-500/40', text: 'text-purple-300' },
  'K-food':    { icon: <UtensilsCrossed className="w-4 h-4" />, bg: 'bg-orange-500/20', border: 'border-orange-500/40', text: 'text-orange-300' },
  'K-culture': { icon: <Building2 className="w-4 h-4" />,       bg: 'bg-blue-500/20',   border: 'border-blue-500/40',   text: 'text-blue-300' },
  'K-beauty':  { icon: <ShoppingBag className="w-4 h-4" />,     bg: 'bg-pink-500/20',   border: 'border-pink-500/40',   text: 'text-pink-300' },
  'nature':    { icon: <MapPin className="w-4 h-4" />,          bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-300' },
  'shopping':  { icon: <ShoppingBag className="w-4 h-4" />,     bg: 'bg-amber-500/20',  border: 'border-amber-500/40',  text: 'text-amber-300' },
  'heritage':  { icon: <Building2 className="w-4 h-4" />,       bg: 'bg-cyan-500/20',   border: 'border-cyan-500/40',   text: 'text-cyan-300' },
  'airport':   { icon: <Plane className="w-4 h-4" />,           bg: 'bg-sky-500/20',    border: 'border-sky-500/40',    text: 'text-sky-300' },
  'hotel':     { icon: <Building2 className="w-4 h-4" />,       bg: 'bg-indigo-500/20', border: 'border-indigo-500/40', text: 'text-indigo-300' },
  'restaurant':{ icon: <UtensilsCrossed className="w-4 h-4" />, bg: 'bg-rose-500/20',   border: 'border-rose-500/40',   text: 'text-rose-300' },
};
const DEFAULT_CAT = { icon: <MapPin className="w-4 h-4" />, bg: 'bg-violet-500/20', border: 'border-violet-500/40', text: 'text-violet-300' };

function getCatStyle(category: string) {
  return CAT_STYLES[category] ?? DEFAULT_CAT;
}

// ── 이동수단 아이콘 ─────────────────────────────
function getTransportIcon(place: TimelinePlace): ReactNode {
  const dist = place.travelDistanceKm ?? 0;
  if (dist < 1) return <Footprints className="w-3.5 h-3.5" />;
  const method = place.transportToNext?.method ?? '';
  if (method.includes('bus') || method.includes('subway')) return <Train className="w-3.5 h-3.5" />;
  return <Car className="w-3.5 h-3.5" />;
}

// ── 이동수단 라벨 ─────────────────────────────
function getTransportLabel(place: TimelinePlace): string {
  const dist = place.travelDistanceKm ?? 0;
  if (dist < 1) return 'Walk';
  const method = place.transportToNext?.method ?? '';
  if (method.includes('bus') || method.includes('subway')) return 'Transit';
  return 'Drive';
}

// ── 이동수단 선택 ─────────────────────────────
type TransitMode = 'public' | 'taxi' | 'cocotrip';

// ── 브루마블 스톱 노드 ────────────────────────
function BoardStop({ place, index, isFirst, isLast, p }: {
  place: TimelinePlace; index: number; isFirst: boolean; isLast: boolean; p: any;
}) {
  const cat = getCatStyle(place.category);
  const mapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(place.address || place.name)}`;

  return (
    <div className="relative">
      {/* 번호 뱃지 */}
      <div className={`absolute -top-3 -left-2 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white shadow-lg ${
        isFirst ? 'bg-emerald-500' : isLast ? 'bg-rose-500' : 'bg-[#7C5CFC]'
      }`}>
        {index + 1}
      </div>

      <div className={`rounded-2xl border p-4 ${cat.border} bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] transition-all`}>
        {/* 아이콘 + 이름 */}
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl ${cat.bg} border ${cat.border} flex items-center justify-center shrink-0 ${cat.text}`}>
            {cat.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-white text-sm leading-snug truncate">{place.name}</h4>
            <p className="text-[11px] text-white/30 truncate">{place.nameEn}</p>
          </div>
        </div>

        {/* 체류시간 + 입장료 */}
        <div className="flex flex-wrap gap-3 mt-2.5">
          {place.duration && (
            <span className="text-[11px] text-white/45 flex items-center gap-1">
              <Clock className="w-3 h-3 text-white/30" /> {place.duration}
            </span>
          )}
          {place.admissionFee && place.admissionFee.toLowerCase() !== 'free' && (
            <span className="text-[11px] text-white/45 flex items-center gap-1">
              <CreditCard className="w-3 h-3 text-white/30" /> {place.admissionFee}
            </span>
          )}
        </div>

        {/* 네이버 지도 링크 */}
        <a href={mapUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-[10px] text-[#03C75A] font-medium hover:text-[#03C75A]/80 transition-colors">
          <Navigation className="w-3 h-3" /> {p.naver_map ?? 'Naver Map'}
        </a>
      </div>
    </div>
  );
}

// ── 이동 커넥터 (화살표 + 시간/거리) ─────────
function BoardConnector({ place, direction, mode, setMode, prevPlace, p, lang, passengers }: {
  place: TimelinePlace;
  direction: 'right' | 'left' | 'down';
  mode: TransitMode;
  setMode: (m: TransitMode) => void;
  prevPlace: TimelinePlace;
  p: any; lang: string; passengers: number;
}) {
  const min = place.travelTimeFromPrev;
  const dist = place.travelDistanceKm;
  const taxiFare = (dist && min) ? estimateTaxiFare(dist) : null;
  const charterCost = place.transportToNext?.charterCostEstimate;
  const cocoCostKRW = charterCost
    ? parseInt(charterCost.replace(/[^\d]/g, ''), 10) || null
    : (dist ? Math.round(Math.max(291200, dist * 5000)) : null);

  const [expanded, setExpanded] = useState(false);

  // 세로 커넥터 (행 전환)
  if (direction === 'down') {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="w-[2px] h-4 bg-gradient-to-b from-[#7C5CFC]/40 to-[#EA537E]/40" />
        <div className="w-8 h-8 rounded-full bg-[rgba(124,92,252,0.12)] border border-[rgba(124,92,252,0.3)] flex items-center justify-center">
          <ArrowDown className="w-4 h-4 text-[#9d7ffe]" />
        </div>
        <div className="w-[2px] h-4 bg-gradient-to-b from-[#EA537E]/40 to-[#7C5CFC]/40" />
      </div>
    );
  }

  // 가로 커넥터
  return (
    <div className="flex flex-col items-center justify-center px-1 min-w-[60px] shrink-0">
      {/* 점선 + 화살표 */}
      <div className="flex items-center gap-1 mb-1">
        <div className="h-[2px] w-3 bg-gradient-to-r from-transparent to-white/20" />
        <div className="w-6 h-6 rounded-full bg-[rgba(255,255,255,0.06)] border border-white/10 flex items-center justify-center">
          {getTransportIcon(place)}
        </div>
        <div className="h-[2px] w-3 bg-gradient-to-r from-white/20 to-transparent" />
      </div>

      {/* 시간/거리 */}
      {min != null && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-center cursor-pointer hover:scale-105 transition-transform"
        >
          <p className="text-[10px] font-bold text-white/50">{min}min</p>
          {dist != null && <p className="text-[9px] text-white/25">{dist}km</p>}
        </button>
      )}

      {/* 확장 패널: 이동수단 선택 */}
      {expanded && (
        <div className="absolute z-20 mt-1 bg-[#1a1a2e] border border-white/15 rounded-xl p-3 shadow-2xl min-w-[200px]"
          style={{ top: '100%' }}>
          <p className="text-[10px] text-white/40 mb-2 font-semibold">{p.transitSelect ?? 'Transport'}</p>
          <div className="space-y-1.5">
            {/* 대중교통 */}
            <button onClick={() => { setMode('public'); setExpanded(false); }}
              className={`w-full text-left rounded-lg px-3 py-2 text-xs flex items-center gap-2 transition-all ${
                mode === 'public' ? 'bg-[rgba(0,168,77,0.15)] border border-[rgba(0,168,77,0.4)] text-[#03C75A]' : 'bg-white/[0.04] border border-white/10 text-white/50 hover:border-white/20'
              }`}>
              <Train className="w-3.5 h-3.5" />
              <span className="flex-1">{p.transitSubway ?? 'Transit'}</span>
              {place.naverTransitUrl && (
                <a href={place.naverTransitUrl} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()} className="text-[#03C75A]">
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </button>

            {/* 택시 */}
            <button onClick={() => { setMode('taxi'); setExpanded(false); }}
              className={`w-full text-left rounded-lg px-3 py-2 text-xs flex items-center gap-2 transition-all ${
                mode === 'taxi' ? 'bg-[rgba(255,255,255,0.08)] border border-white/20 text-white' : 'bg-white/[0.04] border border-white/10 text-white/50 hover:border-white/20'
              }`}>
              <Car className="w-3.5 h-3.5" />
              <span className="flex-1">{p.transitTaxi ?? 'Taxi'}</span>
              {taxiFare && <span className="text-[10px] font-medium">~₩{taxiFare.toLocaleString('ko-KR')}</span>}
            </button>

            {/* 코코트립 */}
            <button onClick={() => { setMode('cocotrip'); setExpanded(false); }}
              className={`w-full text-left rounded-lg px-3 py-2 text-xs flex items-center gap-2 transition-all border ${
                mode === 'cocotrip' ? 'border-[rgba(124,92,252,0.5)] text-[#9d7ffe]' : 'border-[rgba(124,92,252,0.2)] text-[#9d7ffe]/60 hover:border-[rgba(124,92,252,0.4)]'
              }`}
              style={{ background: mode === 'cocotrip' ? 'linear-gradient(135deg, rgba(124,92,252,0.15), rgba(234,83,126,0.1))' : 'rgba(124,92,252,0.05)' }}>
              <Bus className="w-3.5 h-3.5" />
              <span className="flex-1">{p.transitCoco ?? 'CocoTrip'}</span>
            </button>

            {/* 코코트립 PayPal */}
            {mode === 'cocotrip' && cocoCostKRW && (
              <div className="mt-1">
                <PayPalBookingButton
                  productType="charter_seoul_suburb"
                  passengers={passengers}
                  dateStart="" dateEnd=""
                  priceKRW={cocoCostKRW}
                  p={p} lang={lang}
                  pickupLocation={prevPlace.name}
                  dropoffLocation={place.name}
                  vehicleType="staria"
                  memo={`${prevPlace.name} → ${place.name}`}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 브루마블 보드 행 ──────────────────────────
function BoardRow({ places, startIdx, reverse, dayIdx, getMode, setMode, p, lang, passengers }: {
  places: TimelinePlace[];
  startIdx: number;
  reverse: boolean;
  dayIdx: number;
  getMode: (dayIdx: number, placeIdx: number) => TransitMode;
  setMode: (dayIdx: number, placeIdx: number, mode: TransitMode) => void;
  p: any; lang: string; passengers: number;
}) {
  const orderedPlaces = reverse ? [...places].reverse() : places;
  const totalPlaces = orderedPlaces.length;

  return (
    <div className={`flex items-stretch gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
      {orderedPlaces.map((place, i) => {
        const realIdx = reverse ? startIdx + (totalPlaces - 1 - i) : startIdx + i;
        const isFirstOfAll = realIdx === 0;
        const showConnector = i > 0;
        const prevPlace = showConnector ? orderedPlaces[i - 1] : place;

        return (
          <div key={realIdx} className="flex items-stretch" style={{ flex: '1 1 0' }}>
            {showConnector && (
              <div className="relative flex items-center">
                <BoardConnector
                  place={place}
                  direction={reverse ? 'left' : 'right'}
                  mode={getMode(dayIdx, realIdx)}
                  setMode={(m) => setMode(dayIdx, realIdx, m)}
                  prevPlace={prevPlace}
                  p={p} lang={lang} passengers={passengers}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <BoardStop
                place={place}
                index={realIdx}
                isFirst={isFirstOfAll}
                isLast={false}
                p={p}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 메인: 브루마블 보드 타임라인 ─────────────────
export function TravelTimeline({ itinerary, p, lang, passengers }: TravelTimelineProps) {
  const [activeDay, setActiveDay] = useState(0);
  const [modes, setModes] = useState<Record<string, TransitMode>>({});

  const getMode = (dayIdx: number, placeIdx: number): TransitMode => {
    const key = `${dayIdx}-${placeIdx}`;
    if (modes[key]) return modes[key];
    const place = itinerary[dayIdx]?.places?.[placeIdx];
    if (place?.transportToNext?.charterRecommended === 'yes') return 'cocotrip';
    return 'public';
  };

  const setMode = (dayIdx: number, placeIdx: number, mode: TransitMode) => {
    setModes(prev => ({ ...prev, [`${dayIdx}-${placeIdx}`]: mode }));
  };

  const currentDay = itinerary[activeDay];
  if (!currentDay) return null;

  const places = currentDay.places;
  const COLS = 3; // 한 행에 3개씩

  // places를 COLS개씩 행으로 나누기
  const rows: TimelinePlace[][] = [];
  for (let i = 0; i < places.length; i += COLS) {
    rows.push(places.slice(i, i + COLS));
  }

  return (
    <div className="mt-8">
      {/* 섹션 타이틀 */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 rounded-lg bg-[rgba(124,92,252,0.15)] border border-[rgba(124,92,252,0.3)] flex items-center justify-center">
          <Navigation className="w-4 h-4 text-[#9d7ffe]" />
        </div>
        <div>
          <p className="text-sm font-bold text-white">{p.timelineTitle ?? 'Travel Route'}</p>
          <p className="text-[10px] text-white/30">{p.timelineSub ?? 'Tap transit icons for transport options'}</p>
        </div>
      </div>

      {/* 날짜 탭 */}
      {itinerary.length > 1 && (
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          {itinerary.map((day, i) => (
            <button key={i} type="button" onClick={() => setActiveDay(i)}
              className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
                activeDay === i
                  ? 'text-white bg-[#7C5CFC] shadow-lg shadow-[#7C5CFC]/30'
                  : 'text-white/35 bg-[rgba(255,255,255,0.04)] border border-white/8 hover:text-white/55'
              }`}>
              {p.dayLabel ?? 'Day'} {day.day}
              <span className="block text-[9px] font-normal opacity-60 mt-0.5">{day.date}</span>
            </button>
          ))}
        </div>
      )}

      {/* 요약 바 */}
      <div className="flex flex-wrap gap-3 mb-5 px-1">
        <span className="text-xs text-white/50 flex items-center gap-1.5 bg-white/[0.04] px-3 py-1.5 rounded-full">
          <MapPin className="w-3.5 h-3.5 text-[#7C5CFC]" /> {places.length} {p.placesCount ?? 'stops'}
        </span>
        {(() => {
          const totalMin = places.reduce((s, pl) => s + (pl.travelTimeFromPrev || 0), 0);
          return totalMin > 0 ? (
            <span className="text-xs text-white/50 flex items-center gap-1.5 bg-white/[0.04] px-3 py-1.5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-[#EA537E]" /> {totalMin}{p.driveSuffix ?? 'min'} {p.totalTransitTime ?? 'travel'}
            </span>
          ) : null;
        })()}
      </div>

      {/* ── 브루마블 보드 ── */}
      <div className="space-y-0">
        {rows.map((row, rowIdx) => {
          const reverse = rowIdx % 2 === 1; // 짝수 행 →, 홀수 행 ←
          const startIdx = rowIdx * COLS;

          return (
            <div key={rowIdx}>
              {/* 행 전환 커넥터 */}
              {rowIdx > 0 && (
                <div className={`flex ${reverse ? 'justify-start pl-4' : 'justify-end pr-4'}`}>
                  <BoardConnector
                    place={row[reverse ? row.length - 1 : 0]}
                    direction="down"
                    mode={getMode(activeDay, startIdx)}
                    setMode={(m) => setMode(activeDay, startIdx, m)}
                    prevPlace={rows[rowIdx - 1][reverse ? 0 : rows[rowIdx - 1].length - 1]}
                    p={p} lang={lang} passengers={passengers}
                  />
                </div>
              )}

              {/* 모바일: 세로 리스트 / 데스크톱: 가로 보드 */}
              {/* 모바일에서는 항상 세로 */}
              <div className="block sm:hidden space-y-2">
                {row.map((place, i) => {
                  const realIdx = startIdx + i;
                  return (
                    <div key={realIdx}>
                      {/* 커넥터 */}
                      {(realIdx > 0) && (
                        <div className="flex items-center gap-2 py-2 pl-4">
                          <div className="w-[2px] h-full bg-gradient-to-b from-[#7C5CFC]/30 to-[#EA537E]/30 shrink-0" />
                          <div className="flex items-center gap-2 flex-1">
                            <div className="w-6 h-6 rounded-full bg-[rgba(255,255,255,0.06)] border border-white/10 flex items-center justify-center text-white/40">
                              {getTransportIcon(place)}
                            </div>
                            {place.travelTimeFromPrev != null && (
                              <span className="text-[11px] text-white/40 font-medium">
                                {place.travelTimeFromPrev}min
                                {place.travelDistanceKm != null && <span className="text-white/20 ml-1">{place.travelDistanceKm}km</span>}
                              </span>
                            )}
                            <span className="text-[10px] text-white/25">{getTransportLabel(place)}</span>
                          </div>
                        </div>
                      )}
                      <BoardStop
                        place={place}
                        index={realIdx}
                        isFirst={realIdx === 0}
                        isLast={realIdx === places.length - 1}
                        p={p}
                      />
                    </div>
                  );
                })}
              </div>

              {/* 데스크톱: 가로 보드 */}
              <div className="hidden sm:block">
                <BoardRow
                  places={row}
                  startIdx={startIdx}
                  reverse={reverse}
                  dayIdx={activeDay}
                  getMode={getMode}
                  setMode={setMode}
                  p={p} lang={lang} passengers={passengers}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* START → END 표시 */}
      <div className="flex items-center justify-between mt-5 px-1">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[9px] font-black text-white">1</div>
          <span className="text-white/40">Start</span>
        </div>
        <div className="h-[1px] flex-1 mx-3 bg-gradient-to-r from-emerald-500/30 via-[#7C5CFC]/30 to-rose-500/30" />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/40">End</span>
          <div className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center text-[9px] font-black text-white">{places.length}</div>
        </div>
      </div>

      {/* 비용 요약 */}
      <CostSummary itinerary={itinerary} activeDay={activeDay} getMode={getMode} p={p} />
    </div>
  );
}

// ── 비용 요약 카드 ───────────────────────────────
function CostSummary({ itinerary, activeDay, getMode, p }: {
  itinerary: TimelineDay[]; activeDay: number;
  getMode: (dayIdx: number, placeIdx: number) => TransitMode;
  p: any;
}) {
  let taxiTotal = 0;
  let publicNote = false;
  let cocoCount = 0;

  const day = itinerary[activeDay];
  if (!day) return null;

  day.places.forEach((place, i) => {
    if (i === 0) return;
    const mode = getMode(activeDay, i);
    if (mode === 'taxi' && place.travelDistanceKm && place.travelTimeFromPrev) {
      taxiTotal += estimateTaxiFare(place.travelDistanceKm);
    }
    if (mode === 'public') publicNote = true;
    if (mode === 'cocotrip') cocoCount++;
  });

  if (taxiTotal === 0 && !publicNote && cocoCount === 0) return null;

  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mt-5">
      <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-3 flex items-center gap-1">
        <DollarSign className="w-3 h-3" /> {p.totalCostSummary ?? 'Estimated Transport Cost'}
      </p>
      <div className="space-y-2 text-xs">
        {publicNote && (
          <div className="flex justify-between text-white/40">
            <span className="flex items-center gap-1"><Train className="w-3 h-3" /> {p.transitSubway ?? 'Transit'}</span>
            <a href="https://map.naver.com" target="_blank" rel="noopener noreferrer" className="text-[#03C75A] text-[10px]">{p.checkNaverMap ?? 'Naver Map'}</a>
          </div>
        )}
        {taxiTotal > 0 && (
          <div className="flex justify-between text-white/50">
            <span className="flex items-center gap-1"><Car className="w-3 h-3" /> {p.transitTaxi ?? 'Taxi'}</span>
            <span className="font-medium">~₩{taxiTotal.toLocaleString('ko-KR')}</span>
          </div>
        )}
        {cocoCount > 0 && (
          <div className="flex justify-between text-[#9d7ffe]">
            <span className="flex items-center gap-1"><Bus className="w-3 h-3" /> {p.transitCoco ?? 'CocoTrip'} ({cocoCount})</span>
            <span className="text-[10px]">{p.vehicleCustomQuote ?? 'Per-ride payment'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
