// UIUX 가이드 P5 'AI Route Insight' — 힘든 대중교통 구간 바로 아래 노출되는 차터 제안 카드.
// day 단위 CharterCTA 와 구분: 이 카드는 특정 구간(환승 2+/도보 900m+/60분+)에 정밀 부착.
// 프리필 URL 은 기존 buildCharterCTAUrl 재사용 (REALROUTE 플래그 OFF = 기존 하드코딩 URL 그대로).
import { TriangleAlert, Car } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';
import type { PlanDay, PlanDocument } from '../types';
import { buildCharterCTAUrl } from '../lib/charterCtaPrefill';
import type { TiringSegment } from '../lib/routeInsight';
import { trackEvent } from '@/lib/analytics';

interface RouteInsightCardProps {
  segment: TiringSegment;
  day: PlanDay;
  plan?: PlanDocument;
}

export function RouteInsightCard({ segment, day, plan }: RouteInsightCardProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ch = (pd.charter || {}) as Record<string, string>;

  const reasonParts: string[] = [];
  if (segment.reasons.includes('transfers')) {
    reasonParts.push((ch.insightTransfers || '{n} transfers').replace('{n}', String(segment.transfers)));
  }
  if (segment.reasons.includes('walk')) {
    reasonParts.push((ch.insightWalk || '~{min} min walking').replace('{min}', String(segment.walkMin)));
  }
  if (segment.reasons.includes('duration')) {
    reasonParts.push((ch.insightDuration || '{min} min by transit').replace('{min}', String(segment.estMin)));
  }

  const { url: charterHref } = buildCharterCTAUrl({
    day,
    planInput: plan?.input as { area?: string; adults?: number; pax?: number } | undefined,
  });

  return (
    <aside className="my-2 ml-0 border-l-2 border-ec-notice bg-ec-sunken p-3 sm:ml-10">
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ec-notice" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-tight text-ec-ink">
            {ch.insightTitle || 'This segment is tiring by public transit'}
          </p>
          <p className="mt-1 text-[12px] text-ec-ink-2">{reasonParts.join(' · ')}</p>
        </div>
      </div>
      <a
        href={charterHref}
        onClick={() => trackEvent('charter_upsell_insight_click', { day: day.day, transfers: segment.transfers, walk_min: segment.walkMin, est_min: segment.estMin })}
        className="ec-btn ec-btn-secondary mt-2.5 min-h-[44px] w-full text-[13px] text-ec-brand"
      >
        <Car className="h-3.5 w-3.5" />
        {ch.insightCta || 'Skip it with a private charter'} {'→'}
      </a>
    </aside>
  );
}
