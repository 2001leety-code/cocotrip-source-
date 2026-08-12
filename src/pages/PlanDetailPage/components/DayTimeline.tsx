// Day-level timeline: theme badge + ordered stops with transit arrows between them.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L830-852) during P2 Lock release.
// B8: Added SortableContext for drag-reorder, conditional edit UI, and + Add Stop button.
import { useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Calendar, Clock, MapPin, TrainFront, Plane } from 'lucide-react';
import { TransitArrow } from './TransitArrow';
import { TransitFallback } from './TransitFallback';
import { SortableStopCard } from './SortableStopCard';
import { StopCard, type LodgingRole } from './StopCard';
import { ConfirmDialog } from './ConfirmDialog';
import { CharterCTA } from './CharterCTA';
import { RouteInsightCard } from './RouteInsightCard';
import { OptimizePanel } from './OptimizePanel';
import { findMostTiringSegment } from '../lib/routeInsight';
import { computeDayTotals } from '../lib/transitVsCharter';
import { Footprints, Wallet } from 'lucide-react';
import { LodgingBookend } from './LodgingBookend';
import { ActivityMetaChips } from './ActivityMetaChips';
import { DayRouteMap } from './DayRouteMap';
import { useLanguage } from '@/hooks/useLanguage';
import type { Language } from '@/i18n';
import type { PlanDay, PlanStop, PlanDocument, IntercityTransitSegment } from '../types';
import { getPlanDetailDict } from '../types';
import type { TransitFromPrev } from '@/types/plan';
import { dayLabelParts, formatDayLabel } from '../lib/dayLabel';

interface DayTimelineProps {
  day: PlanDay;
  dayIndex: number;
  editMode: boolean;
  isRecalculating?: boolean;
  onDeleteStop: (dayIdx: number, stopIdx: number) => void;
  onAddStop: (dayIdx: number) => void;
  /** UIUX P4 Optimize (2026-07-13): 제안 순서 일괄 적용 — usePlanEditor.applyStopOrder 배선. */
  onApplyOrder?: (dayIdx: number, order: number[]) => void | Promise<void>;
  /** 2026-05-08: 숙소 라벨 source — input.hotel_address 또는 zone 키. */
  plan?: PlanDocument;
  /** plan 소유자 여부 — StopCard 의 즐겨찾기/공유 버튼을 소유자에게만 노출. */
  isOwner?: boolean;
}

/** P140 (2026-05-22): per-day lodging label resolver. 다도시 plan 에서 Day N
 *  city 기준 호텔 라벨 결정 — 이전 `getLodgingLabel(plan)` 단일 호출은 plan.input
 *  .hotel_address 하나만 봐서 부산 day 가 "서울 중구 명동역" 노출되는 회귀.
 *
 *  Priority chain:
 *  1. day.lodging.name / day.lodging.address — backend planPersister.backfillDayLodging 가
 *     hotelByCity 또는 stops first lodging 으로 채움 (P119/P123).
 *  2. plan.input.hotelByCity[day.city] — 사용자 wizard 도시별 호텔 input (P123 forward).
 *  3. plan.input.hotel_address — 단도시 plan / legacy / entry city.
 *  4. plan.input.recommended_zone_address — zone 사용자.
 *  5. plan.input.recommended_zone — zone 키 (camelCase legacy 폴백 포함).
 *  6. undefined → LodgingBookend 가 빈 라벨 graceful skip. */
/**
 * (2026-07-28) 구간 딥링크 폴백용 양 끝 좌표.
 * 도보 구간은 백엔드가 승하차 지점을 안 만들어 TransitArrow 가 지도 버튼을 통째로
 * 숨겼다 — 앞뒤 stop 좌표를 넘겨 도보 구간에도 네이버/구글 링크가 뜨게 한다.
 */
function segmentEndpoints(
  prevStop: PlanStop | null,
  prevName: string,
  stop: PlanStop,
  destName: string,
) {
  const coord = (s: PlanStop | null) => s as { lat?: number | null; lng?: number | null } | null;
  return {
    fromLat: coord(prevStop)?.lat,
    fromLng: coord(prevStop)?.lng,
    fromName: prevName,
    toLat: coord(stop)?.lat,
    toLng: coord(stop)?.lng,
    toName: destName,
  };
}

function getLodgingLabelForDay(plan: PlanDocument | undefined, day: PlanDay): string | undefined {
  if (!plan) return undefined;
  // 1. backend backfilled day.lodging (P119/P123)
  const dayLodging = (day as { lodging?: { name?: string | null; address?: string | null } }).lodging;
  if (dayLodging) {
    const dlName = String(dayLodging.name || '').trim();
    if (dlName.length > 0) return dlName;
    const dlAddr = String(dayLodging.address || '').trim();
    if (dlAddr.length > 0) return dlAddr;
  }
  const input = (plan.input || {}) as Record<string, unknown>;
  // 2. 다도시 hotelByCity Record (P123)
  const dayCity = String(day.city || '').trim().toLowerCase();
  const hotelByCity = (input.hotelByCity as Record<string, string> | undefined) || undefined;
  if (dayCity && hotelByCity && typeof hotelByCity === 'object') {
    const cityHotel = String(hotelByCity[dayCity] || '').trim();
    if (cityHotel.length > 0) return cityHotel;
  }
  // 3. plan-level hotel_address (단도시 / entry city / legacy)
  const hotelAddr = (input.hotel_address as string) || '';
  if (typeof hotelAddr === 'string' && hotelAddr.trim().length > 0) return hotelAddr;
  // 4-5. zone fallback
  const zoneAddr = (input.recommended_zone_address as string) || '';
  if (typeof zoneAddr === 'string' && zoneAddr.trim().length > 0) return zoneAddr;
  const zone = (input.recommended_zone as string)
    || (input.recommendedZone as string)
    || '';
  if (typeof zone === 'string' && zone.trim().length > 0) return zone;
  return undefined;
}

export function DayTimeline({ day, dayIndex, editMode, isRecalculating, onDeleteStop, onAddStop, onApplyOrder, plan, isOwner }: DayTimelineProps) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ed = pd.editor || {};

  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const stops = day.stops || [];
  // UIUX P5 (2026-07-13): 하루 최대 1개 — 가장 힘든 대중교통 구간에 Route Insight 카드.
  const tiringSegment = findMostTiringSegment(stops);
  // UIUX P4 (2026-07-13): 하루 하단 총계 3칩 (도보/교통/비용) — 실측 데이터 있을 때만.
  const dayTotals = computeDayTotals(stops);
  const trDict = (pd.transit || {}) as Record<string, string>;
  const regionNames = ((t as unknown as { planner?: { regionNames?: Record<string, string> } }).planner?.regionNames) || {};
  const stopIds = stops.map((_: PlanStop, i: number) => `day-${dayIndex}-stop-${i}`);
  const dayNumber = Number(day.day || dayIndex + 1);
  const dayLabel = dayLabelParts(language, dayNumber);

  // Sprint 1 Step 2: 풍부한 day 헤더 메타 (사용자 신고 "UI 개선 심각")
  // 첫/마지막 stop 시간 → 일정 범위 표시
  const firstTime = stops[0]?.start_time;
  const lastTime = stops[stops.length - 1]?.start_time;
  const timeRange = firstTime && lastTime ? `${firstTime} – ${lastTime}` : firstTime || lastTime || '';
  // 'placesUnit' (곳/places) 사용 — pd.transit.stops 는 지하철 정거장 의미라 부적절
  const stopCountLabel = (pd as { placesUnit?: string }).placesUnit || 'places';
  const tourStartTime = (plan?.input as { tour_start_time?: string; tourStartTime?: string } | undefined)?.tour_start_time
    || (plan?.input as { tour_start_time?: string; tourStartTime?: string } | undefined)?.tourStartTime
    || '09:00';
  const arrivalOnlyHint = String(pd.day1ArrivalOnlyHint || 'Your tour starts tomorrow at {{time}}.')
    .replace('{{time}}', tourStartTime);

  // B9-39 (2026-05-09): 다도시 plan 의 도시 라벨 + 도시 간 이동 카드 데이터.
  // city 가 있으면 Day 헤더에 chip 으로 표시; legacy plan = undefined → 미노출.
  const cityKey = String(day.city
    || ((plan?.input?.regions as string[] | undefined)?.[0])
    || '').trim();
  const cityLabel = cityKey
    ? (regionNames[cityKey.toLowerCase()] || regionNames[cityKey] || cityKey)
    : undefined;
  const intercity: IntercityTransitSegment | null | undefined = day.intercity_transit;

  /**
   * P116 (2026-05-20): lodging bookend 패턴의 호텔 카드 라벨링.
   *  - 첫 stop 호텔 + intercity_transit 있음 → 'checkout' (다른 도시 출발 전)
   *  - 첫 stop 호텔 + intercity_transit 없음 → 'depart' (당일 일반 출발)
   *  - 마지막 stop 호텔 → 'return' (취침 복귀)
   *  - 중간 stop 호텔 → 'checkin' (city-change day 새 호텔)
   *  - 비-lodging → undefined (no badge)
   *
   * P143 (2026-05-22): city-change day 의 첫 lodging stop role 정확도 보강.
   * 이전 회귀: Seoul→Busan KTX 09:30 plan 에서 Day 3 첫 stop 'Hotel in Haeundae'
   * (Busan 호텔) 가 '체크아웃' badge 로 잘못 표시 (KTX 후 도착 호텔 = checkin 이어야).
   * 판정: stop.start_time > intercity.arrival_at → KTX 도착 후 stop = 'checkin'.
   * intercity.recommended_depart > stop.start_time → KTX 출발 전 stop = 'checkout'.
   */
  function computeLodgingRole(
    stop: PlanStop,
    si: number,
    stopsArr: PlanStop[],
    hasIntercity: boolean,
    intercity?: IntercityTransitSegment | null,
  ): LodgingRole | undefined {
    if (stop.category !== 'lodging') return undefined;
    const isFirst = si === 0;
    const isLast = si === stopsArr.length - 1;
    if (isFirst && hasIntercity) {
      // P143: intercity arrival_at vs stop.start_time 으로 checkout/checkin 판정.
      const stopMin = parseHHMM(stop.start_time);
      const arrivalMin = parseHHMM(intercity?.arrival_at);
      const departMin = parseHHMM(intercity?.recommended_depart);
      if (stopMin !== null) {
        if (arrivalMin !== null && stopMin >= arrivalMin) return 'checkin'; // 도착 후 = 신도시 체크인
        if (departMin !== null && stopMin <= departMin) return 'checkout'; // 출발 전 = 구도시 체크아웃
      }
      // fallback (시간 정보 부족): 기존 동작 — first + intercity = checkout 가정
      return 'checkout';
    }
    if (isFirst) return 'depart';
    if (isLast) return 'return';
    return 'checkin';
  }

  /** P143: "HH:MM" → minutes since midnight. invalid → null. */
  function parseHHMM(t: string | undefined | null): number | null {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t));
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  return (
    <section className="mb-8 md:mb-12">
      <div className="mb-5 border-b border-ec-line-2 pb-5">
        <div>
          {/* DAY 라벨 + 일자 번호 */}
          <div className="mb-1.5 flex items-baseline gap-1.5">
            {dayLabel.prefix && <span className="ec-eyebrow text-ec-brand">{dayLabel.prefix}</span>}
            <span className="ec-figure text-[24px] leading-none sm:text-[28px]">
              {dayLabel.number}
            </span>
            {dayLabel.suffix && <span className="ec-eyebrow text-ec-brand">{dayLabel.suffix}</span>}
          </div>

          {/* Theme — 큰 글씨 강조 */}
          <h2 className="ec-h3 mb-3 text-[clamp(21px,2.4vw,30px)]">
            {day.theme || formatDayLabel(language, dayNumber)}
          </h2>

          {/* Meta chips: 일자 / 시간 / stops 수 / city (다도시 plan) */}
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] sm:text-[13px]">
            {day.date && (
              <span className="ec-chip">
                <Calendar className="w-2.5 h-2.5" /> {day.date}
              </span>
            )}
            {timeRange && (
              <span className="ec-chip">
                <Clock className="w-2.5 h-2.5" /> {timeRange}
              </span>
            )}
            {stops.length > 0 && (
              <span className="ec-chip ec-chip-brand">
                <MapPin className="w-2.5 h-2.5" /> {stops.length} {stopCountLabel}
              </span>
            )}
            {cityLabel && (
              /* B9-39: 다도시 plan 의 도시 라벨. 단일 도시 plan 도 보여 OK
                 (regions[0] fallback 으로 채워짐). 시각적 강조 위해 별도 색상. */
              <span className="ec-chip">
                <MapPin className="w-2.5 h-2.5" /> {cityLabel}
              </span>
            )}
          </div>

          {/* PR-E SAFETY (2026-06-02): 트레킹/러닝 day 난이도·위험·부적합 칩.
              activity_meta 있을 때만(FEATURE_ACTIVITY_BLOCKS ON + 활동 블록) → flag OFF/city_day = byte-identical. */}
          {day.activity_meta && (
            <ActivityMetaChips meta={day.activity_meta} language={language as Language} />
          )}
        </div>
      </div>

      {/* Per-day route map (ulruru-style): numbered pins + polyline in visit order.
          Renders nothing when <2 stops carry valid coords. Lazy-loads Leaflet so
          it never bloats the main bundle. Sits at the top of the day's content. */}
      <DayRouteMap stops={stops} />

      {/* B9-39 (2026-05-09): 다도시 plan 의 도시 간 이동 카드 (KTX/항공/버스).
          intercity_transit 가 있을 때만 노출 — 단일 도시 plan = 미노출.
          PDF-issue-2 (2026-05-14): 전후 bookend segment 표시 — 사용자 PDF "부산호텔→
          부산역" + "서울역→명동호텔" transit 누락 회귀 fix. RouteAgent 가 intercity_transit
          .lodging_to_station + station_to_lodging 채우면 LodgingBookend 로 표시. */}
      {intercity && (intercity.mode || intercity.method) && (
        <>
          {/* 전 bookend: 이전 day 호텔 → from_station */}
          {(intercity as IntercityTransitSegment & { lodging_to_station?: TransitFromPrev }).lodging_to_station && (
            <LodgingBookend
              transit={(intercity as IntercityTransitSegment & { lodging_to_station?: TransitFromPrev }).lodging_to_station as TransitFromPrev}
              variant="depart"
              lodgingLabel={`${intercity.from_city || ''} 호텔`.trim() || undefined}
              otherLabel={(intercity as IntercityTransitSegment & { from_station?: string | null }).from_station || ''}
            />
          )}
          <IntercityTransitCard intercity={intercity} language={language} pd={pd} />
          {/* 후 bookend: to_station → 새 day 호텔 */}
          {(intercity as IntercityTransitSegment & { station_to_lodging?: TransitFromPrev }).station_to_lodging && (
            <LodgingBookend
              transit={(intercity as IntercityTransitSegment & { station_to_lodging?: TransitFromPrev }).station_to_lodging as TransitFromPrev}
              variant="return"
              lodgingLabel={`${intercity.to_city || ''} 호텔`.trim() || undefined}
              otherLabel={(intercity as IntercityTransitSegment & { to_station?: string | null }).to_station || ''}
            />
          )}
        </>
      )}

      {/* P239 (2026-05-27): Day 1 = lodging only 안내 — 운영자 architectural fix.
          새벽 도착 시 호텔만 transit + 다음날 09:00 (tour_start_time) 부터 stops 시작.
          첫날의 유일한 stop 이 lodging 일 때만 노출 (일반 1-stop 일정에 허위 안내 금지). */}
      {(day.day === 1 || dayIndex === 0) && stops.length === 1 && stops[0]?.category === 'lodging' && (
        <div className="mb-4 border-l-2 border-ec-line-2 bg-ec-sunken px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="text-lg leading-none">🌙</span>
            <div className="flex-1">
              <p className="mb-1 text-[14px] font-semibold text-ec-ink">
                {pd.day1ArrivalOnlyTitle || 'Late arrival? Rest at your hotel'}
              </p>
              <p className="text-[13px] leading-relaxed text-ec-ink-2">
                {arrivalOnlyHint}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Charter CTA -- shown when transit is complex */}
      {/* PR-C2: pass plan prop for real-route prefill (flag ON only) */}
      <CharterCTA day={day} plan={plan} />


      {/* Transit recalculating indicator */}
      {isRecalculating && (
        <div className="mb-3 flex items-center gap-2 border border-ec-line bg-ec-brand-wash px-3 py-2">
          <div className="h-3 w-3 animate-pulse rounded-full bg-ec-brand" aria-hidden />
          <span className="text-[13px] font-semibold text-ec-brand">{ed.routeRecalculating || 'Updating routes...'}</span>
        </div>
      )}

      {/* 2026-05-08: 숙소 출발 카드 — RouteAgent 가 day.lodging_to_first 에 ODsay
          데이터를 채운 경우에만 노출. 첫 stop 의 transit_from_prev 와 동일 데이터를
          쓸 수도 있지만, day-level 에 별도로 두면 호텔 라벨 + 시각 강조 가능.
          P141 (2026-05-22): 첫 stop 자체가 lodging stop (체크인/출발 호텔) 이면
          day-level BookEnd 는 동일 호텔→동일 호텔 hop 또는 zone placeholder→hotel
          redundant 표시 → skip. lodging stop card 가 이미 호텔 표시 + 'depart' badge. */}
      {day.lodging_to_first && stops.length > 0 && stops[0]?.category !== 'lodging' && (
        <LodgingBookend
          transit={day.lodging_to_first as TransitFromPrev}
          variant="depart"
          lodgingLabel={getLodgingLabelForDay(plan, day)}
          otherLabel={(stops[0] as { display_name?: string; name?: string }).display_name
            || (stops[0] as { display_name?: string; name?: string }).name
            || ''}
        />
      )}

      {/* UIUX P4 Optimize (2026-07-13): 편집 모드 전용 최적화 제안 — 실데이터 파생만. */}
      {editMode && onApplyOrder && (
        <OptimizePanel day={day} dayIndex={dayIndex} plan={plan} onApplyOrder={onApplyOrder} />
      )}

      {editMode ? (
        <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 pl-0 sm:pl-12">
              {stops.map((stop: PlanStop, si: number) => {
                const destName = (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).display_name
                  || (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).name
                  || (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).name_ko
                  || (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).name_en
                  || '';
                // 첫 stop 의 transit_from_prev 가 lodging_to_first 와 동일하면
                // 위 LodgingBookend 가 이미 보여 줬으므로 중복 렌더 방지.
                const skipFirstTransit = si === 0 && !!day.lodging_to_first;
                // 2026-05-10 B10-4 phase 1: transit_from_prev 미부착 케이스 (RouteAgent
                // 의 ODsay null + 좌표 lookup 실패 / 농어촌) → TransitFallback 으로 silent
                // skip 회피. si > 0 일 때만 의미 있음 (첫 stop 은 prev 없음).
                const prevStop = si > 0 ? stops[si - 1] : null;
                const prevName = prevStop ? ((prevStop as { display_name?: string; name?: string }).display_name || (prevStop as { display_name?: string; name?: string }).name || '') : '';
                return (
                  <div key={stopIds[si]}>
                    {!skipFirstTransit && stop.transit_from_prev && (
                      <TransitArrow
                        transit={stop.transit_from_prev as TransitFromPrev & Record<string, unknown>}
                        destinationName={destName}
                        endpoints={segmentEndpoints(prevStop, prevName, stop, destName)}
                      />
                    )}
                    {!skipFirstTransit && tiringSegment && tiringSegment.index === si && (
                      <RouteInsightCard segment={tiringSegment} day={day} plan={plan} />
                    )}
                    {!skipFirstTransit && !stop.transit_from_prev && si > 0 && (
                      <TransitFallback
                        prevLat={(prevStop as { lat?: number | null })?.lat}
                        prevLng={(prevStop as { lng?: number | null })?.lng}
                        prevName={prevName}
                        currLat={(stop as { lat?: number | null }).lat}
                        currLng={(stop as { lng?: number | null }).lng}
                        currName={destName}
                      />
                    )}
                    <SortableStopCard
                      stop={stop}
                      stopId={stopIds[si]}
                      editMode={editMode}
                      onDelete={() => setDeleteTarget(si)}
                      lodgingRole={computeLodgingRole(stop, si, stops, !!intercity, intercity)}
                      isOwner={isOwner}
                    />
                  </div>
                );
              })}

            {/* Add Stop button */}
            <button
              type="button"
              data-testid="plan-add-stop"
              onClick={() => onAddStop(dayIndex)}
              className="ec-btn ec-btn-secondary mt-3 w-full min-h-[44px] border-dashed"
            >
              <Plus className="w-3.5 h-3.5" />
              {ed.addStop || 'Add Stop'}
            </button>
          </div>
        </SortableContext>
      ) : (
        <div className="space-y-1">
          {stops.map((stop: PlanStop, si: number) => {
            const destName = (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).display_name
              || (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).name
              || (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).name_ko
              || (stop as { display_name?: string; name?: string; name_ko?: string; name_en?: string }).name_en
              || '';
            const skipFirstTransit = si === 0 && !!day.lodging_to_first;
            const prevStop = si > 0 ? stops[si - 1] : null;
            const prevName = prevStop ? ((prevStop as { display_name?: string; name?: string }).display_name || (prevStop as { display_name?: string; name?: string }).name || '') : '';
            return (
              <div key={si}>
                {!skipFirstTransit && stop.transit_from_prev && (
                  <TransitArrow
                    transit={stop.transit_from_prev as TransitFromPrev & Record<string, unknown>}
                    destinationName={destName}
                    endpoints={segmentEndpoints(prevStop, prevName, stop, destName)}
                  />
                )}
                {!skipFirstTransit && tiringSegment && tiringSegment.index === si && (
                  <RouteInsightCard segment={tiringSegment} day={day} plan={plan} />
                )}
                {!skipFirstTransit && !stop.transit_from_prev && si > 0 && (
                  <TransitFallback
                    prevLat={(prevStop as { lat?: number | null })?.lat}
                    prevLng={(prevStop as { lng?: number | null })?.lng}
                    prevName={prevName}
                    currLat={(stop as { lat?: number | null }).lat}
                    currLng={(stop as { lng?: number | null }).lng}
                    currName={destName}
                  />
                )}
                <StopCard stop={stop} lodgingRole={computeLodgingRole(stop, si, stops, !!intercity, intercity)} isOwner={isOwner} />
              </div>
            );
          })}
        </div>
      )}

      {/* 2026-05-08: 숙소 복귀 카드 — RouteAgent Phase 2.6 가 day.last_to_lodging 에
          ODsay 데이터를 채운 경우만. 마지막 stop 카드 바로 아래.
          P141 (2026-05-22): 마지막 stop 자체가 lodging stop (취침 복귀 호텔) 이면
          day-level BookEnd 는 hotel→hotel redundant → skip. lodging stop card 가
          이미 호텔 표시 + 'return' badge. */}
      {day.last_to_lodging && stops.length > 0 && stops[stops.length - 1]?.category !== 'lodging' && (
        <LodgingBookend
          transit={day.last_to_lodging as TransitFromPrev}
          variant="return"
          lodgingLabel={getLodgingLabelForDay(plan, day)}
          otherLabel={(stops[stops.length - 1] as { display_name?: string; name?: string }).display_name
            || (stops[stops.length - 1] as { display_name?: string; name?: string }).name
            || ''}
        />
      )}

      {/* UIUX P4 (2026-07-13): 하루 하단 총계 3칩 — 도보/교통/교통비. 실측 데이터 있을 때만.
          편집 모드에선 순서 변경 중이라 stale 수치 노출 방지 위해 숨김. */}
      {!editMode && dayTotals.hasAny && (
        <div className="mt-3 flex items-center gap-2">
          {dayTotals.walkMin > 0 && (
            <div className="flex flex-1 items-center justify-center gap-1.5 border-y border-ec-line py-2">
              <Footprints className="h-3.5 w-3.5 text-ec-brand" />
              <span className="text-[12px] font-bold text-ec-ink">{dayTotals.walkMin}<span className="ml-0.5 font-medium text-ec-ink-3">{trDict.minUnit || 'min'}</span></span>
              <span className="text-[10px] text-ec-ink-3">{trDict.dayWalk || 'Walking'}</span>
            </div>
          )}
          {dayTotals.transitMin > 0 && (
            <div className="flex flex-1 items-center justify-center gap-1.5 border-y border-ec-line py-2">
              <TrainFront className="h-3.5 w-3.5 text-ec-brand" />
              <span className="text-[12px] font-bold text-ec-ink">{dayTotals.transitMin}<span className="ml-0.5 font-medium text-ec-ink-3">{trDict.minUnit || 'min'}</span></span>
              <span className="text-[10px] text-ec-ink-3">{trDict.dayTransit || 'Transit'}</span>
            </div>
          )}
          {dayTotals.fareKrw > 0 && (
            <div className="flex flex-1 items-center justify-center gap-1.5 border-y border-ec-line py-2">
              <Wallet className="h-3.5 w-3.5 text-ec-brand" />
              <span className="text-[12px] font-bold text-ec-ink">₩{dayTotals.fareKrw.toLocaleString()}</span>
              <span className="text-[10px] text-ec-ink-3">{trDict.dayFare || 'Fare'}</span>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={ed.deleteConfirm || 'Remove this stop?'}
        onConfirm={() => {
          if (deleteTarget !== null) {
            onDeleteStop(dayIndex, deleteTarget);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

/**
 * B9-39 (2026-05-09): 도시 간 이동 (KTX/SRT/Air/Bus) 카드.
 * 사용자 신고: 다도시 plan 에서 도시 간 이동이 명시 안 돼 사용자가 추측해야 함.
 *
 * Day 의 첫 stop 이전 위치에 별도 카드로 렌더. 사용자 언어에 맞춘 instruction +
 * 출발/도착 시각 + 1인 요금 + 예약 링크 (KTX = letskorail, SRT = srail, Air = trip 등).
 */
function IntercityTransitCard({
  intercity,
  language,
  pd,
}: {
  intercity: IntercityTransitSegment;
  language: string;
  pd: ReturnType<typeof getPlanDetailDict>;
}) {
  const dict = (pd.intercity as Record<string, string> | undefined) || {};
  // 4-lang fallback 체크 — pd.intercity 미정의면 hardcoded 라벨 사용.
  const titleTpl = dict.title
    || (language === 'ko' ? '도시 간 이동 — {{mode}}'
      : language === 'ja' ? '都市間移動 — {{mode}}'
      : language === 'zh' ? '城市间移动 — {{mode}}'
      : 'Intercity Transit — {{mode}}');
  const departLabel = dict.depart
    || (language === 'ko' ? '출발 {{time}}'
      : language === 'ja' ? '出発 {{time}}'
      : language === 'zh' ? '出发 {{time}}'
      : 'Depart {{time}}');
  const arriveLabel = dict.arrive
    || (language === 'ko' ? '도착 {{time}}'
      : language === 'ja' ? '到着 {{time}}'
      : language === 'zh' ? '到达 {{time}}'
      : 'Arrive {{time}}');
  const durationLabel = dict.duration
    || (language === 'ko' ? '약 {{min}}분'
      : language === 'ja' ? '約{{min}}分'
      : language === 'zh' ? '约{{min}}分钟'
      : '~{{min}} min');
  const fareLabel = dict.fare
    || (language === 'ko' ? '₩{{krw}} / 1인'
      : language === 'ja' ? '₩{{krw}} / 1人'
      : language === 'zh' ? '₩{{krw}} / 人'
      : '₩{{krw}} / pax');
  const bookCta = dict.book
    || (language === 'ko' ? '예약하기'
      : language === 'ja' ? '予約'
      : language === 'zh' ? '预订'
      : 'Book');

  // B7 (P308): mode/est_min/est_fare_krw 우선, P291~P308 오명명 plan 은 method/duration_min/cost_krw 폴백.
  const mode = intercity.mode || intercity.method || 'KTX';
  const estMin = intercity.est_min !== null && intercity.est_min !== undefined
    ? intercity.est_min
    : intercity.duration_min;
  const estFareKrw = intercity.est_fare_krw !== null && intercity.est_fare_krw !== undefined
    ? intercity.est_fare_krw
    : intercity.cost_krw;
  const fromCity = intercity.from_city_display || intercity.from_city || '';
  const toCity = intercity.to_city_display || intercity.to_city || '';
  const Icon = /air|flight|plane/i.test(mode) ? Plane : TrainFront;

  const title = titleTpl.replace('{{mode}}', mode);
  const departText = intercity.recommended_depart
    ? departLabel.replace('{{time}}', intercity.recommended_depart)
    : '';
  const arriveText = intercity.arrival_at
    ? arriveLabel.replace('{{time}}', intercity.arrival_at)
    : '';
  const durationText = estMin
    ? durationLabel.replace('{{min}}', String(estMin))
    : '';
  const fareText = estFareKrw
    ? fareLabel.replace('{{krw}}', estFareKrw.toLocaleString())
    : '';

  return (
    <div className="my-3">
      <div className="ec-card px-3 py-3 sm:px-4 sm:py-3.5">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ec-sm bg-ec-brand sm:h-9 sm:w-9">
            <Icon className="h-4 w-4 text-ec-on-brand sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold uppercase tracking-wider text-ec-brand sm:text-[13px]">
              {title}
            </p>
            <p className="mt-0.5 text-[13px] font-bold leading-tight text-ec-ink sm:text-[14px]">
              {fromCity}
              <span className="mx-1.5 text-ec-ink-3">→</span>
              {toCity}
            </p>
            {/* Meta row: 출발 · 도착 · 소요시간 · 요금 */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ec-ink-2 sm:text-[13px]">
              {departText && <span>{departText}</span>}
              {arriveText && <span>{arriveText}</span>}
              {durationText && <span className="text-ec-ink-3">· {durationText}</span>}
              {fareText && <span className="font-semibold text-ec-ink">· {fareText}</span>}
            </div>
            {/* instruction (사용자 언어) — backend 가 채움 */}
            {intercity.instruction && (
              <p className="mt-1.5 text-[13px] leading-snug text-ec-ink-2">
                {intercity.instruction}
              </p>
            )}
            {/* booking_url 있으면 inline CTA */}
            {intercity.booking_url && (
              <a
                href={intercity.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="ec-btn ec-btn-quiet -ml-3 mt-2 text-[13px] text-ec-brand hover:text-ec-brand-hover"
              >
                {bookCta} →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
