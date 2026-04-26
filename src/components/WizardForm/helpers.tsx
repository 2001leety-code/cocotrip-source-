// Pure helpers + small presentational components shared across wizard steps.
import type { ReactNode } from 'react';
import { AIRPORT_OPTIONS, type AirportOption } from './data';

export function getAirportOptions(chipKey: string): AirportOption[] {
  return AIRPORT_OPTIONS[chipKey] || AIRPORT_OPTIONS.seoul;
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
