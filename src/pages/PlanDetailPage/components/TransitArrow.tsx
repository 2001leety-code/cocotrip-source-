// Transit segment between two stops. Rich rendering of ODsay subway/bus data:
// line, exit numbers, headway, pass-through stations. Falls back to simple
// text step_by_step when steps_detail is unavailable (legacy plans).
import { useState } from 'react';
import { Car, ChevronDown, Bus, Train, AlertTriangle, Footprints, Clock, LogOut, LogIn, Repeat, Accessibility, Phone, Sunrise, Moon } from 'lucide-react';
import { TRANSIT_ICON, formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import type { TransitFromPrev, TransitStepDetail } from '@/types/plan';
import { getPlanDetailDict } from '../types';

// ja/zh: prefer Hanja translation populated by /api/translate-plan ("강남 (江南)"),
// fall back to romanization ("강남 (Gangnam)") for legacy/cache-miss cases.
function stationDisplay(
  koName: string | undefined,
  translated: string | null | undefined,
  roman: string | null | undefined,
  lang: string,
): string {
  if (!koName) return '';
  if (lang === 'ko') return koName;
  const paren = translated || roman;
  return paren ? `${koName} (${paren})` : koName;
}

function SubwayStep({ step, trKeys, lang }: { step: TransitStepDetail; trKeys: Record<string, string>; lang: string }) {
  const trSuffix = lang === 'ja' ? 'Ja' : lang === 'zh' ? 'Zh' : '';
  const sx = step as unknown as Record<string, string | undefined>;
  const pickTr = (key: string): string | undefined => trSuffix ? sx[`${key}${trSuffix}`] : undefined;
  // Line label: ko-only for ko; for ja/zh show "2호선 (2号線)" using translated form when available, English otherwise.
  const lineKoStr = step.lineKo || step.line || '';
  const lineEnStr = step.lineEn || '';
  const lineTrStr = pickTr('line') || '';
  const lineLabel = lang === 'ko'
    ? lineKoStr
    : (lang === 'ja' || lang === 'zh')
      ? (lineKoStr && (lineTrStr || lineEnStr) && lineKoStr !== (lineTrStr || lineEnStr)
          ? `${lineKoStr} (${lineTrStr || lineEnStr})`
          : (lineKoStr || lineTrStr || lineEnStr))
      : (lineEnStr || lineKoStr);
  const wayLabel = step.way ? stationDisplay(step.way, pickTr('way'), step.wayRoman, lang) : null;
  const fromLabel = stationDisplay(step.from, pickTr('from'), step.fromRoman, lang);
  const toLabel = stationDisplay(step.to, pickTr('to'), step.toRoman, lang);
  return (
    <div className="rounded-lg bg-[#7C5CFC]/[0.06] border border-[#7C5CFC]/15 p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Train className="w-3.5 h-3.5 text-[#7C5CFC]" />
        <span className="text-[11px] font-bold text-[#7C5CFC]">{lineLabel}</span>
        {wayLabel && <span className="text-[10px] text-white/40">{trKeys.toward || 'toward'} {wayLabel}</span>}
        <span className="ml-auto text-[10px] text-white/40">{step.duration}{trKeys.minUnit || 'min'}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        <LogIn className="w-3 h-3 text-emerald-400/70 mt-0.5" />
        <span className="text-white/70">
          <span className="font-semibold text-white/90">{fromLabel}</span>
          {step.fromExit && <span className="ml-1 text-emerald-400">{trKeys.exit || 'Exit'} {step.fromExit}</span>}
        </span>
        <LogOut className="w-3 h-3 text-pink-400/70 mt-0.5" />
        <span className="text-white/70">
          <span className="font-semibold text-white/90">{toLabel}</span>
          {step.toExit && <span className="ml-1 text-pink-400">{trKeys.exit || 'Exit'} {step.toExit}</span>}
        </span>
        {(step.stationCount || 0) > 0 && (
          <>
            <span />
            <span className="text-white/35">
              {step.stationCount} {trKeys.stops || 'stops'}
              {step.intervalMin && <> · <Clock className="w-2.5 h-2.5 inline -mt-0.5" /> {trKeys.every || 'every'} {step.intervalMin}{trKeys.minUnit || 'min'}</>}
            </span>
          </>
        )}
      </div>
      {(step.passStops?.length || 0) > 2 && (
        <details className="mt-1.5">
          <summary className="text-[9px] text-white/30 cursor-pointer hover:text-white/50 list-none">
            {trKeys.showAllStops || 'Show all stops'} ({step.passStops!.length})
          </summary>
          <div className="mt-1 pl-4 text-[9px] text-white/35 space-y-0.5">
            {step.passStops!.map((s, i) => (
              <div key={i}>{i + 1}. {s}</div>
            ))}
          </div>
        </details>
      )}
      {(step.fromStationInfo?.transferLines?.length || 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px]">
          <Repeat className="w-2.5 h-2.5 text-white/40" />
          <span className="text-white/40">{trKeys.alsoTransfers || 'Also transfers'}:</span>
          {step.fromStationInfo!.transferLines!.map((l, i) => {
            let label = l.lineKo;
            if (lang !== 'ko') {
              const tr = lang === 'ja' ? l.lineKoJa : lang === 'zh' ? l.lineKoZh : undefined;
              label = (lang === 'ja' || lang === 'zh') && l.lineKo && tr && l.lineKo !== tr
                ? `${l.lineKo} (${tr})`
                : (l.lineEn || l.lineKo);
            }
            return (
              <span key={i} className="px-1.5 py-0.5 rounded bg-[#7C5CFC]/10 text-[#7C5CFC]/90">
                {label}
              </span>
            );
          })}
        </div>
      )}
      {step.fromTimetable && (() => {
        // Pick the direction whose terminus matches this leg's `way`; if no
        // overlap, fall back to whichever direction has data so travellers
        // still see a first/last reference.
        const tt = step.fromTimetable;
        const matches = (t: { lastDest?: string | null } | null | undefined) =>
          !!(t?.lastDest && step.way && (t.lastDest.includes(step.way) || step.way.includes(t.lastDest)));
        const chosen = matches(tt.up) ? tt.up : matches(tt.down) ? tt.down : (tt.up || tt.down);
        if (!chosen || (!chosen.first && !chosen.last)) return null;
        return (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px]">
            {chosen.first && (
              <span className="inline-flex items-center gap-1 text-white/50">
                <Sunrise className="w-2.5 h-2.5" />
                <span>{trKeys.firstTrain || 'First train'} {chosen.first}</span>
              </span>
            )}
            {chosen.last && (
              <span className="inline-flex items-center gap-1 text-pink-300 font-semibold">
                <Moon className="w-2.5 h-2.5" />
                <span>{trKeys.lastTrain || 'Last train'} {chosen.last}</span>
              </span>
            )}
          </div>
        );
      })()}
      {(step.toStationInfo?.hasElevator || step.toStationInfo?.hasWheelchairLift) && (
        <div className="mt-1 flex items-center gap-1.5 text-[9px] text-emerald-400/70">
          <Accessibility className="w-2.5 h-2.5" />
          <span>{trKeys.accessibleExit || 'Accessible exit available'}</span>
        </div>
      )}
      {step.toStationInfo?.lostCenterPhone && (
        <details className="mt-1">
          <summary className="text-[9px] text-white/25 cursor-pointer hover:text-white/45 list-none flex items-center gap-1">
            <Phone className="w-2.5 h-2.5" /> {trKeys.stationInfo || 'Station info'}
          </summary>
          <div className="mt-1 pl-4 text-[9px] text-white/40 space-y-0.5">
            {step.toStationInfo.address && <div>{step.toStationInfo.address}</div>}
            <div>
              {trKeys.lostAndFound || 'Lost & found'}:{' '}
              <a href={`tel:${step.toStationInfo.lostCenterPhone}`} className="text-[#7C5CFC] underline">
                {step.toStationInfo.lostCenterPhone}
              </a>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

function BusStep({ step, trKeys, lang }: { step: TransitStepDetail; trKeys: Record<string, string>; lang: string }) {
  // ODsay doesn't provide romanization for bus station names, so non-ja/zh users
  // see Korean as-is. ja/zh get the translated form in parens when available.
  const trSuffix = lang === 'ja' ? 'Ja' : lang === 'zh' ? 'Zh' : '';
  const sx = step as unknown as Record<string, string | undefined>;
  const bilangBus = (ko: string | undefined, key: string): string => {
    const k = ko || '';
    if (!k || lang === 'ko' || !trSuffix) return k;
    const tr = sx[`${key}${trSuffix}`];
    return tr && tr !== k ? `${k} (${tr})` : k;
  };
  const busTypeLabel = bilangBus(step.busType, 'busType');
  const fromLabel = bilangBus(step.from, 'from');
  const toLabel = bilangBus(step.to, 'to');
  return (
    <div className="rounded-lg bg-green-500/[0.06] border border-green-500/15 p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Bus className="w-3.5 h-3.5 text-green-400" />
        <span className="text-[11px] font-bold text-green-300">
          {busTypeLabel && <span className="text-green-400/70 mr-1">{busTypeLabel}</span>}
          {step.busNo}
        </span>
        <span className="ml-auto text-[10px] text-white/40">{step.duration}{trKeys.minUnit || 'min'}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        <LogIn className="w-3 h-3 text-emerald-400/70 mt-0.5" />
        <span className="text-white/70">
          <span className="font-semibold text-white/90">{fromLabel}</span>
          {step.fromArs && <span className="ml-1 text-white/40 font-mono">#{step.fromArs}</span>}
        </span>
        <LogOut className="w-3 h-3 text-pink-400/70 mt-0.5" />
        <span className="text-white/70">
          <span className="font-semibold text-white/90">{toLabel}</span>
          {step.toArs && <span className="ml-1 text-white/40 font-mono">#{step.toArs}</span>}
        </span>
        {(step.stationCount || 0) > 0 && (
          <>
            <span />
            <span className="text-white/35">
              {step.stationCount} {trKeys.stops || 'stops'}
              {step.intervalMin && <> · <Clock className="w-2.5 h-2.5 inline -mt-0.5" /> {trKeys.every || 'every'} {step.intervalMin}{trKeys.minUnit || 'min'}</>}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function WalkStep({ step, trKeys }: { step: TransitStepDetail; trKeys: Record<string, string> }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-white/40 pl-1">
      <Footprints className="w-3 h-3 text-white/30" />
      <span>
        {trKeys.walk || 'Walk'} {step.duration}{trKeys.minUnit || 'min'}
        {(step.distance || 0) > 0 && <span className="text-white/25"> ({step.distance}m)</span>}
      </span>
    </div>
  );
}

export function TransitArrow({ transit }: { transit: TransitFromPrev & Record<string, unknown> }) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const trKeys = (pd.transit || {}) as Record<string, string>;
  const Icon = TRANSIT_ICON[transit.method] || Car;
  const isPublicTransit = transit.method === 'subway' || transit.method === 'bus' || transit.method === 'subway+bus';
  const detailSteps = transit.steps_detail || [];
  const hasRichSteps = detailSteps.length > 0;
  const hasLegacySteps = !hasRichSteps && Array.isArray(transit.step_by_step) && transit.step_by_step.length > 0;
  const [showSteps, setShowSteps] = useState(isPublicTransit);
  const isDowngraded = !!transit._downgraded_from;
  const isFallback = transit.source === 'naver_fallback';
  const isStale = !!transit._stale;

  return (
    <div className="ml-4 my-1">
      <button
        onClick={() => (hasRichSteps || hasLegacySteps) && setShowSteps(!showSteps)}
        className="flex items-center gap-2 text-[11px] text-white/60 hover:text-white/80 transition-colors"
      >
        <div className="w-0.5 h-4 bg-[#7C5CFC]/30" />
        <Icon className="w-3.5 h-3.5 text-[#7C5CFC]" />
        {transit.from_label && <span className="text-[#7C5CFC] font-semibold">{transit.from_label} {'\u2192'}</span>}
        <span className="font-semibold">{transit.method}</span>
        <span className="text-white/50">{transit.est_min}{trKeys.minUnit || 'min'}</span>
        {(transit.est_fare_krw || 0) > 0 && <span className="text-[#7C5CFC]">{formatKRW(transit.est_fare_krw || 0)}</span>}
        {(transit.transfers || 0) > 0 && <span className="text-white/40">· {transit.transfers} {trKeys.transfer || 'transfer'}</span>}
        {(hasRichSteps || hasLegacySteps) && <ChevronDown className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-180' : ''}`} />}
      </button>

      {isDowngraded && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[10px] text-amber-400/80">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.publicTransitUnavailable || 'Public transit unavailable'}</span>
        </div>
      )}

      {isFallback && !isDowngraded && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[10px] text-amber-400/80">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.transitEstimated || 'Estimated travel time — live transit data unavailable'}</span>
        </div>
      )}

      {isStale && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[10px] text-amber-400/80">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.routeStale || (pd.editor && pd.editor.routeStale) || 'Route may have changed'}</span>
        </div>
      )}

      {(transit.instruction_en || transit.instruction) && !hasRichSteps && (
        <p className="text-[10px] text-white/25 ml-6 mt-0.5 whitespace-pre-line">{transit.instruction_en || transit.instruction}</p>
      )}

      {showSteps && hasRichSteps && (
        <div className="ml-6 mt-1.5 space-y-1.5">
          {detailSteps.map((step, i) => {
            if (step.mode === 'subway') return <SubwayStep key={i} step={step} trKeys={trKeys} lang={language} />;
            if (step.mode === 'bus') return <BusStep key={i} step={step} trKeys={trKeys} lang={language} />;
            return <WalkStep key={i} step={step} trKeys={trKeys} />;
          })}
          {(transit.total_walk_m || 0) > 0 && (
            <p className="text-[9px] text-white/30 pl-1">
              <Footprints className="w-2.5 h-2.5 inline -mt-0.5" /> {trKeys.totalWalk || 'Total walk'}: {transit.total_walk_m}m
            </p>
          )}
        </div>
      )}

      {showSteps && !hasRichSteps && hasLegacySteps && (
        <div className="ml-6 mt-1 space-y-0.5">
          {transit.step_by_step!.map((s: string, i: number) => {
            const StepIcon = transit.method === 'bus' ? Bus : Train;
            return (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-white/35">
                <StepIcon className="w-3 h-3 mt-0.5 text-[#7C5CFC]/60 flex-shrink-0" />
                <span>{i + 1}. {s}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
