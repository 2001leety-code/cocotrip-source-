// TransitMatrixTab — 탭 ③ Transit Matrix view + Rebuild
// stop[1]→[2], [2]→[3] ... 자동 생성. 운영자가 수동 편집 X (Naver+ODsay 자동).
import { useState } from 'react';
import { RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import type { ZoneCourseTransit } from '@/data/zone_courses/types';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';
import { useAuth } from '@/hooks/useAuth';
import { rebuildTransit } from '@/lib/zone-courses-trend';

interface Props {
  draft: Partial<ZoneCourseDoc>;
  onChange: (patch: Partial<ZoneCourseDoc>) => void;
}

function modeIcon(mode: ZoneCourseTransit['mode']): string {
  switch (mode) {
    case 'walk': return '🚶';
    case 'subway': return '🚇';
    case 'bus': return '🚌';
    case 'taxi': return '🚕';
    default: return '🔁';
  }
}

function sourceColor(source: ZoneCourseTransit['source']): string {
  if (source === 'odsay_api') return 'text-green-700 bg-green-50';
  if (source === 'cached') return 'text-blue-700 bg-blue-50';
  if (source === 'manual') return 'text-gray-700 bg-gray-100';
  return 'text-amber-700 bg-amber-50'; // mock
}

export function TransitMatrixTab({ draft, onChange }: Props) {
  const { user } = useAuth();
  const [rebuilding, setRebuilding] = useState(false);
  const matrix = draft.transit_matrix || {};
  const stops = draft.stops || [];

  // 연속 pair 키 생성: "1->2", "2->3" ...
  const pairs: Array<{ key: string; from: number; to: number }> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    pairs.push({ key: `${a.order}->${b.order}`, from: a.order, to: b.order });
  }

  const stopName = (order: number): string => {
    const s = stops.find((x) => x.order === order);
    return s?.name || `Stop ${order}`;
  };

  const handleRebuild = async () => {
    if (!user) {
      toast.error('로그인이 필요합니다.');
      return;
    }
    if (!draft.id) {
      toast.error('블록 ID 를 먼저 입력해주세요.');
      return;
    }
    if (stops.length < 2) {
      toast.error('Stops 2 개 이상 필요합니다.');
      return;
    }
    setRebuilding(true);
    try {
      const result = await rebuildTransit(user, {
        blockId: draft.id,
        stops: stops.map((s) => ({
          order: s.order,
          name: s.name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          stay_min: s.stay_min,
        })),
      });
      // updated_stops 가 있으면 lat/lng patch
      let nextStops = stops;
      if (result.updated_stops?.length) {
        nextStops = stops.map((s) => {
          const u = result.updated_stops!.find((x) => x.order === s.order);
          if (!u) return s;
          return {
            ...s,
            lat: typeof u.lat === 'number' ? u.lat : s.lat,
            lng: typeof u.lng === 'number' ? u.lng : s.lng,
          };
        });
      }
      // duration_min 자동 계산 (모든 stop stay_min + matrix duration_min 합)
      let total = 0;
      for (const s of nextStops) total += s.stay_min || 0;
      for (const entry of Object.values(result.transit_matrix)) total += entry.duration_min || 0;

      onChange({
        stops: nextStops,
        transit_matrix: result.transit_matrix,
        duration_min: total,
      });

      if (result.notices.length > 0) {
        toast.warning(`Rebuild 완료 (${result.notices.length} notice)`, {
          description: result.notices.join(' / '),
        });
      } else {
        toast.success('Transit Matrix 재생성 완료');
      }
    } catch (err) {
      toast.error(`Rebuild 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">
            연속 Stop pair 간 이동 자동 계산. ODsay Transit API + Naver Geocoding 사용.
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            API key 부재 시 mock 폴백 (haversine 거리 기반 15분 default + 'manual verification needed' notice).
          </p>
        </div>
        <button
          type="button"
          onClick={handleRebuild}
          disabled={rebuilding || stops.length < 2}
          className="flex items-center gap-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 px-3 py-1.5 rounded-lg hover:bg-[#7C5CFC]/10 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
          {rebuilding ? 'Rebuild 중...' : 'Rebuild Transit'}
        </button>
      </div>

      {pairs.length === 0 && (
        <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
          Stops 2 개 이상 추가 후 Rebuild 가능합니다.
        </div>
      )}

      {pairs.map(({ key, from, to }) => {
        const entry = matrix[key];
        return (
          <div key={key} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-gray-800">
                {stopName(from)} <span className="text-gray-400 mx-2">→</span> {stopName(to)}
              </div>
              {entry ? (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sourceColor(entry.source)}`}>
                  {entry.source}
                </span>
              ) : (
                <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  미생성
                </span>
              )}
            </div>

            {entry && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div>
                  <div className="text-gray-400 uppercase">방식</div>
                  <div className="font-semibold text-gray-700">
                    {modeIcon(entry.mode)} {entry.mode}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 uppercase">시간</div>
                  <div className="font-semibold text-gray-700">{entry.duration_min} 분</div>
                </div>
                <div>
                  <div className="text-gray-400 uppercase">거리</div>
                  <div className="font-semibold text-gray-700">
                    {entry.distance_m >= 1000
                      ? `${(entry.distance_m / 1000).toFixed(1)} km`
                      : `${entry.distance_m} m`}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 uppercase">비용</div>
                  <div className="font-semibold text-gray-700">
                    {entry.cost_krw ? `₩${entry.cost_krw.toLocaleString()}` : '무료'}
                  </div>
                </div>
              </div>
            )}

            {entry?.notes && (
              <p className="mt-2 text-[10px] text-amber-700 bg-amber-50/50 px-2 py-1 rounded">
                {entry.notes}
              </p>
            )}

            {entry?.naver_route_url && (
              <a
                href={entry.naver_route_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#7C5CFC] hover:underline"
              >
                네이버 길찾기 열기 <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
