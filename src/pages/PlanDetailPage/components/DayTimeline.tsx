// Day-level timeline: theme badge + ordered stops with transit arrows between them.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L830-852) during P2 Lock release.
// B8: Added SortableContext for drag-reorder, conditional edit UI, and + Add Stop button.
import { useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence, motion } from 'framer-motion';

// Day stops 등장 stagger — 각 stop이 0.05s씩 늦춰서 폭포처럼 등장.
// prefers-reduced-motion 가드는 CSS @media에서 자동으로 duration 0.01ms로 줄임.
const stopVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
  }),
};
import { Plus, Calendar, Clock, MapPin, TrainFront, Plane } from 'lucide-react';
import { TransitArrow } from './TransitArrow';
import { TransitFallback } from './TransitFallback';
import { SortableStopCard } from './SortableStopCard';
import { StopCard } from './StopCard';
import { ConfirmDialog } from './ConfirmDialog';
import { CharterCTA } from './CharterCTA';
import { LodgingBookend } from './LodgingBookend';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDay, PlanStop, PlanDocument, IntercityTransitSegment } from '../types';
import { getPlanDetailDict } from '../types';
import type { TransitFromPrev } from '@/types/plan';

interface DayTimelineProps {
  day: PlanDay;
  dayIndex: number;
  editMode: boolean;
  isRecalculating?: boolean;
  onDeleteStop: (dayIdx: number, stopIdx: number) => void;
  onAddStop: (dayIdx: number) => void;
  /** 2026-05-08: 숙소 라벨 source — input.hotel_address 또는 zone 키. */
  plan?: PlanDocument;
}

/** Pull the user-friendly lodging label from PlanDocument input.
 *  Priority: input.hotel_address (literal) > input.recommended_zone_address >
 *  input.recommended_zone (zone key) > input.recommendedZone (camelCase legacy) >
 *  undefined. legacy plans 은 recommended_zone 자체가 없을 수 있어 모든 fallback 검사. */
function getLodgingLabel(plan: PlanDocument | undefined): string | undefined {
  if (!plan) return undefined;
  const input = (plan.input || {}) as Record<string, unknown>;
  const hotelAddr = (input.hotel_address as string) || '';
  if (typeof hotelAddr === 'string' && hotelAddr.trim().length > 0) return hotelAddr;
  const zoneAddr = (input.recommended_zone_address as string) || '';
  if (typeof zoneAddr === 'string' && zoneAddr.trim().length > 0) return zoneAddr;
  const zone = (input.recommended_zone as string)
    || (input.recommendedZone as string)
    || '';
  if (typeof zone === 'string' && zone.trim().length > 0) return zone;
  return undefined;
}

export function DayTimeline({ day, dayIndex, editMode, isRecalculating, onDeleteStop, onAddStop, plan }: DayTimelineProps) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ed = pd.editor || {};

  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const stops = day.stops || [];
  const stopIds = stops.map((_: PlanStop, i: number) => `day-${dayIndex}-stop-${i}`);

  // Sprint 1 Step 2: 풍부한 day 헤더 메타 (사용자 신고 "UI 개선 심각")
  // 첫/마지막 stop 시간 → 일정 범위 표시
  const firstTime = stops[0]?.start_time;
  const lastTime = stops[stops.length - 1]?.start_time;
  const timeRange = firstTime && lastTime ? `${firstTime} – ${lastTime}` : firstTime || lastTime || '';
  // 'placesUnit' (곳/places) 사용 — pd.transit.stops 는 지하철 정거장 의미라 부적절
  const stopCountLabel = (pd as { placesUnit?: string }).placesUnit || 'places';

  // B9-39 (2026-05-09): 다도시 plan 의 도시 라벨 + 도시 간 이동 카드 데이터.
  // city 가 있으면 Day 헤더에 chip 으로 표시; legacy plan = undefined → 미노출.
  const cityLabel = day.city
    || ((plan?.input?.regions as string[] | undefined)?.[0])
    || undefined;
  const intercity: IntercityTransitSegment | null | undefined = day.intercity_transit;

  return (
    <section className="mb-6 sm:mb-8">
      {/* Sprint 1 Step 2: Day 헤더 — 풍부한 gradient 카드. 일자/테마/시간/stops 한눈에. */}
      <div
        className="relative overflow-hidden rounded-2xl mb-4 sm:mb-5 px-4 py-3.5 sm:px-5 sm:py-4 border border-white/[0.08]"
        style={{
          background: 'linear-gradient(135deg, rgba(124,92,252,0.18) 0%, rgba(234,83,126,0.12) 60%, rgba(10,4,18,0.85) 100%)',
        }}
      >
        {/* 우상단 데코 — 큰 일자 번호 (배경에 묽게) */}
        <span aria-hidden className="absolute -top-1 -right-2 text-[80px] sm:text-[100px] font-black text-white/[0.04] leading-none select-none">
          {day.day || dayIndex + 1}
        </span>

        <div className="relative">
          {/* DAY 라벨 + 일자 번호 */}
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[10px] font-extrabold tracking-[0.18em] uppercase bg-gradient-to-r from-[#B668FC] to-[#FF6B9D] bg-clip-text text-transparent">
              {pd.dayLabel || 'Day'}
            </span>
            <span className="text-[18px] sm:text-[20px] font-black text-white leading-none">
              {day.day || dayIndex + 1}
            </span>
          </div>

          {/* Theme — 큰 글씨 강조 */}
          <h3 className="text-[15px] sm:text-base font-bold text-white leading-snug mb-2">
            {day.theme || `Day ${day.day || dayIndex + 1}`}
          </h3>

          {/* Meta chips: 일자 / 시간 / stops 수 / city (다도시 plan) */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] sm:text-[11px]">
            {day.date && (
              <span className="inline-flex items-center gap-1 bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-0.5 text-white/65">
                <Calendar className="w-2.5 h-2.5" /> {day.date}
              </span>
            )}
            {timeRange && (
              <span className="inline-flex items-center gap-1 bg-white/[0.06] border border-white/[0.08] rounded-md px-2 py-0.5 text-white/65">
                <Clock className="w-2.5 h-2.5" /> {timeRange}
              </span>
            )}
            {stops.length > 0 && (
              <span className="inline-flex items-center gap-1 bg-[#7C5CFC]/[0.12] border border-[#7C5CFC]/25 rounded-md px-2 py-0.5 text-[#B9A4FF] font-semibold">
                <MapPin className="w-2.5 h-2.5" /> {stops.length} {stopCountLabel}
              </span>
            )}
            {cityLabel && (
              /* B9-39: 다도시 plan 의 도시 라벨. 단일 도시 plan 도 보여 OK
                 (regions[0] fallback 으로 채워짐). 시각적 강조 위해 별도 색상. */
              <span className="inline-flex items-center gap-1 bg-[#EA537E]/[0.14] border border-[#EA537E]/30 rounded-md px-2 py-0.5 text-[#FFB1C8] font-semibold">
                <MapPin className="w-2.5 h-2.5" /> {cityLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* B9-39 (2026-05-09): 다도시 plan 의 도시 간 이동 카드 (KTX/항공/버스).
          intercity_transit 가 있을 때만 노출 — 단일 도시 plan = 미노출.
          PDF-issue-2 (2026-05-14): 전후 bookend segment 표시 — 사용자 PDF "부산호텔→
          부산역" + "서울역→명동호텔" transit 누락 회귀 fix. RouteAgent 가 intercity_transit
          .lodging_to_station + station_to_lodging 채우면 LodgingBookend 로 표시. */}
      {intercity && intercity.mode && (
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

      {/* Charter CTA -- shown when transit is complex */}
      <CharterCTA day={day} />

      {/* Transit recalculating indicator */}
      {isRecalculating && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 rounded-xl">
          <div className="w-3 h-3 border border-[#7C5CFC] border-t-transparent rounded-full animate-spin" />
          <span className="text-[11px] text-[#7C5CFC]/80">{ed.routeRecalculating || 'Updating routes...'}</span>
        </div>
      )}

      {/* 2026-05-08: 숙소 출발 카드 — RouteAgent 가 day.lodging_to_first 에 ODsay
          데이터를 채운 경우에만 노출. 첫 stop 의 transit_from_prev 와 동일 데이터를
          쓸 수도 있지만, day-level 에 별도로 두면 호텔 라벨 + 시각 강조 가능. */}
      {day.lodging_to_first && stops.length > 0 && (
        <LodgingBookend
          transit={day.lodging_to_first as TransitFromPrev}
          variant="depart"
          lodgingLabel={getLodgingLabel(plan)}
          otherLabel={(stops[0] as { display_name?: string; name?: string }).display_name
            || (stops[0] as { display_name?: string; name?: string }).name
            || ''}
        />
      )}

      {editMode ? (
        <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 pl-8">
            <AnimatePresence mode="popLayout">
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
                    {!skipFirstTransit && stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev as TransitFromPrev & Record<string, unknown>} destinationName={destName} />}
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
                    />
                  </div>
                );
              })}
            </AnimatePresence>

            {/* Add Stop button */}
            <button
              onClick={() => onAddStop(dayIndex)}
              className="w-full mt-3 py-2.5 rounded-xl border border-dashed border-white/10 text-white/55 text-xs font-medium flex items-center justify-center gap-1.5 hover:border-[#7C5CFC]/30 hover:text-[#7C5CFC]/60 transition-colors"
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
              <motion.div
                key={si}
                custom={si}
                variants={stopVariants}
                initial="hidden"
                animate="visible"
              >
                {!skipFirstTransit && stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev as TransitFromPrev & Record<string, unknown>} destinationName={destName} />}
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
                <StopCard stop={stop} />
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 2026-05-08: 숙소 복귀 카드 — RouteAgent Phase 2.6 가 day.last_to_lodging 에
          ODsay 데이터를 채운 경우만. 마지막 stop 카드 바로 아래. */}
      {day.last_to_lodging && stops.length > 0 && (
        <LodgingBookend
          transit={day.last_to_lodging as TransitFromPrev}
          variant="return"
          lodgingLabel={getLodgingLabel(plan)}
          otherLabel={(stops[stops.length - 1] as { display_name?: string; name?: string }).display_name
            || (stops[stops.length - 1] as { display_name?: string; name?: string }).name
            || ''}
        />
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

  const mode = intercity.mode || 'KTX';
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
  const durationText = intercity.est_min
    ? durationLabel.replace('{{min}}', String(intercity.est_min))
    : '';
  const fareText = intercity.est_fare_krw
    ? fareLabel.replace('{{krw}}', intercity.est_fare_krw.toLocaleString())
    : '';

  return (
    <div className="my-3">
      <div
        className="rounded-xl border px-3 py-3 sm:px-4 sm:py-3.5"
        style={{
          background: 'linear-gradient(135deg, rgba(124,92,252,0.16) 0%, rgba(96,150,255,0.10) 60%, rgba(10,4,18,0.55) 100%)',
          borderColor: 'rgba(124,92,252,0.32)',
        }}
      >
        <div className="flex items-start gap-2.5">
          <div
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#7C5CFC,#6096FF)' }}
          >
            <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] sm:text-[11px] font-bold uppercase tracking-wider text-[#B9A4FF]">
              {title}
            </p>
            <p className="text-[13px] sm:text-[14px] font-bold text-white leading-tight mt-0.5">
              {fromCity}
              <span className="mx-1.5 text-white/55">→</span>
              {toCity}
            </p>
            {/* Meta row: 출발 · 도착 · 소요시간 · 요금 */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] sm:text-[11px] text-white/70">
              {departText && <span>{departText}</span>}
              {arriveText && <span>{arriveText}</span>}
              {durationText && <span className="text-white/55">· {durationText}</span>}
              {fareText && <span className="font-semibold text-white/85">· {fareText}</span>}
            </div>
            {/* instruction (사용자 언어) — backend 가 채움 */}
            {intercity.instruction && (
              <p className="mt-1.5 text-[11px] sm:text-[11.5px] text-white/70 leading-snug">
                {intercity.instruction}
              </p>
            )}
            {/* booking_url 있으면 inline CTA */}
            {intercity.booking_url && (
              <a
                href={intercity.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-[10.5px] sm:text-[11px] font-semibold text-[#B9A4FF] hover:text-white transition-colors"
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
