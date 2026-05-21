// PainpointsTab — 탭 ⑧ User Painpoints (Reddit r/koreatravel etc)
// city 매칭 painpoint top 5 — block tweak 운영자 참고용.
import { useState, useEffect } from 'react';
import { MessageSquare, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { ZoneCourseDoc } from '@/lib/zone-courses-firestore';
import { useAuth } from '@/hooks/useAuth';
import { fetchTrendHints, type PainpointHint } from '@/lib/zone-courses-trend';

interface Props {
  draft: Partial<ZoneCourseDoc>;
}

export function PainpointsTab({ draft }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [painpoints, setPainpoints] = useState<PainpointHint[]>([]);
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
      setPainpoints(data.painpoints);
      setNotices(data.notices);
      setLoaded(true);
    } catch (err) {
      toast.error(`painpoints 로드 실패: ${err instanceof Error ? err.message : 'unknown'}`);
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
            <MessageSquare className="w-3.5 h-3.5" />
            {draft.city.toUpperCase()} 의 외국인 painpoint — Reddit (r/koreatravel + r/Korea + r/seoul) 1주 hot top 5.
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            이 zone 의 stops 조정 참고용. 예: "wheelchair access 어렵다" → Unsuitable 에 wheelchair_user 추가 검토.
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

      {!loading && painpoints.length === 0 && loaded && (
        <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
          {draft.city.toUpperCase()} 매칭 painpoint 가 아직 없습니다.
        </div>
      )}

      {painpoints.length > 0 && (
        <ul className="space-y-2">
          {painpoints.map((p) => (
            <li key={p.reddit_post_id} className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-800 line-clamp-2">{p.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] font-bold text-[#FF4500] bg-[#FF4500]/5 px-1.5 py-0.5 rounded-full">
                      r/{p.subreddit}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      ↑ {p.score.toLocaleString()} · 💬 {p.comments_count.toLocaleString()}
                    </span>
                    {p.detected_categories?.slice(0, 3).map((c) => (
                      <span key={c} className="text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-gray-400 hover:text-[#7C5CFC] shrink-0"
                    title="Reddit 원문 열기"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              {p.selftext && (
                <p className="text-[11px] text-gray-600 line-clamp-3 leading-relaxed">
                  {p.selftext}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
