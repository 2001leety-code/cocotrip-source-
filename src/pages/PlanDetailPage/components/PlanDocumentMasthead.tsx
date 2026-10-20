import { useSyncExternalStore } from 'react';
import { CalendarDays, CalendarRange, MapPin, Route, Users } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { SkyLayer } from '@/sections/home/SkyLayer';
import { pickHomeCopy, type HomeLang } from '@/sections/home/homeCopy';
import type { PlanDocument, PlanDay } from '../types';
import { countVisibleStops } from '../lib/planStats';
import type { PlanDocumentStatus } from '../lib/planStats';

interface PlanDocumentMastheadProps {
  plan: PlanDocument;
  status: PlanDocumentStatus;
  ui: Record<string, string>;
  regionNames?: Record<string, string>;
}

function cleanRegion(value: unknown): string {
  return String(value || '').replace(/_city$|_suburb$/i, '').replace(/_/g, ' ').trim();
}

const DATE_LOCALES: Record<string, string> = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' };

// Home's sky video on phones only. SkyLayer decides reduced motion / Save-Data once
// on mount; this subscription unmounts it when reduced motion turns on later, so
// the video element (and its playback) is actually removed. Server/unknown = reduced.
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true,
  );
}

// YYYY-MM-DD 를 로컬 달력 날짜로 해석 — new Date('YYYY-MM-DD') 의 UTC 해석으로 하루 밀리는 문제 방지.
function formatPlanStartDate(value: unknown, language: string): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return raw;
  try {
    return new Intl.DateTimeFormat(DATE_LOCALES[language] || 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }).format(date);
  } catch {
    return raw;
  }
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

export function PlanDocumentMasthead({ plan, status, ui, regionNames = {} }: PlanDocumentMastheadProps) {
  const { language } = useLanguage();
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const skyCopy = pickHomeCopy((['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as HomeLang).hero.sky;
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
    { icon: MapPin, label: ui.planStatStops, value: countVisibleStops(days) },
    { icon: Users, label: ui.planStatTravelers, value: travelers || '—' },
    { icon: CalendarRange, label: ui.documentStartDate, value: formatPlanStartDate(input.startDate, language) || '—' },
  ];

  return (
    <header data-testid="plan-document-masthead" className="plan-night-masthead border-b border-ec-line bg-ec-raised">
      {isMobile && !reducedMotion && <SkyLayer playLabel={skyCopy.play} pauseLabel={skyCopy.pause} />}
      <div className="ec-container-wide py-9 md:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <p className="ec-eyebrow text-ec-brand">{ui.documentEyebrow}</p>
              <span className="plan-night-status ec-chip" data-testid={`plan-document-status-${status}`}>{statusLabel}</span>
            </div>
            <h1 className="plan-night-title ec-h2 mt-4 max-w-[24ch] text-[clamp(30px,4.4vw,52px)]">{title}</h1>
            {region && (
              <p className="ec-body-sm mt-4" data-testid="plan-document-region">{region}</p>
            )}
            <p className="plan-night-intro ec-body ec-measure mt-5">{ui.documentIntro}</p>
          </div>

          <dl className="plan-night-facts grid grid-cols-2 border-y border-ec-line sm:grid-cols-4 lg:grid-cols-2">
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

        <p className="plan-night-route-note ec-body-sm mt-7 flex max-w-[76ch] items-start gap-2 border-l-2 border-ec-line-2 pl-4">
          <Route className="mt-0.5 h-4 w-4 shrink-0 text-ec-brand" aria-hidden />
          <span>{ui.documentRouteNote}</span>
        </p>
      </div>
    </header>
  );
}
