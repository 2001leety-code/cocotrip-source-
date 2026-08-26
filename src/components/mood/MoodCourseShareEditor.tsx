import { useState } from 'react';
import {
  courseSharePresetPercentage,
  formatMoodShareKRW,
  moodCourseSharePreset,
  normalizeMoodCoursePercentages,
  type MoodCourseSharePreset,
} from '@/lib/moodBookingShare';

export interface MoodCourseShareItem {
  address: string;
  percentageIndex: number;
}

interface Props {
  items: MoodCourseShareItem[];
  percentages: number[];
  totalKRW: number;
  influencerName?: string | null;
  onChange: (next: number[]) => void;
  compact?: boolean;
}

export function MoodCourseShareEditor({ items, percentages, totalKRW, influencerName, onChange, compact = false }: Props) {
  const [manuallyEdited, setManuallyEdited] = useState(false);
  if (!items.length) return null;
  const normalized = normalizeMoodCoursePercentages(percentages, percentages.length || items.length, null, 100);
  const activeValues = items.map((item) => typeof normalized[item.percentageIndex] === 'number' ? normalized[item.percentageIndex] : 100);
  const preset = moodCourseSharePreset(activeValues);
  const courseBase = Math.floor(Math.max(0, Math.round(Number(totalKRW) || 0)) / items.length);
  const rows = items.map((item, index) => {
    const courseKRW = courseBase + (index === items.length - 1 ? Math.max(0, Math.round(Number(totalKRW) || 0)) - courseBase * items.length : 0);
    const moodPercentage = activeValues[index];
    const moodKRW = Math.round(courseKRW * moodPercentage / 100);
    const influencerKRW = courseKRW - moodKRW;
    return { item, index, courseKRW, moodPercentage, moodKRW, influencerKRW };
  });
  const moodTotal = rows.reduce((sum, row) => sum + row.moodKRW, 0);
  const influencerTotal = rows.reduce((sum, row) => sum + row.influencerKRW, 0);
  const influencerLabel = String(influencerName || '').trim() || '인플루언서';
  const applyPreset = (nextPreset: Exclude<MoodCourseSharePreset, 'custom'>) => {
    const next = normalized.slice();
    const percentage = courseSharePresetPercentage(nextPreset);
    items.forEach((item) => { next[item.percentageIndex] = percentage; });
    setManuallyEdited(false);
    onChange(next);
  };
  const applyToAll = (percentage: number, direct = false) => {
    const next = normalized.slice();
    items.forEach((item) => { next[item.percentageIndex] = percentage; });
    setManuallyEdited(direct);
    onChange(next);
  };

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-2 sm:p-3" aria-label="코스별 비용 분담 비율">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black text-white">비용 분담 규칙</p>
          <p className="mt-0.5 text-xs text-slate-300">총액을 코스 수로 나눈 뒤 각 코스 비율을 적용합니다.</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-black ${manuallyEdited || preset === 'custom' ? 'bg-amber-400/15 text-amber-200' : 'bg-violet-400/15 text-violet-200'}`}>
          {manuallyEdited || preset === 'custom' ? '직접 수정됨' : '프리셋 적용'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {([
          ['staff', '직원 이용', 'MOOD 100%'],
          ['shared-airport', '공동 탑승', '50:50'],
          ['event', '행사', '인플루언서 100%'],
        ] as const).map(([value, label, detail]) => (
          <button
            key={value}
            type="button"
            onClick={() => applyPreset(value)}
            className={`min-h-12 rounded-lg border px-1.5 py-2 text-xs font-black ${preset === value ? 'border-violet-300 bg-violet-500/25 text-white' : 'border-white/10 bg-white/5 text-slate-300'}`}
          >
            {label}<span className="mt-0.5 block text-xs font-semibold opacity-75">{detail}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map(({ item, index, courseKRW, moodPercentage, moodKRW, influencerKRW }) => (
          <div key={`${item.percentageIndex}-${item.address}`} className="rounded-lg bg-white/5 px-2 py-2.5 sm:p-2.5">
            <div className="flex items-start gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500 text-xs font-black text-white">{index + 1}</span>
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold leading-5 text-white">{item.address}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="grid min-w-0 flex-1 grid-cols-[auto_minmax(4.5rem,1fr)_auto] items-center gap-1.5 text-xs font-black text-violet-200">
                <span>MOOD</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={moodPercentage}
                  aria-label={`${index + 1}번 코스 MOOD 부담 비율`}
                  onChange={(event) => {
                    const value = Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0)));
                    const next = normalized.slice();
                    next[item.percentageIndex] = value;
                    setManuallyEdited(true);
                    onChange(next);
                  }}
                  className="h-11 min-w-0 w-full rounded-lg border border-violet-300/30 bg-black/30 px-2 text-right text-sm text-white"
                />
                <span>%</span>
              </label>
              <button
                type="button"
                onClick={() => applyToAll(moodPercentage, true)}
                className="min-h-11 min-w-[3.25rem] shrink-0 rounded-lg bg-white/10 px-3 text-xs font-black text-slate-200"
                aria-label={`${index + 1}번 코스 MOOD ${moodPercentage}%를 전체 코스에 적용`}
              >
                전체
              </button>
            </div>
            {!compact && (
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5">
                <span className="min-w-0 break-words text-violet-200">MOOD {moodPercentage}% · {formatMoodShareKRW(moodKRW)}</span>
                <span className="min-w-0 break-words text-pink-200">{influencerLabel} {100 - moodPercentage}% · {formatMoodShareKRW(influencerKRW)}</span>
                <span className="col-span-2 text-slate-500">코스 금액 {formatMoodShareKRW(courseKRW)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-400">전체 적용</span>
        {[0, 50, 100].map((percentage) => <button key={percentage} type="button" onClick={() => applyToAll(percentage)} className="min-h-11 rounded-full bg-white/10 px-3 font-black text-white">MOOD {percentage}%</button>)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-violet-400/10 p-2"><p className="text-xs text-slate-300">MOOD 부담 합계</p><p className="text-sm font-black text-violet-200">{formatMoodShareKRW(moodTotal)}</p></div>
        <div className="rounded-lg bg-pink-400/10 p-2"><p className="truncate text-xs text-slate-300">{influencerLabel} 부담 합계</p><p className="text-sm font-black text-pink-200">{formatMoodShareKRW(influencerTotal)}</p></div>
      </div>
    </section>
  );
}

export default MoodCourseShareEditor;
