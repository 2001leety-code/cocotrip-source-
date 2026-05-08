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
import { Plus, Calendar, Clock, MapPin } from 'lucide-react';
import { TransitArrow } from './TransitArrow';
import { SortableStopCard } from './SortableStopCard';
import { StopCard } from './StopCard';
import { ConfirmDialog } from './ConfirmDialog';
import { CharterCTA } from './CharterCTA';
import { LodgingBookend } from './LodgingBookend';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDay, PlanStop, PlanDocument } from '../types';
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
 *  Priority: input.hotel_address (literal) > input.recommended_zone (zone key
 *  passed through, UI 가 그냥 표시) > undefined. */
function getLodgingLabel(plan: PlanDocument | undefined): string | undefined {
  if (!plan) return undefined;
  const input = plan.input || {};
  const hotelAddr = (input.hotel_address as string) || '';
  if (hotelAddr.trim().length > 0) return hotelAddr;
  const zone = (input.recommended_zone as string) || '';
  if (zone) return zone;
  return undefined;
}

export function DayTimeline({ day, dayIndex, editMode, isRecalculating, onDeleteStop, onAddStop, plan }: DayTimelineProps) {
  const { t } = useLanguage();
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

          {/* Meta chips: 일자 / 시간 / stops 수 */}
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
          </div>
        </div>
      </div>

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
                return (
                  <div key={stopIds[si]}>
                    {!skipFirstTransit && stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev as TransitFromPrev & Record<string, unknown>} destinationName={destName} />}
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
            return (
              <motion.div
                key={si}
                custom={si}
                variants={stopVariants}
                initial="hidden"
                animate="visible"
              >
                {!skipFirstTransit && stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev as TransitFromPrev & Record<string, unknown>} destinationName={destName} />}
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
