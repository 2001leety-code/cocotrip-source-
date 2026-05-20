// StopsTab — 탭 ③ 일정 (TourStop[] 시간순 list)
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { Tour, TourStop, TourTransit } from '@/data/tours';
import { I18nField, I18nTextarea } from './I18nField';
import { PhotoUploader } from '@/components/admin/PhotoUploader';

interface Props {
  draft: Partial<Tour>;
  tourId: string;
  onChange: (patch: Partial<Tour>) => void;
}

function defaultStop(): TourStop {
  return {
    time: '09:00',
    name: { ko: '', en: '', ja: '', zh: '' },
    stay_min: 60,
    description: { ko: '', en: '', ja: '', zh: '' },
  };
}

export function StopsTab({ draft, tourId, onChange }: Props) {
  const stops = draft.stops ?? [];
  const setStops = (next: TourStop[]) => onChange({ stops: next });

  const add = () => setStops([...stops, defaultStop()]);
  const remove = (i: number) => {
    if (!window.confirm('이 스톱을 삭제할까요?')) return;
    setStops(stops.filter((_, idx) => idx !== i));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
  };
  const update = (i: number, patch: Partial<TourStop>) => {
    setStops(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const updateTransit = (i: number, patch: Partial<TourTransit>) => {
    const prev = stops[i].transit_from_prev;
    update(i, {
      transit_from_prev: { ...(prev ?? { method: 'car', minutes: 10 }), ...patch },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          시간순으로 정렬됩니다. 첫 stop 의 transit 은 무시됨.
        </p>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10"
        >
          <Plus className="w-3.5 h-3.5" />
          Stop 추가
        </button>
      </div>

      {stops.length === 0 && (
        <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
          아직 일정 stop 이 없습니다.
        </div>
      )}

      {stops.map((stop, i) => (
        <div key={i} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-700">Stop {i + 1}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                className="p-1 rounded hover:bg-white disabled:opacity-30">
                <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === stops.length - 1}
                className="p-1 rounded hover:bg-white disabled:opacity-30">
                <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
              </button>
              <button type="button" onClick={() => remove(i)}
                className="p-1 rounded hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">시각</label>
              <input
                type="text"
                value={stop.time}
                onChange={(e) => update(i, { time: e.target.value })}
                placeholder="09:30"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">체류 (분)</label>
              <input
                type="number"
                value={stop.stay_min}
                onChange={(e) => update(i, { stay_min: parseInt(e.target.value || '0', 10) })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">입장료 (KRW)</label>
              <input
                type="number"
                value={stop.entry_fee_krw ?? 0}
                onChange={(e) => update(i, { entry_fee_krw: parseInt(e.target.value || '0', 10) || undefined })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
          </div>

          <div className="space-y-3 mb-3">
            <I18nField label="이름" value={stop.name} onChange={(v) => update(i, { name: v })} required />
            <I18nTextarea label="설명" value={stop.description} onChange={(v) => update(i, { description: v })} rows={2} />
            <I18nField label="현지 팁 (선택)" value={stop.tip} onChange={(v) => update(i, { tip: v })} optional />
          </div>

          <div className="mb-3">
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">네이버 지도 URL (선택)</label>
            <input
              type="url"
              value={stop.naver_map_url ?? ''}
              onChange={(e) => update(i, { naver_map_url: e.target.value || undefined })}
              placeholder="https://map.naver.com/..."
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
            />
          </div>

          <div className="mb-3">
            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">사진</p>
            <PhotoUploader
              tourId={tourId}
              bucket={`stops/${i}`}
              multiple={false}
              // P117 (2026-05-20): PhotoUploader Value = TourPhoto | TourPhoto[] | undefined.
              // stop.photo 는 string | TourPhoto | undefined → string 이면 legacy
              // 형식으로 wrap (legacy_public_path 보존), TourPhoto 면 그대로.
              value={typeof stop.photo === 'string'
                ? { url: stop.photo, legacy_public_path: stop.photo, alt: { ko: '', en: '', ja: '', zh: '' } }
                : stop.photo}
              onChange={(v) => update(i, { photo: v as TourStop['photo'] })}
            />
          </div>

          {i > 0 && (
            <div className="border-t border-gray-200 pt-3 mt-3">
              <p className="text-[10px] font-bold uppercase text-gray-500 mb-2">이전 stop 에서 이동</p>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={stop.transit_from_prev?.method ?? 'car'}
                  onChange={(e) => updateTransit(i, { method: e.target.value as TourTransit['method'] })}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
                >
                  <option value="walk">도보</option>
                  <option value="car">차량</option>
                  <option value="transit">대중교통</option>
                </select>
                <input
                  type="number"
                  value={stop.transit_from_prev?.minutes ?? 0}
                  onChange={(e) => updateTransit(i, { minutes: parseInt(e.target.value || '0', 10) })}
                  placeholder="분"
                  className="px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
                />
                <input
                  type="number"
                  step="0.1"
                  value={stop.transit_from_prev?.distance_km ?? ''}
                  onChange={(e) => updateTransit(i, { distance_km: e.target.value ? parseFloat(e.target.value) : undefined })}
                  placeholder="km"
                  className="px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
