// TransitVsCharterCard.tsx -- 대중교통 vs 차터 2-컬럼 비교 카드
// PR-C3 (2026-06-01): 그날 대중교통 합산(총 분/환승/요금) vs 차터 일일가(+인당가) 비교.
// 플래그: VITE_FEATURE_TRANSIT_VS_CHARTER === 'true'
// OFF(미설정) -> 렌더 안 함 = 현재 동작 byte-identical.
//
// WARNING: firebase import 금지. 순수 React/i18n 만.
import { Car, TrainFront } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { formatKRW } from '../constants';
import {
  computeTransitVsCharter,
  isTransitVsCharterEnabled,
} from '../lib/transitVsCharter';
import type { PlanDay, PlanStop } from '../types';
import { detectCharterRecommendation } from '@/data/charterPricing';
import { getPlanDetailDict } from '../types';

interface TransitVsCharterCardProps {
  day: PlanDay;
  /** 인원수 (pax/adults). 인당가 계산용. */
  pax?: number;
  /** 플래그 override — 테스트에서 직접 주입 가능. undefined = 환경변수 읽기. */
  featureEnabled?: boolean;
}

export function TransitVsCharterCard({ day, pax, featureEnabled }: TransitVsCharterCardProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  // planDetail.transitVsCharter 섹션에서 텍스트 읽기
  const tvcd = (pd.transitVsCharter as Record<string, string> | undefined) || {};

  // 플래그 OFF -> 미노출 (byte-identical)
  if (!isTransitVsCharterEnabled(featureEnabled)) return null;

  const stops = (day.stops || []) as PlanStop[];

  // 차터 감지 (기존 detectCharterRecommendation 재사용)
  const stopNames = stops.map((s) => ({
    name: s.name || s.display_name || '',
    nameEn: s.display_name || s.name || '',
  }));
  const detection = detectCharterRecommendation(stopNames);
  if (!detection.recommended || !detection.pricing) return null;

  const safePax = typeof pax === 'number' && pax > 0 ? pax : 1;

  const comparison = computeTransitVsCharter(stops, detection.pricing, safePax);
  // 데이터 부족 시 미노출
  if (!comparison) return null;

  const { transit, charter, timeSavedMin } = comparison;

  // 텍스트 — i18n 키 우선, fallback hardcoded (4-lang 대응)
  const cardTitle      = tvcd.cardTitle      || '오늘 이동 비교';
  const transitColLabel = tvcd.transitCol    || '대중교통';
  const charterColLabel = tvcd.charterCol    || '전세차량';
  const minLabel        = tvcd.minUnit       || '분';
  const transfersLabel  = tvcd.transfersUnit || '환승';
  const perPersonLabel  = tvcd.perPerson     || '인당';
  const doorToDoorLabel = tvcd.doorToDoor    || '도어투도어';
  const noLuggageLabel  = tvcd.noLuggage     || '짐 걱정 0';
  const savedMinTpl     = tvcd.savedMin      || '{min}분 단축';

  const valueLine = timeSavedMin >= 5
    ? savedMinTpl.replace('{min}', String(timeSavedMin))
    : '';

  return (
    <div
      className="mb-4 rounded-2xl border border-white/[0.08] overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      {/* 헤더 */}
      <div className="px-4 pt-3 pb-2 border-b border-white/[0.06]">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
          {cardTitle}
        </p>
      </div>

      {/* 2-컬럼 비교 */}
      <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
        {/* 대중교통 컬럼 */}
        <div className="px-4 py-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-6 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center shrink-0">
              <TrainFront className="w-3 h-3 text-sky-300" />
            </div>
            <span className="text-[11px] font-semibold text-sky-300">{transitColLabel}</span>
          </div>
          {/* 총 이동 시간 */}
          <div>
            <span className="text-white text-lg font-black leading-none">{transit.totalMin}</span>
            <span className="text-white/55 text-[10px] ml-1">{minLabel}</span>
          </div>
          {/* 환승 수 */}
          <div className="text-white/60 text-[11px]">
            {transit.totalTransfers}{transfersLabel}
          </div>
          {/* T-money 요금 */}
          {transit.totalFareKrw > 0 && (
            <div className="text-white/75 text-[11px] font-medium">
              {formatKRW(transit.totalFareKrw)}
            </div>
          )}
        </div>

        {/* 차터 컬럼 */}
        <div className="px-4 py-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-6 h-6 rounded-full bg-[#7C5CFC]/20 border border-[#7C5CFC]/30 flex items-center justify-center shrink-0">
              <Car className="w-3 h-3 text-[#B9A4FF]" />
            </div>
            <span className="text-[11px] font-semibold text-[#B9A4FF]">{charterColLabel}</span>
          </div>
          {/* 차터 일일가 */}
          <div>
            <span className="text-white text-lg font-black leading-none">{formatKRW(charter.dailyPriceKrw)}</span>
          </div>
          {/* 인당가 (pax > 1 일 때만) */}
          {safePax > 1 && (
            <div className="text-white/60 text-[11px]">
              {perPersonLabel} {formatKRW(charter.perPersonKrw)}
            </div>
          )}
          {/* 도어투도어 + 짐 걱정 0 */}
          <div className="text-white/75 text-[11px] font-medium">
            {doorToDoorLabel} · {noLuggageLabel}
          </div>
          {/* 시간 단축 뱃지 (timeSavedMin >= 5 일 때만) */}
          {valueLine ? (
            <div className="mt-0.5 inline-flex items-center self-start gap-1 px-2 py-0.5 rounded-full bg-[#7C5CFC]/20 border border-[#7C5CFC]/30">
              <span className="text-[10px] font-bold text-[#B9A4FF]">{valueLine}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
