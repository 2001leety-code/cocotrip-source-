// TrendHintsTab — 탭 ⑦ Trend Hints (rising_spots / user_painpoints)
// Track B (PR #511) 의 cron 결과를 fetch. block.zone 기준 city 일치 spot 표시.
import { useState, useEffect } from 'react';
import { TrendingUp, Plus, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { ZoneCourseStop } from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';
import { useAuth } from '@/hooks/useAuth';
import { fetchTrendHints, type RisingSpotHint } from '@/lib/zone-courses-trend';

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

export function TrendHintsTab({ draft, onChange }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rising, setRising] = useState<RisingSpotHint[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (!user || !draft.city) return;
    setLoading(true);
    try {
      const data = await fetchTrendHints(user, {
        city: draft.city,
        zone: draft.zone,
      });
      setRising(data.rising);
      setNotices(data.notices);
      setLoaded(true);
    } catch (err) {
      toast.error(`hints 로드 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (draft.city && !loaded && !loading) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.city, draft.zone]);

  const addAsStop = (hint: RisingSpotHint) => {
    const existingStops = draft.stops || [];
    const lat = hint.spotId ? 0 : 0; // mapy/mapx 는 trend cron 응답에 있을 수도 있지만 보수적으로 0
    const newStop: ZoneCourseStop = {
      order: existingStops.length + 1,
      category: 'culture',
      name: hint.name,
      name_i18n: { ko: hint.name, en: '', ja: '', zh: '' },
      address: hint.address || '',
      lat,
      lng: 0,
      start_time_offset_min: 0,
      stay_min: 60,
      entry_fee_krw: 0,
      reservation_required: false,
    };
    onChange({ stops: [...existingStops, newStop] });
    toast.success(`"${hint.name}" stop 추가 완료. Transit Matrix 에서 Rebuild 권장.`);
  };

  if (!draft.city) {
    return (
      <div className="text-center py-12 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
        도시(city)를 먼저 선택해주세요. (Basic 탭)
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            {draft.city.toUpperCase()} 의 rising hotspots — Naver Local rating/reviewCount delta.
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Track B trend cron (PR #511) 결과. 매주 일요일 갱신. delta 큰 순으로 top 10.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-[#7C5CFC]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      {notices.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <ul className="text-[11px] text-amber-700 space-y-0.5">
            {notices.map((n, i) => <li key={i}>• {n}</li>)}
          </ul>
        </div>
      )}

      {loading && (
        <div className="text-center py-8 text-xs text-gray-400">불러오는 중...</div>
      )}

      {!loading && rising.length === 0 && loaded && (
        <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
          {draft.city.toUpperCase()} 의 rising spot 이 아직 없습니다. <br />
          (trend cron 첫 실행 후 2주차부터 delta 신호 누적)
        </div>
      )}

      {rising.length > 0 && (
        <ul className="space-y-2">
          {rising.map((hint) => (
            <li key={hint.spotId} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-bold text-gray-800 truncate">{hint.name}</p>
                  {hint.rating_delta && hint.rating_delta > 0 && (
                    <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
                      ★ +{hint.rating_delta.toFixed(2)}
                    </span>
                  )}
                  {hint.reviewCount_delta && hint.reviewCount_delta > 0 && (
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">
                      💬 +{hint.reviewCount_delta}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 truncate">
                  {hint.address || hint.query} {hint.rating ? `· ★ ${hint.rating}` : ''} {hint.reviewCount ? `· ${hint.reviewCount} 리뷰` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {hint.link && (
                  <a
                    href={hint.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-gray-400 hover:text-[#7C5CFC]"
                    title="네이버 정보 열기"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => addAsStop(hint)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10"
                >
                  <Plus className="w-3 h-3" />
                  Stops 에 추가
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
