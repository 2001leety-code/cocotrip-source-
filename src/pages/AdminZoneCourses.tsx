// ─────────────────────────────────────────────────────────────────────────────
// AdminZoneCourses — 어드민 zone_courses 목록 (Track C, 2026-05-21)
//   /admin/zone-courses
//   Firestore zone_courses 컬렉션의 모든 block (draft/published/archived) 노출
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import {
  Plus, ArrowLeft, RefreshCw, Eye, EyeOff, MapPin, Edit2, Map as MapIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { ZoneCourseCity, ZoneCourseSource } from '@/data/zone_courses/types';
import {
  fetchZoneCoursesList, type ZoneCourseDoc, type ZoneCourseStatus,
} from '@/lib/zone-courses-firestore';

const CITY_FILTERS: Array<ZoneCourseCity | 'all'> = [
  'all',
  // 서울권
  'seoul', 'suwon',
  // 부산/경상
  'busan', 'gyeongju', 'andong', 'daegu', 'pohang', 'gyeongsang',
  // 제주
  'jeju',
  // 전라
  'jeonju',
  // 강원
  'gangneung', 'sokcho', 'gangwon',
  // 충청
  'daejeon', 'chungcheong',
];

const CITY_LABEL: Record<string, string> = {
  all: '전체',
  seoul: '서울', suwon: '수원',
  busan: '부산', gyeongju: '경주', andong: '안동', daegu: '대구', pohang: '포항', gyeongsang: '경상',
  jeju: '제주',
  jeonju: '전주',
  gangneung: '강릉', sokcho: '속초', gangwon: '강원',
  daejeon: '대전', chungcheong: '충청',
};

const SOURCE_FILTERS: Array<ZoneCourseSource | 'all'> = [
  'all', 'cocotrip_curated', 'operator_verified', 'user_validated',
];

const SOURCE_LABEL: Record<string, string> = {
  all: '전체',
  cocotrip_curated: '코코트립 큐레이션',
  operator_verified: '오퍼레이터 검증',
  user_validated: '사용자 검증',
};

function statusBadge(s: ZoneCourseStatus | undefined) {
  const cfg = {
    draft:     { bg: 'bg-amber-50',   text: 'text-amber-700',  label: '초안', icon: EyeOff },
    published: { bg: 'bg-green-50',   text: 'text-green-700',  label: '발행됨', icon: Eye },
    archived:  { bg: 'bg-gray-100',   text: 'text-gray-600',   label: '보관됨', icon: EyeOff },
  }[s || 'draft'];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${cfg.bg} ${cfg.text} px-2 py-0.5 rounded-full text-[10px] font-bold`}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

export default function AdminZoneCourses() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<ZoneCourseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [cityFilter, setCityFilter] = useState<ZoneCourseCity | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<ZoneCourseSource | 'all'>('all');

  const reload = async () => {
    setLoading(true);
    try {
      const list = await fetchZoneCoursesList({
        city: cityFilter,
        source: sourceFilter,
      });
      setItems(list);
    } catch (err) {
      toast.error(`불러오기 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, cityFilter, sourceFilter]);

  const counts = useMemo(() => {
    const c = { total: items.length, draft: 0, published: 0, archived: 0 };
    for (const it of items) {
      const s = it.status || 'draft';
      c[s] += 1;
    }
    return c;
  }, [items]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-sm text-gray-500">
        불러오는 중...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-sm text-gray-500">
        로그인이 필요합니다.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] p-4 sm:p-6">
      <Toaster position="top-center" richColors />

      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="p-1.5 rounded-lg hover:bg-gray-100"
              title="어드민 홈"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#1a1a2e]">존 코스 관리</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                AI 플래너 day-block — 동선 검증된 zone 별 코스 사전 큐레이션
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-[#7C5CFC]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/zone-courses/new')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#7C5CFC] rounded-xl hover:bg-[#6b4ce0]"
            >
              <Plus className="w-4 h-4" />
              새 코스 작성
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { label: '전체', value: counts.total, color: 'text-gray-800' },
            { label: '발행됨', value: counts.published, color: 'text-green-700' },
            { label: '초안', value: counts.draft, color: 'text-amber-700' },
            { label: '보관됨', value: counts.archived, color: 'text-gray-500' },
          ] as const).map((c) => (
            <div key={c.label} className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-[11px] text-gray-500 mb-0.5">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* 필터 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold uppercase text-gray-500">도시</label>
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value as ZoneCourseCity | 'all')}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs"
            >
              {CITY_FILTERS.map((c) => (
                <option key={c} value={c}>{CITY_LABEL[c] || c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold uppercase text-gray-500">출처</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as ZoneCourseSource | 'all')}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs"
            >
              {SOURCE_FILTERS.map((s) => (
                <option key={s} value={s}>{SOURCE_LABEL[s] || s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              등록된 존 코스가 없습니다.
              <br />
              <button
                type="button"
                onClick={() => navigate('/admin/zone-courses/new')}
                className="mt-3 text-[#7C5CFC] underline"
              >
                첫 코스 작성하기
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((block) => (
                <BlockRow key={block._docId || block.id} block={block} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockRow({ block }: { block: ZoneCourseDoc }) {
  const navigate = useNavigate();
  const blockId = block._docId || block.id || '';

  return (
    <li className="px-4 sm:px-5 py-3 hover:bg-gray-50/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#7C5CFC]/5 flex items-center justify-center shrink-0">
          <MapIcon className="w-5 h-5 text-[#7C5CFC]" />
        </div>

        <button
          type="button"
          onClick={() => navigate(`/admin/zone-courses/edit/${blockId}`)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-sm font-bold text-[#1a1a2e] truncate">
              {block.theme || blockId}
            </p>
            {statusBadge(block.status)}
            {block.source && (
              <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
                {SOURCE_LABEL[block.source] || block.source}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 truncate">
            <span className="font-mono">{blockId}</span>
            {' · '}
            <span>{CITY_LABEL[block.city || ''] || block.city || '?'}</span>
            {' · '}
            <span>{block.zone || '?'}</span>
            {' · '}
            <span>{block.intensity || '?'}</span>
            {block.duration_min && (
              <> {' · '} <span>{Math.round(block.duration_min / 60 * 10) / 10}h</span></>
            )}
            {block.stops && (
              <> {' · '} <span><MapPin className="w-2.5 h-2.5 inline" /> {block.stops.length}개 정류지</span></>
            )}
          </p>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => navigate(`/admin/zone-courses/edit/${blockId}`)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10"
          >
            <Edit2 className="w-3 h-3" />
            편집
          </button>
        </div>
      </div>
    </li>
  );
}
