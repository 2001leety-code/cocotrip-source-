// Transit segment between two stops. Rich rendering of ODsay subway/bus data:
// line, exit numbers, headway, pass-through stations. Falls back to simple
// text step_by_step when steps_detail is unavailable (legacy plans).

import { useState } from 'react';
import { Car, ChevronDown, Bus, Train, AlertTriangle, Footprints, Clock, LogOut, LogIn, Repeat, Accessibility, Phone, Sunrise, Moon, Navigation } from 'lucide-react';
import { TRANSIT_ICON, formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import type { TransitFromPrev, TransitStepDetail } from '@/types/plan';
import { getPlanDetailDict } from '../types';
import {
  buildTransitDirectionsLinks,
  isPublicTransitMethod,
  methodLabel,
  shouldShowFallbackWarning,
  type SegmentEndpoints,
} from '../lib/transitArrow';

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
  // Skip parens when paren equals Korean (Gemini sometimes returns input unchanged for short station names).
  return paren && paren !== koName ? `${koName} (${paren})` : koName;
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
    <div className="rounded-ec-sm border border-ec-line bg-ec-sunken p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Train className="h-3.5 w-3.5 text-ec-brand" />
        <span className="text-[13px] font-bold text-ec-brand">{lineLabel}</span>
        {wayLabel && <span className="text-[12px] text-ec-ink-3">{trKeys.toward || 'toward'} {wayLabel}</span>}
        <span className="ml-auto text-[12px] text-ec-ink-3">{step.duration}{trKeys.minUnit || 'min'}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
        <LogIn className="w-3 h-3 text-emerald-400/70 mt-0.5" />
        <span className="text-ec-ink-2">
          <span className="font-semibold text-ec-ink">{fromLabel}</span>
          {step.fromExit && <span className="ml-1 text-ec-success">{trKeys.exit || 'Exit'} {step.fromExit}</span>}
        </span>
        <LogOut className="w-3 h-3 text-pink-400/70 mt-0.5" />
        <span className="text-ec-ink-2">
          <span className="font-semibold text-ec-ink">{toLabel}</span>
          {step.toExit && <span className="ml-1 text-ec-brand">{trKeys.exit || 'Exit'} {step.toExit}</span>}
        </span>
        {(step.stationCount || 0) > 0 && (
          <>
            <span />
            <span className="text-ec-ink-3">
              {step.stationCount} {trKeys.stops || 'stops'}
              {step.intervalMin && <> · <Clock className="w-2.5 h-2.5 inline -mt-0.5" /> {trKeys.every || 'every'} {step.intervalMin}{trKeys.minUnit || 'min'}</>}
            </span>
          </>
        )}
      </div>
      {(step.passStops?.length || 0) > 2 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer list-none text-[13px] text-ec-ink-3 hover:text-ec-ink">
            {trKeys.showAllStops || 'Show all stops'} ({step.passStops!.length})
          </summary>
          <div className="mt-1 space-y-0.5 pl-4 text-[13px] text-ec-ink-3">
            {step.passStops!.map((s, i) => (
              <div key={i}>{i + 1}. {s}</div>
            ))}
          </div>
        </details>
      )}
      {(step.fromStationInfo?.transferLines?.length || 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[13px]">
          <Repeat className="h-2.5 w-2.5 text-ec-ink-3" />
          <span className="text-ec-ink-3">{trKeys.alsoTransfers || 'Also transfers'}:</span>
          {step.fromStationInfo!.transferLines!.map((l, i) => {
            let label = l.lineKo;
            if (lang !== 'ko') {
              const tr = lang === 'ja' ? l.lineKoJa : lang === 'zh' ? l.lineKoZh : undefined;
              label = (lang === 'ja' || lang === 'zh') && l.lineKo && tr && l.lineKo !== tr
                ? `${l.lineKo} (${tr})`
                : (l.lineEn || l.lineKo);
            }
            return (
              <span key={i} className="rounded bg-ec-brand-wash px-1.5 py-0.5 text-ec-brand">
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
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            {chosen.first && (
              <span className="inline-flex items-center gap-1 text-ec-ink-3">
                <Sunrise className="w-2.5 h-2.5" />
                <span>{trKeys.firstTrain || 'First train'} {chosen.first}</span>
              </span>
            )}
            {chosen.last && (
              <span className="inline-flex items-center gap-1 font-semibold text-ec-brand">
                <Moon className="w-2.5 h-2.5" />
                <span>{trKeys.lastTrain || 'Last train'} {chosen.last}</span>
              </span>
            )}
          </div>
        );
      })()}
      {(step.toStationInfo?.hasElevator || step.toStationInfo?.hasWheelchairLift) && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ec-success">
          <Accessibility className="w-2.5 h-2.5" />
          <span>{trKeys.accessibleExit || 'Accessible exit available'}</span>
        </div>
      )}
      {step.toStationInfo?.lostCenterPhone && (
        <details className="mt-1">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] text-ec-ink-3 hover:text-ec-ink">
            <Phone className="w-2.5 h-2.5" /> {trKeys.stationInfo || 'Station info'}
          </summary>
          <div className="mt-1 space-y-0.5 pl-4 text-[13px] text-ec-ink-3">
            {step.toStationInfo.address && <div>{step.toStationInfo.address}</div>}
            <div>
              {trKeys.lostAndFound || 'Lost & found'}:{' '}
              <a href={`tel:${step.toStationInfo.lostCenterPhone}`} className="text-ec-brand underline">
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
    <div className="rounded-ec-sm border border-ec-line bg-ec-sunken p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Bus className="h-3.5 w-3.5 text-ec-success" />
        <span className="text-[13px] font-bold text-ec-success">
          {busTypeLabel && <span className="mr-1 text-ec-ink-3">{busTypeLabel}</span>}
          {step.busNo}
        </span>
        <span className="ml-auto text-[12px] text-ec-ink-3">{step.duration}{trKeys.minUnit || 'min'}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[12px]">
        <LogIn className="w-3 h-3 text-emerald-400/70 mt-0.5" />
        <span className="text-ec-ink-2">
          <span className="font-semibold text-ec-ink">{fromLabel}</span>
          {step.fromArs && <span className="ml-1 font-mono text-ec-ink-3">#{step.fromArs}</span>}
        </span>
        <LogOut className="w-3 h-3 text-pink-400/70 mt-0.5" />
        <span className="text-ec-ink-2">
          <span className="font-semibold text-ec-ink">{toLabel}</span>
          {step.toArs && <span className="ml-1 font-mono text-ec-ink-3">#{step.toArs}</span>}
        </span>
        {(step.stationCount || 0) > 0 && (
          <>
            <span />
            <span className="text-ec-ink-3">
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
    <div className="flex items-center gap-2.5 rounded-ec-sm border border-ec-line bg-ec-sunken px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ec-brand-wash">
        <Footprints className="h-3.5 w-3.5 text-ec-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-ec-ink">
          {trKeys.walk || 'Walk'} {step.duration}{trKeys.minUnit || 'min'}
          {(step.distance || 0) > 0 && <span className="ml-1.5 font-mono text-ec-notice">{step.distance}m</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * 개발용 문구가 남아 있는 옛 플랜 방어 (2026-07-28).
 *
 * 생성 단계(transitCache.js)에서 `DB cached: … (zone_courses)` 를 손님 문구 필드에
 * 넣던 버그를 고쳤지만, **이미 저장된 플랜에는 그 문자열이 그대로 남아 있다.**
 * Firestore 를 일괄 수정하는 대신 표시 단에서 거른다 — 되돌리기 쉽고 데이터는 안 건드린다.
 */
const DEV_INSTRUCTION_RE = /(DB cached|zone_courses)/i;

function customerInstruction(transit: Record<string, unknown>): string {
  const raw = String(transit.instruction_en || transit.instruction || '');
  if (!raw) return '';
  return DEV_INSTRUCTION_RE.test(raw) ? '' : raw;
}

export function TransitArrow({ transit, destinationName, endpoints }: { transit: TransitFromPrev & Record<string, unknown>; destinationName?: string; endpoints?: SegmentEndpoints }) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const trKeys = (pd.transit || {}) as Record<string, string>;
  const Icon = TRANSIT_ICON[transit.method] || Car;
  const isPublicTransit = isPublicTransitMethod(transit.method);
  const detailSteps = transit.steps_detail || [];
  const hasRichSteps = detailSteps.length > 0;
  const hasLegacySteps = !hasRichSteps && Array.isArray(transit.step_by_step) && transit.step_by_step.length > 0;
  const [showSteps, setShowSteps] = useState(isPublicTransit);
  const isDowngraded = !!transit._downgraded_from;
  // car/private vehicle 모드는 ODsay 대상이 아니라서 'naver_fallback' source가 정상 경로.
  // shouldShowFallbackWarning이 모드/downgrade 가드까지 처리. 단위 테스트로 회귀 방지.
  const isFallback = shouldShowFallbackWarning(transit);
  const isStale = !!transit._stale;

  // Final arrival summary: pick the LAST subway/bus step's exit + the LAST walk
  // step's distance to render a "Exit X → walk Ymin → DESTINATION" callout.
  // This is the bit users were missing — Klook/Naver always end with this.
  const lastTransitStep = [...detailSteps].reverse().find(s => s.mode === 'subway' || s.mode === 'bus');
  const lastWalkStep = [...detailSteps].reverse().find(s => s.mode === 'walk');
  const exitNum = (lastTransitStep as { toExit?: string | number } | undefined)?.toExit;
  const walkM = (lastWalkStep?.distance as number | undefined) || transit.total_walk_m || 0;
  const walkMin = (lastWalkStep?.duration as number | undefined) || (walkM > 0 ? Math.max(1, Math.round(walkM / 70)) : 0);
  const showFinalArrival = !!destinationName && hasRichSteps && (exitNum || walkM > 0);
  // 승하차 좌표가 저장된 구간에서만 노출(구형 플랜은 좌표가 없어 null → 버튼 미표시).
  const directionsLinks = buildTransitDirectionsLinks(transit, destinationName, endpoints);

  return (
    <div className="ml-4 my-1">
      <button
        type="button"
        onClick={() => (hasRichSteps || hasLegacySteps) && setShowSteps(!showSteps)}
        className="flex min-h-[44px] flex-wrap items-center gap-2 text-[13px] text-ec-ink-2 transition-colors hover:text-ec-ink"
      >
        <div className="h-4 w-0.5 bg-ec-line-2" />
        <Icon className="h-3.5 w-3.5 text-ec-brand" />
        {transit.from_label && <span className="font-semibold text-ec-brand">{transit.from_label} {'\u2192'}</span>}
        <span className="font-semibold">{methodLabel(transit.method, trKeys)}</span>
        <span className="text-ec-ink-3">{transit.est_min}{trKeys.minUnit || 'min'}</span>
        {isPublicTransit
          ? (transit.est_fare_krw || 0) > 0
            ? <span className="text-ec-brand">{formatKRW(transit.est_fare_krw || 0)}</span>
            : <span className="text-[12px] text-ec-ink-3">{trKeys.fareUnavailable || 'Fare N/A'}</span>
          : (transit.est_fare_krw || 0) > 0
            ? <span className="text-ec-brand">{formatKRW(transit.est_fare_krw || 0)}</span>
            : null
        }
        {(transit.transfers || 0) > 0 && <span className="text-ec-ink-3">· {transit.transfers} {trKeys.transfer || 'transfer'}</span>}
        {/* 2026-04-27 이동 안내: 다음 목적지 명시. "차량 25분 → K-스타 로드" 형태로 사용자가 어디로 이동하는지 즉시 파악. */}
        {destinationName && !transit.from_label && (
          <span className="max-w-[180px] truncate text-ec-ink-2">{'→'} {destinationName}</span>
        )}
        {(hasRichSteps || hasLegacySteps) && <ChevronDown className={`w-3 h-3 transition-transform ${showSteps ? 'rotate-180' : ''}`} />}
      </button>
      {/* Walk 정당화 라벨 — 사용자 신고 "왜 다 걷어?" 대응. 짧은 거리는 도보가 지하철보다
          빠르다는 사실을 명시. 신뢰 회복 + AI 게으른 plan 인상 차단. */}
      {transit.method === 'walk' && (transit.est_min || 0) <= 15 && (
        <p className="ml-6 mt-0.5 text-[13px] italic text-ec-success">
          {trKeys.walkFasterNote || '🚶 이 거리는 지하철보다 도보가 빠릅니다 (대기·환승 포함)'}
        </p>
      )}
      {/* 인라인 이동 안내: instruction 있으면 collapsed 상태에서도 항상 표시. */}
      {!hasRichSteps && !hasLegacySteps && customerInstruction(transit) && (
        <p className="ml-6 mt-0.5 whitespace-pre-line text-[12px] text-ec-ink-3">
          {customerInstruction(transit)}
        </p>
      )}

      {isDowngraded && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[12px] text-ec-notice">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.publicTransitUnavailable || 'Public transit unavailable'}</span>
        </div>
      )}

      {isFallback && !isDowngraded && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[12px] text-ec-notice">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.transitEstimated || 'Estimated travel time — live transit data unavailable'}</span>
        </div>
      )}

      {isStale && (
        <div className="ml-6 mt-1 flex items-center gap-1.5 text-[12px] text-ec-notice">
          <AlertTriangle className="w-3 h-3" />
          <span>{trKeys.routeStale || (pd.editor && pd.editor.routeStale) || 'Route may have changed'}</span>
        </div>
      )}

      {showSteps && hasRichSteps && (
        <div className="ml-6 mt-1.5 space-y-1.5">
          {detailSteps.map((step, i) => {
            if (step.mode === 'subway') return <SubwayStep key={i} step={step} trKeys={trKeys} lang={language} />;
            if (step.mode === 'bus') return <BusStep key={i} step={step} trKeys={trKeys} lang={language} />;
            return <WalkStep key={i} step={step} trKeys={trKeys} />;
          })}

          {/* FINAL ARRIVAL — "Exit X → walk Ymin → DESTINATION".
              The bordered summary makes the final step easy to scan. */}
          {showFinalArrival && (
            <div className="mt-2 border-l-2 border-ec-success bg-ec-sunken px-3 py-2.5">
              <p className="mb-1 text-[12px] font-bold uppercase tracking-wider text-ec-success">
                {trKeys.finalArrival || '도착'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ec-ink">
                {exitNum && (
                  <>
                    <span className="font-bold">{trKeys.exit || 'Exit'} {exitNum}</span>
                    <span className="text-ec-ink-3">→</span>
                  </>
                )}
                {walkM > 0 && (
                  <>
                    <span className="ec-chip bg-ec-raised px-1.5 py-0.5 text-ec-notice">
                      <Footprints className="w-3 h-3" />
                      {trKeys.walk || 'Walk'} {walkMin}{trKeys.minUnit || 'min'} ({walkM}m)
                    </span>
                    <span className="text-ec-ink-3">→</span>
                  </>
                )}
                <span className="font-bold text-ec-success">{destinationName}</span>
              </div>
            </div>
          )}

          {(transit.total_walk_m || 0) > 0 && !showFinalArrival && (
            <p className="pl-1 text-[13px] text-ec-ink-3">
              <Footprints className="w-2.5 h-2.5 inline -mt-0.5" /> {trKeys.totalWalk || 'Total walk'}: {transit.total_walk_m}m
            </p>
          )}

        </div>
      )}

      {/* 현장용 길찾기 — 실제로 쓰는 앱으로 넘긴다. 둘 다 딥링크(URL)라 과금 없음.
          구글맵을 먼저 두는 이유: 외국인에게 이미 깔려 있고 언어가 자동. 네이버는
          한국 대중교통 정확도가 높지만 앱 언어 설정을 따라간다.
          🔴 2026-07-28: 이 버튼이 `showSteps && hasRichSteps` 안에 들어 있었다. 도보 구간은
          백엔드가 steps_detail 을 안 만들어 hasRichSteps=false → **도보 구간에서만 버튼이
          통째로 사라졌다**(사용자 신고 "도보에서 도보로 갈 때 지도가 안 뜬다"). 접힘 상태와
          무관하게 항상 노출한다. */}
      {directionsLinks && (
        <div className="ml-6 mt-1.5 flex items-center gap-1.5 flex-wrap">
          <a
            href={directionsLinks.google}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ec-btn ec-btn-secondary px-2.5 text-[12px]"
          >
            <Navigation className="w-3 h-3" />
            {trKeys.openInGoogleMaps || 'Google Maps'}
          </a>
          <a
            href={directionsLinks.naver}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ec-btn ec-btn-secondary px-2.5 text-[12px] text-ec-success"
          >
            <Navigation className="w-3 h-3" />
            {trKeys.openInNaverMap || 'Naver Map'}
          </a>
        </div>
      )}

      {showSteps && !hasRichSteps && hasLegacySteps && (
        <div className="ml-6 mt-1 space-y-0.5">
          {transit.step_by_step!.map((s: string, i: number) => {
            const StepIcon = transit.method === 'bus' ? Bus : Train;
            return (
              <div key={i} className="flex items-start gap-1.5 text-[12px] text-ec-ink-3">
                <StepIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-ec-brand" />
                <span>{i + 1}. {s}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
