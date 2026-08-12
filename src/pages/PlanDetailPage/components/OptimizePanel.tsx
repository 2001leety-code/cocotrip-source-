// UIUX 가이드 P4 'Edit & Optimize' — 편집 모드 전용 최적화 제안 패널 (2026-07-13).
// Time(방문 순서 재배열, 실좌표 haversine — 적용 시 기존 reorder→recalc 파이프라인이
// 실측 transit 으로 재계산) / Transport(하루 환승 합계) / Walking(하루 도보 합계).
// 전부 plan 실데이터 파생 — optimizeSuggestions.ts 순수 모듈 참조.
import { useState } from 'react';
import { Wand2, Footprints, TrainFront, Check } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';
import type { PlanDay, PlanDocument, PlanStop } from '../types';
import { buildOptimizeSuggestions, type TimeSuggestion } from '../lib/optimizeSuggestions';
import { buildCharterCTAUrl } from '../lib/charterCtaPrefill';
import { trackEvent } from '@/lib/analytics';

interface OptimizePanelProps {
  day: PlanDay;
  dayIndex: number;
  plan?: PlanDocument;
  onApplyOrder: (dayIdx: number, order: number[]) => void | Promise<void>;
}

export function OptimizePanel({ day, dayIndex, plan, onApplyOrder }: OptimizePanelProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const op = ((pd as Record<string, unknown>).optimize || {}) as Record<string, string>;
  const [applied, setApplied] = useState(false);

  const stops = (day.stops || []) as PlanStop[];
  const suggestions = buildOptimizeSuggestions(stops);
  if (suggestions.length === 0) return null;

  const fmt = (template: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template);

  const { url: charterHref } = buildCharterCTAUrl({
    day,
    planInput: plan?.input as { area?: string; adults?: number; pax?: number } | undefined,
  });

  const handleApply = async (s: TimeSuggestion) => {
    setApplied(true);
    trackEvent('plan_optimize_apply', { day: day.day, saving_pct: s.savingPct });
    try {
      await onApplyOrder(dayIndex, s.proposedOrder);
    } catch {
      // 저장 실패(오프라인·권한·일시장애) = usePlanEditor 가 원래 순서로 롤백함.
      // 버튼도 원복해 재시도 가능하게(잘못된 체크마크·영구 비활성 방지, 리뷰 fix).
      setApplied(false);
    }
  };

  return (
    <section className="mb-3 rounded-ec-md border border-ec-line bg-ec-brand-wash p-3.5">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ec-ink">
        <Wand2 className="h-4 w-4 text-ec-brand" aria-hidden />
        {op.panelTitle || 'Optimize suggestions'}
      </p>
      <div className="mt-2 space-y-2">
        {suggestions.map((s) => {
          if (s.type === 'time') {
            return (
              <div key="time" className="rounded-ec-sm border border-ec-line bg-ec-raised p-3">
                <p className="text-[13px] font-semibold text-ec-ink">{op.timeTitle || 'Shorter route order available'}</p>
                <p className="mt-1 text-[12px] text-ec-ink-2">
                  {fmt(op.timeDetail || '{cur} km → {new} km (−{pct}%)', { cur: s.currentKm, new: s.proposedKm, pct: s.savingPct })}
                </p>
                <button
                  onClick={() => handleApply(s)}
                  disabled={applied}
                  className="ec-btn ec-btn-primary mt-2 min-h-[44px] px-3 text-[12px] disabled:opacity-50"
                >
                  {applied ? <Check className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {op.timeApply || 'Apply new order'}
                </button>
              </div>
            );
          }
          if (s.type === 'transport') {
            return (
              <a
                key="transport"
                href={charterHref}
                onClick={() => trackEvent('plan_optimize_charter_click', { day: day.day, transfers: s.totalTransfers })}
                className="block min-h-[44px] rounded-ec-sm border border-ec-line bg-ec-raised p-3 transition-colors hover:border-ec-line-3"
              >
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ec-ink">
                  <TrainFront className="h-3.5 w-3.5 text-ec-brand" aria-hidden />
                  {fmt(op.transportTitle || '{n} transfers today', { n: s.totalTransfers })}
                </p>
                <p className="mt-1 text-[12px] text-ec-ink-2">
                  {op.transportDetail || 'A private charter covers this day door-to-door'} {'→'}
                </p>
              </a>
            );
          }
          return (
            <div key="walking" className="rounded-ec-sm border border-ec-line bg-ec-raised p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ec-ink">
                <Footprints className="h-3.5 w-3.5 text-ec-brand" aria-hidden />
                {fmt(op.walkingTitle || '~{min} min of walking today', { min: s.totalWalkMin })}
              </p>
              <p className="mt-1 text-[12px] text-ec-ink-2">
                {op.walkingDetail || 'Consider reordering stops or a charter for heavy-walk days'}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
