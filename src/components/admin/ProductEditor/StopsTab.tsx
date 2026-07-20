// StopsTab — 탭 ③ 일정 (TourStop[] 시간순 list)
//
// 좌표(lat/lng)는 투어 상세 지도(TourStopMap → CourseMiniMap)가 핀을 찍는 유일한 근거다.
// 정적 9투어는 좌표를 코드에 백필했지만(PR#1157) Firestore 등록 투어는 입력 수단이 없어
// 지도가 아예 안 떴다. 여기서 ①직접 입력 ②이름으로 검색해 자동 채움 둘 다 제공한다.
//
// ⚠️ 자동 채움은 네이버 지역검색(업소 디렉터리)이라 랜드마크에 엉뚱한 상점이 걸릴 수 있다
//    ("경복궁" → 사당동 한정식집). 그래서 자동 확정하지 않고 **후보를 보여주고 사람이 고른다** +
//    하단 지도 미리보기로 위치를 눈으로 확인시킨다.
import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, MapPin, Loader2, Search, X } from 'lucide-react';
import type { Tour, TourStop, TourTransit } from '@/data/tours';
import { I18nField, I18nTextarea } from './I18nField';
import { PhotoUploader } from '@/components/admin/PhotoUploader';
import { TourStopMap } from '@/components/tours/TourStopMap';
import { searchPlaces, toPlaceQuery, type PlaceSearchItem } from '@/lib/placeSearch';
import {
  hasStopCoords, parseCoordInput, countStopsWithCoords, MIN_STOPS_FOR_MAP,
} from '@/lib/tourStopCoords';

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
  const stops = draft.stops || [];
  const setStops = (next: TourStop[]) => onChange({ stops: next });

  // 좌표 검색 상태 — 한 번에 한 stop 만 (searchIdx = 검색창이 열린 stop index).
  const [searchIdx, setSearchIdx] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceSearchItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const closeSearch = () => {
    setSearchIdx(null);
    setResults([]);
    setSearchError(null);
    setSearching(false);
  };

  const add = () => setStops([...stops, defaultStop()]);
  const remove = (i: number) => {
    if (!window.confirm('이 스톱을 삭제할까요?')) return;
    setStops(stops.filter((_, idx) => idx !== i));
    if (searchIdx === i) closeSearch();
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    setStops(next);
    if (searchIdx !== null) closeSearch(); // 순서가 바뀌면 열린 검색창의 index 가 어긋난다
  };
  const update = (i: number, patch: Partial<TourStop>) => {
    setStops(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const updateTransit = (i: number, patch: Partial<TourTransit>) => {
    const prev = stops[i].transit_from_prev;
    update(i, {
      transit_from_prev: { ...(prev || { method: 'car', minutes: 10 }), ...patch },
    });
  };

  const runSearch = async (i: number) => {
    const stop = stops[i];
    // 어드민은 한국어로 등록하므로 ko 이름이 검색 정확도가 제일 높다(현지 상호명 그대로).
    const query = toPlaceQuery(stop.name?.ko || stop.name?.en || '');
    setSearchIdx(i);
    setResults([]);
    if (query.length < 2) {
      setSearchError('stop 이름(한국어)을 먼저 입력해주세요.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    const { items, error } = await searchPlaces(query, { limit: 5, lang: 'ko' });
    setSearching(false);
    if (error) {
      setSearchError('검색 실패. 잠시 후 다시 시도하거나 좌표를 직접 입력하세요.');
      return;
    }
    if (items.length === 0) {
      setSearchError(`"${query}" 검색 결과가 없습니다. 좌표를 직접 입력하세요.`);
      return;
    }
    setResults(items);
  };

  const pickResult = (i: number, item: PlaceSearchItem) => {
    update(i, { lat: item.lat, lng: item.lng });
    closeSearch();
  };

  const coordCount = countStopsWithCoords(stops);

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

      {stops.length > 0 && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
          <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="text-gray-600">
            좌표 입력됨 <b className="text-gray-800">{coordCount}</b> / {stops.length}
          </span>
          {coordCount < MIN_STOPS_FOR_MAP && (
            <span className="text-gray-400">— 2곳 이상이어야 투어 상세에 지도가 뜹니다.</span>
          )}
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
                value={stop.entry_fee_krw || 0}
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

          {/* 좌표 — 투어 상세 지도의 핀 근거 */}
          <div className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <label className="block text-[10px] font-bold uppercase text-gray-500">
                좌표 (지도 핀)
              </label>
              <div className="flex items-center gap-2">
                {hasStopCoords(stop) ? (
                  <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> 핀 표시됨
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-400">좌표 없음 — 지도에서 생략</span>
                )}
                <button
                  type="button"
                  onClick={() => (searchIdx === i ? closeSearch() : runSearch(i))}
                  className="flex items-center gap-1 text-[10px] font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 px-2 py-1 rounded-md hover:bg-[#7C5CFC]/10"
                >
                  {searching && searchIdx === i
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Search className="w-3 h-3" />}
                  이름으로 찾기
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                step="0.000001"
                value={Number.isFinite(stop.lat) ? stop.lat : ''}
                onChange={(e) => update(i, { lat: parseCoordInput(e.target.value) })}
                placeholder="위도 37.5796"
                aria-label={`Stop ${i + 1} 위도`}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
              <input
                type="number"
                step="0.000001"
                value={Number.isFinite(stop.lng) ? stop.lng : ''}
                onChange={(e) => update(i, { lng: parseCoordInput(e.target.value) })}
                placeholder="경도 126.9770"
                aria-label={`Stop ${i + 1} 경도`}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>

            {searchIdx === i && (searching || searchError || results.length > 0) && (
              <div className="mt-2 border border-[#7C5CFC]/25 rounded-lg bg-white overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
                  <span className="text-[10px] font-bold text-gray-500">
                    검색 결과 — 맞는 장소를 고르세요
                  </span>
                  <button type="button" onClick={closeSearch} aria-label="검색 닫기"
                    className="p-0.5 rounded hover:bg-gray-100">
                    <X className="w-3 h-3 text-gray-400" />
                  </button>
                </div>
                {searching && (
                  <div className="px-3 py-3 text-xs text-gray-500 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> 검색 중...
                  </div>
                )}
                {!searching && searchError && (
                  <div className="px-3 py-3 text-xs text-amber-600">{searchError}</div>
                )}
                {!searching && !searchError && results.map((item, ri) => (
                  <button
                    key={`${item.name}-${ri}-${item.lat}-${item.lng}`}
                    type="button"
                    onClick={() => pickResult(i, item)}
                    className="w-full text-left px-3 py-2 hover:bg-[#7C5CFC]/5 border-t border-gray-100 flex items-start gap-2"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#7C5CFC] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {item.roadAddress || item.address}
                      </p>
                      {item.category && (
                        <p className="text-[10px] text-gray-400 truncate">{item.category}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mb-3">
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">네이버 지도 URL (선택)</label>
            <input
              type="url"
              value={stop.naver_map_url || ''}
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
                  value={stop.transit_from_prev?.method || 'car'}
                  onChange={(e) => updateTransit(i, { method: e.target.value as TourTransit['method'] })}
                  className="px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
                >
                  <option value="walk">도보</option>
                  <option value="car">차량</option>
                  <option value="transit">대중교통</option>
                </select>
                <input
                  type="number"
                  value={stop.transit_from_prev?.minutes || 0}
                  onChange={(e) => updateTransit(i, { minutes: parseInt(e.target.value || '0', 10) })}
                  placeholder="분"
                  className="px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
                />
                <input
                  type="number"
                  step="0.1"
                  value={Number.isFinite(stop.transit_from_prev?.distance_km) ? stop.transit_from_prev?.distance_km : ''}
                  onChange={(e) => updateTransit(i, { distance_km: e.target.value ? parseFloat(e.target.value) : undefined })}
                  placeholder="km"
                  className="px-2.5 py-1.5 border border-gray-200 rounded-md text-xs"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      {/* 미리보기 — 손님이 투어 상세에서 볼 지도와 같은 컴포넌트를 그대로 쓴다.
          검색이 엉뚱한 곳을 물어왔을 때(동명 상점) 눈으로 잡아내는 장치.
          CourseMiniMap 이 다크 테마라 카드도 어둡게 — 손님 화면과 같은 모습이라는 신호. */}
      {coordCount >= MIN_STOPS_FOR_MAP && (
        <div className="rounded-xl p-4 bg-[#12071d] border border-gray-200">
          <p className="text-[10px] font-bold uppercase text-white/45 mb-2">
            지도 미리보기 — 손님 화면과 동일
          </p>
          <TourStopMap stops={stops} language="ko" title="투어 동선" />
        </div>
      )}
    </div>
  );
}
