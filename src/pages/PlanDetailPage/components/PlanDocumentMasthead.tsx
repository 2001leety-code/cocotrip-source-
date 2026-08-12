import { CalendarDays, CalendarRange, MapPin, Route, Users } from 'lucide-react';
import type { PlanDocument, PlanDay } from '../types';

export type PlanDocumentStatus = 'ready' | 'partial' | 'building';

interface PlanDocumentMastheadProps {
  plan: PlanDocument;
  status: PlanDocumentStatus;
  ui: Record<string, string>;
  regionNames?: Record<string, string>;
}

function cleanRegion(value: unknown): string {
  return String(value || '').replace(/_city$|_suburb$/i, '').replace(/_/g, ' ').trim();
}

function primaryRegion(plan: PlanDocument, regionNames: Record<string, string>): string {
  const input = plan.input || {};
  const regions = Array.isArray(input.regions) ? input.regions.filter(Boolean) as string[] : [];
  const raw = regions[0] || input.destination || '';
  const key = cleanRegion(raw).toLowerCase();
  const mapped = regionNames[key] || regionNames[String(raw || '')];
  if (mapped) return mapped;

  const area = cleanRegion(input.area);
  const mappedArea = regionNames[area.toLowerCase()] || regionNames[String(input.area || '')];
  return mappedArea || area || cleanRegion(raw);
}

function visibleStops(days: PlanDay[]): number {
  return days.reduce(
    (total, day) => total + (day.stops || []).filter(
      (stop) => String(stop.category || '').toLowerCase() !== 'lodging',
    ).length,
    0,
  );
}

export function PlanDocumentMasthead({ plan, status, ui, regionNames = {} }: PlanDocumentMastheadProps) {
  const input = plan.input || {};
  const days = (plan.itinerary?.days || []).filter((day): day is PlanDay => Boolean(day));
  const region = primaryRegion(plan, regionNames);
  const adults = Number(input.adults);
  const pax = Number(input.pax);
  const children = Number(input.children || 0);
  const hasAdults = Number.isFinite(adults) && adults > 0;
  const hasPax = Number.isFinite(pax) && pax > 0;
  const travelers = hasAdults
    ? adults + (Number.isFinite(children) && children > 0 ? children : 0)
    : hasPax ? pax : 0;
  const title = plan.itinerary?.tour_title || ui.pdfDefaultTitle || '';
  const statusLabel = status === 'building'
    ? ui.documentBuilding
    : status === 'partial'
      ? ui.documentPartial
      : ui.documentReady;
  const stats = [
    { icon: CalendarDays, label: ui.planStatDays, value: days.length || '—' },
    { icon: MapPin, label: ui.planStatStops, value: visibleStops(days) },
    { icon: Users, label: ui.planStatTravelers, value: travelers || '—' },
    { icon: CalendarRange, label: ui.documentStartDate, value: input.startDate || '—' },
  ];

  return (
    <header data-testid="plan-document-masthead" className="border-b border-ec-line bg-ec-raised">
      <div className="ec-container-wide py-9 md:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <p className="ec-eyebrow text-ec-brand">{ui.documentEyebrow}</p>
              <span className="ec-chip" data-testid={`plan-document-status-${status}`}>{statusLabel}</span>
            </div>
            <h1 className="ec-h2 mt-4 max-w-[24ch] text-[clamp(30px,4.4vw,52px)]">{title}</h1>
            {(region || input.startDate) && (
              <p className="ec-body-sm mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                {region && <span>{region}</span>}
                {region && input.startDate && <span aria-hidden>·</span>}
                {input.startDate && <span className="ec-figure">{String(input.startDate)}</span>}
              </p>
            )}
            <p className="ec-body ec-measure mt-5">{ui.documentIntro}</p>
          </div>

          <dl className="grid grid-cols-2 border-y border-ec-line sm:grid-cols-4 lg:grid-cols-2">
            {stats.map(({ icon: Icon, label, value }) => (
              <div key={label} className="min-w-0 border-ec-line px-3 py-4 odd:border-r sm:border-r sm:last:border-r-0 lg:[&:nth-child(2)]:border-r-0 lg:[&:nth-child(-n+2)]:border-b">
                <dt className="ec-eyebrow flex items-center gap-2">
                  <Icon className="h-4 w-4 text-ec-brand" aria-hidden />
                  {label}
                </dt>
                <dd className="ec-figure mt-2 truncate text-[18px]">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="ec-body-sm mt-7 flex max-w-[76ch] items-start gap-2 border-l-2 border-ec-line-2 pl-4">
          <Route className="mt-0.5 h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
          <span>{ui.documentRouteNote}</span>
        </p>
      </div>
    </header>
  );
}
