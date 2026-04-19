// Day-level timeline: theme badge + ordered stops with transit arrows between them.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L830-852) during P2 Lock release.
// B8: Added SortableContext for drag-reorder, conditional edit UI, and + Add Stop button.
import { useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import { TransitArrow } from './TransitArrow';
import { SortableStopCard } from './SortableStopCard';
import { StopCard } from './StopCard';
import { ConfirmDialog } from './ConfirmDialog';
import { useLanguage } from '@/hooks/useLanguage';

interface DayTimelineProps {
  day: any;
  dayIndex: number;
  editMode: boolean;
  onDeleteStop: (dayIdx: number, stopIdx: number) => void;
  onAddStop: (dayIdx: number) => void;
}

export function DayTimeline({ day, dayIndex, editMode, onDeleteStop, onAddStop }: DayTimelineProps) {
  const { t } = useLanguage();
  const pd = (t as any).planDetail || {};
  const ed = pd.editor || {};

  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const stops = day.stops || [];
  const stopIds = stops.map((_: any, i: number) => `day-${dayIndex}-stop-${i}`);

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
          {day.day || dayIndex + 1}
        </span>
        <div>
          <p className="text-sm font-bold">{day.theme || `Day ${day.day || dayIndex + 1}`}</p>
          {day.date && <p className="text-[10px] text-white/30">{day.date}</p>}
        </div>
      </div>

      {editMode ? (
        <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 pl-8">
            <AnimatePresence mode="popLayout">
              {stops.map((stop: any, si: number) => (
                <div key={stopIds[si]}>
                  {stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev} />}
                  <SortableStopCard
                    stop={stop}
                    stopId={stopIds[si]}
                    editMode={editMode}
                    onDelete={() => setDeleteTarget(si)}
                  />
                </div>
              ))}
            </AnimatePresence>

            {/* Add Stop button */}
            <button
              onClick={() => onAddStop(dayIndex)}
              className="w-full mt-3 py-2.5 rounded-xl border border-dashed border-white/10 text-white/30 text-xs font-medium flex items-center justify-center gap-1.5 hover:border-[#7C5CFC]/30 hover:text-[#7C5CFC]/60 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {ed.addStop || 'Add Stop'}
            </button>
          </div>
        </SortableContext>
      ) : (
        <div className="space-y-1">
          {stops.map((stop: any, si: number) => (
            <div key={si}>
              {stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev} />}
              <StopCard stop={stop} />
            </div>
          ))}
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
