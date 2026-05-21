// Pure helpers + small presentational components shared across wizard steps.
import type { ReactNode } from 'react';
import { AIRPORT_OPTIONS, type AirportOption } from './data';

export function getAirportOptions(chipKey: string): AirportOption[] {
  return AIRPORT_OPTIONS[chipKey] || AIRPORT_OPTIONS.seoul;
}

/** P142 (2026-05-22): 출국 공항 옵션 빌더. 다도시 plan 에서 출국지가 입국지와
 *  다를 수 있어 (서울 → 부산 → 김해 출국) 모든 city 의 공항을 union + dedup.
 *  단도시는 그 city 의 공항만. ALREADY 옵션은 제거 (출국 = 한국 떠남). */
export function getDepartureAirportOptions(cityKeys: string[]): AirportOption[] {
  const keys = (cityKeys && cityKeys.length > 0) ? cityKeys : ['seoul'];
  const seen = new Set<string>();
  const merged: AirportOption[] = [];
  for (const ck of keys) {
    const opts = AIRPORT_OPTIONS[ck] || [];
    for (const opt of opts) {
      if (opt.value === 'ALREADY') continue;
      if (seen.has(opt.value)) continue;
      seen.add(opt.value);
      merged.push(opt);
    }
  }
  return merged;
}

export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5">
      <span className="flex items-center gap-1 text-[10px] text-white/55 mb-1">{icon} {label}</span>
      <p className="text-sm font-bold text-white truncate">{value}</p>
    </div>
  );
}
