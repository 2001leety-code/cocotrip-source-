// Day-level timeline: theme badge + ordered stops with transit arrows between them.
// Extracted verbatim from src/pages/PlanDetailPage.tsx (L830-852) during P2 Lock release.
import { TransitArrow } from './TransitArrow';
import { StopCard } from './StopCard';

export function DayTimeline({ day, dayIndex }: { day: any; dayIndex: number }) {
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
      <div className="space-y-1">
        {(day.stops || []).map((stop: any, si: number) => (
          <div key={si}>
            {stop.transit_from_prev && <TransitArrow transit={stop.transit_from_prev} />}
            <StopCard stop={stop} />
          </div>
        ))}
      </div>
    </section>
  );
}
