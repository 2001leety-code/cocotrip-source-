import { ChevronRight } from 'lucide-react';
import type { I18nString, Tour } from '@/data/tours';
import type { Language } from '@/i18n';
import {
  getTourRouteEditorial,
  TOUR_ROUTE_LABELS,
} from '@/pages/tourRouteEditorial';

function txt(field: I18nString, language: Language): string {
  return field[language] || field.en;
}

function durationText(tour: Tour, language: Language): string {
  if (tour.durationHours) {
    if (language === 'ko') return `${tour.durationHours}시간`;
    if (language === 'ja') return `${tour.durationHours}時間`;
    if (language === 'zh') return `${tour.durationHours}小时`;
    return `${tour.durationHours} ${tour.durationHours === 1 ? 'hour' : 'hours'}`;
  }

  if (language === 'ko') return `${tour.durationDays}일`;
  if (language === 'ja') return `${tour.durationDays}日`;
  if (language === 'zh') return `${tour.durationDays}天`;
  return `${tour.durationDays} ${tour.durationDays === 1 ? 'day' : 'days'}`;
}

function stopCountText(count: number, language: Language): string {
  if (language === 'ko') return `${count}곳`;
  if (language === 'ja') return `${count}か所`;
  if (language === 'zh') return `${count}站`;
  return `${count} ${count === 1 ? 'stop' : 'stops'}`;
}

export function TourRouteSummary({ tour, language }: { tour: Tour; language: Language }) {
  const editorial = getTourRouteEditorial(tour.id);
  const stops = tour.stops || [];
  if (!editorial || stops.length === 0) return null;

  const headingId = `tour-route-summary-${tour.id}`;
  const firstTime = stops[0].time;
  const lastTime = stops[stops.length - 1].time;
  const localSchedule = firstTime === lastTime ? firstTime : `${firstTime}–${lastTime}`;

  return (
    <section
      className="mb-5 rounded-ec-md border border-ec-line bg-ec-sunken p-4 sm:p-5"
      aria-labelledby={headingId}
      data-testid="tour-route-summary"
      data-tour-id={tour.id}
    >
      <p className="ec-eyebrow">{txt(TOUR_ROUTE_LABELS.eyebrow, language)}</p>
      <h3 id={headingId} className="mt-2 text-lg font-bold leading-snug text-ec-ink">
        {txt(TOUR_ROUTE_LABELS.title, language)}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ec-ink-2">
        {txt(editorial.context, language)}
      </p>

      <dl className="mt-4 grid grid-cols-3 border-y border-ec-line">
        <div className="min-w-0 border-r border-ec-line px-2 py-3 first:pl-0 sm:px-3">
          <dt className="text-[11px] leading-tight text-ec-ink-3">{txt(TOUR_ROUTE_LABELS.duration, language)}</dt>
          <dd className="mt-1 text-sm font-bold text-ec-ink">{durationText(tour, language)}</dd>
        </div>
        <div className="min-w-0 border-r border-ec-line px-2 py-3 sm:px-3">
          <dt className="text-[11px] leading-tight text-ec-ink-3">{txt(TOUR_ROUTE_LABELS.stops, language)}</dt>
          <dd className="mt-1 text-sm font-bold text-ec-ink">{stopCountText(stops.length, language)}</dd>
        </div>
        <div className="min-w-0 px-2 py-3 last:pr-0 sm:px-3">
          <dt className="text-[11px] leading-tight text-ec-ink-3">{txt(TOUR_ROUTE_LABELS.localSchedule, language)}</dt>
          <dd className="mt-1 text-sm font-bold tabular-nums text-ec-ink">{localSchedule}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-xs font-bold text-ec-ink-3">{txt(TOUR_ROUTE_LABELS.stopOrder, language)}</p>
        <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label={txt(TOUR_ROUTE_LABELS.stopOrder, language)}>
          {stops.map((stop, index) => (
            <li key={`${stop.time}-${stop.name.ko}`} className="flex min-w-0 items-center gap-1 text-sm text-ec-ink-2">
              <span>{txt(stop.name, language)}</span>
              {index < stops.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ec-ink-3" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>

      <nav className="mt-4 border-t border-ec-line pt-1" aria-label={txt(TOUR_ROUTE_LABELS.related, language)}>
        <p className="py-2 text-xs font-bold text-ec-ink-3">{txt(TOUR_ROUTE_LABELS.related, language)}</p>
        {editorial.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="group flex min-h-[44px] items-center justify-between gap-3 border-t border-ec-line py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ec-brand focus-visible:ring-offset-2"
          >
            <span className="min-w-0">
              <strong className="block text-sm text-ec-ink group-hover:text-ec-brand">{txt(link.label, language)}</strong>
              <span className="mt-0.5 block text-xs leading-relaxed text-ec-ink-3">{txt(link.description, language)}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
          </a>
        ))}
      </nav>
    </section>
  );
}
