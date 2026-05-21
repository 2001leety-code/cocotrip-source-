// StopsTab — 탭 ② Stops CRUD + drag-drop 순서.
// AdminProductEditor 의 StopsTab 패턴 재활용 (시각/체류시간 등 UI 골격 동일).
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type {
  ZoneCourseStop, ZoneCourseStopCategory,
  ZoneCourseFoodPlaceholder, ZoneCourseDietary,
} from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';
import { I18nField, I18nTextarea } from '@/components/admin/ProductEditor/I18nField';

const CATEGORY_OPTIONS: ZoneCourseStopCategory[] = [
  'culture', 'food', 'shopping', 'nature', 'lodging', 'transit', 'activity',
];

const PLACEHOLDER_OPTIONS: ZoneCourseFoodPlaceholder[] = [
  'verified_breakfast', 'verified_lunch', 'verified_dinner', 'verified_cafe',
];

const DIETARY_OPTIONS: ZoneCourseDietary[] = ['vegan', 'halal', 'vegetarian'];

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

function defaultStop(order: number): ZoneCourseStop {
  return {
    order,
    category: 'culture',
    name: '',
    name_i18n: { ko: '', en: '', ja: '', zh: '' },
    address: '',
    lat: 0,
    lng: 0,
    start_time_offset_min: 0,
    stay_min: 60,
    entry_fee_krw: 0,
    reservation_required: false,
  };
}

export function StopsTab({ draft, onChange }: Props) {
  const stops = draft.stops || [];

  const setStops = (next: ZoneCourseStop[]) => {
    // order 를 1-based 재정렬
    const normalized = next.map((s, idx) => ({ ...s, order: idx + 1 }));
    onChange({ stops: normalized });
  };

  const add = () => setStops([...stops, defaultStop(stops.length + 1)]);
  const remove = (i: number) => {
    if (!window.confirm(`Stop ${i + 1} 을 삭제할까요?`)) return;
    setStops(stops.filter((_, idx) => idx !== i));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
  };
  const update = (i: number, patch: Partial<ZoneCourseStop>) => {
    setStops(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const toggleDietary = (i: number, d: ZoneCourseDietary) => {
    const cur = stops[i].preferred_dietary || [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    update(i, { preferred_dietary: next.length > 0 ? next : undefined });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          순서대로 정렬. 좌표(lat/lng)는 Transit Matrix 탭의 "Rebuild Transit" 으로 자동 채움.
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
          아직 Stop 이 없습니다. 운영자가 6 개 내외로 작성.
        </div>
      )}

      {stops.map((stop, i) => (
        <div key={i} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-700">
              Stop {i + 1}
              {typeof stop.lat === 'number' && stop.lat !== 0 && (
                <span className="ml-2 text-[10px] font-normal text-green-600">
                  좌표 OK ({stop.lat.toFixed(4)}, {stop.lng.toFixed(4)})
                </span>
              )}
              {(stop.lat === 0 || stop.lat === undefined) && (
                <span className="ml-2 text-[10px] font-normal text-amber-600">
                  좌표 미입력 — Transit Rebuild 필요
                </span>
              )}
            </span>
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
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">카테고리</label>
              <select
                value={stop.category}
                onChange={(e) => update(i, { category: e.target.value as ZoneCourseStopCategory })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              >
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">체류 (분)</label>
              <input
                type="number"
                value={stop.stay_min}
                onChange={(e) => update(i, { stay_min: parseInt(e.target.value || '0', 10) || 0 })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">입장료 (KRW)</label>
              <input
                type="number"
                value={stop.entry_fee_krw || 0}
                onChange={(e) => update(i, { entry_fee_krw: parseInt(e.target.value || '0', 10) || 0 })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">
              한국어 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={stop.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="경복궁 (네이버맵 검색용)"
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
            />
          </div>

          <div className="space-y-3 mb-3">
            <I18nField label="다국어 이름" value={stop.name_i18n} onChange={(v) => update(i, { name_i18n: v })} translateContext="zone course stop 이름" />
            <I18nTextarea label="팁 (선택)" value={stop.tips_i18n} onChange={(v) => update(i, { tips_i18n: v })} rows={2} optional translateContext="zone course stop 팁" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">주소 (Naver Geocoding 입력)</label>
              <input
                type="text"
                value={stop.address}
                onChange={(e) => update(i, { address: e.target.value })}
                placeholder="서울특별시 종로구 사직로 161"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Naver Place ID (선택)</label>
              <input
                type="text"
                value={stop.naver_place_id || ''}
                onChange={(e) => update(i, { naver_place_id: e.target.value || undefined })}
                placeholder="11538993"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">위도 (lat)</label>
              <input
                type="number"
                step="0.000001"
                value={stop.lat || 0}
                onChange={(e) => update(i, { lat: parseFloat(e.target.value || '0') })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">경도 (lng)</label>
              <input
                type="number"
                step="0.000001"
                value={stop.lng || 0}
                onChange={(e) => update(i, { lng: parseFloat(e.target.value || '0') })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 pt-3 border-t border-gray-200">
            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Placeholder (선택)</label>
              <select
                value={stop.placeholder || ''}
                onChange={(e) => update(i, {
                  placeholder: (e.target.value || undefined) as ZoneCourseFoodPlaceholder | undefined,
                })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
              >
                <option value="">없음 (구체 이름)</option>
                {PLACEHOLDER_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">설정 시 AI 플래너가 식이 제약에 맞춰 채움.</p>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">선호 식이</label>
              <div className="flex gap-1.5 flex-wrap">
                {DIETARY_OPTIONS.map((d) => {
                  const checked = (stop.preferred_dietary || []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDietary(i, d)}
                      className={`px-2 py-1 rounded-full text-[10px] ${
                        checked
                          ? 'bg-[#7C5CFC]/10 text-[#7C5CFC] border border-[#7C5CFC]/30'
                          : 'bg-white text-gray-500 border border-gray-200'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-gray-700">
            <input
              type="checkbox"
              checked={!!stop.reservation_required}
              onChange={(e) => update(i, { reservation_required: e.target.checked })}
            />
            사전 예약 필요
          </div>
        </div>
      ))}
    </div>
  );
}
