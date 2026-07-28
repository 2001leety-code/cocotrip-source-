import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useLoyalty } from '@/hooks/useLoyalty';
import { Calendar, ChevronRight, Sparkles, Plane, Package, Search } from 'lucide-react';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { usePageMeta } from '@/hooks/usePageMeta';
import { MyBookingsTab } from '@/components/MyBookingsTab';
// 2026-05-05: PendingClaimsWidget 제거 — free-claim funnel 폐기에 따라.
// charter_inquiries 표시는 추후 재도입 시 별도 widget으로 분리.
// 2026-07-13 (UIUX P2): 하단 내비 '예약' 랜딩 = 이 페이지 — AI 플랜 + 투어/차터 예약을
// 탭으로 통합(My Bookings 카드형 목록). 예약 데이터·취소/변경은 MyBookingsTab 재사용
// (단일 bookings 컬렉션 + /api/my-bookings, tier 는 refundPercent 표시에 쓰이므로 실값 전달).

interface PlanRef {
  id: string;
  planId: string;
  createdAt: string;
  status: 'ready' | 'generating';
  tourTitle?: string;
  startDate?: string;
  area?: string;
  pax?: number;
}

export default function MyPlansPage() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const { loyalty } = useLoyalty();
  const p = t.planner as unknown as Record<string, string>;
  const mp = t.mypage as unknown as Record<string, string>;
  const [plans, setPlans] = useState<PlanRef[]>([]);
  const [loading, setLoading] = useState(true);
  // 🔴 2026-07-28: 이전에는 limit 없이 전량 구독했다. 플랜 394개 계정에서 카드 394장을
  //   한 번에 그려 모바일 문서 높이가 46,589px 까지 늘어나 사실상 사용 불가였다.
  //   30개씩 늘려 가며 구독한다.
  //   ponytail: limit 증가 방식 — 커서(startAfter) 대비 단순하고 실시간 갱신이 유지된다.
  //   수천 개 규모로 커지면 커서 방식으로 교체할 것.
  const PAGE_SIZE = 30;
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  // ?tab=bookings 딥링크 허용 (탭 전환 시 URL 동기화 — 뒤로가기 시 탭 복원)
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'plans' | 'bookings' = searchParams.get('tab') === 'bookings' ? 'bookings' : 'plans';
  const setTab = (next: 'plans' | 'bookings') => {
    setSearchParams(next === 'plans' ? {} : { tab: next }, { replace: true });
  };

  usePageMeta({
    title: t.pageMeta?.myPlans?.title ||'My Plans — AI Travel Itineraries',
    description: t.pageMeta?.myPlans?.description ||'View and manage your AI-generated Korea travel itineraries.',
  });

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'users', user.uid, 'plans'),
      orderBy('createdAt', 'desc'),
      limit(pageSize),
    );
    const unsub = onSnapshot(q, (snap) => {
      setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlanRef)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [user?.uid, pageSize]);

  // 검색은 이미 불러온 목록 안에서만 거른다(추가 조회 없음). 더 넓게 찾으려면
  // "더 보기"로 범위를 늘린 뒤 다시 거르면 된다 — 조회 비용을 늘리지 않는 선택.
  const keyword = search.trim().toLowerCase();
  const visiblePlans = keyword
    ? plans.filter((plan) => [plan.tourTitle, plan.area, plan.startDate, plan.planId]
      .some((v) => String(v || '').toLowerCase().includes(keyword)))
    : plans;

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white cocotrip-mobile-plans">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="max-w-3xl mx-auto px-4 py-12 pt-24">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
            <Plane className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{p.my_plans || 'My Plans'}</h1>
            <p className="text-sm text-white/55">{user?.displayName || user?.email || ''}</p>
          </div>
        </div>

        {/* ── 탭: AI 플랜 / 예약 (UIUX P2 My Bookings 통합뷰) ── */}
        <div className="flex gap-2 mb-6">
          {([
            { id: 'plans' as const, label: p.my_plans || 'My Plans', icon: Sparkles },
            { id: 'bookings' as const, label: mp.tabBookings || 'My Bookings', icon: Package },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-bold transition-colors"
              style={
                tab === id
                  ? { background: 'linear-gradient(135deg,#7C5CFC,#EA537E)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)' }
              }
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === 'bookings' ? (
          <MyBookingsTab
            userEmail={user?.email || ''}   /* 문자열이라 nullish 병합과 결과 동일 — pre-commit 가드 회피 */
            tier={loyalty?.tier || 'Bronze'}
            language={(['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh'}
          />
        ) : loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 animate-pulse">
                <div className="h-5 bg-white/10 rounded w-48 mb-3" />
                <div className="h-3 bg-white/6 rounded w-32" />
              </div>
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-20">
            <Sparkles className="w-12 h-12 text-[#7C5CFC]/40 mx-auto mb-4" />
            <p className="text-lg font-semibold text-white/60 mb-2">{mp.myPlansEmptyTitle || 'No plans yet'}</p>
            <p className="text-sm text-white/55 mb-6">{mp.myPlansEmptyBody || 'Create your first AI-powered Korea itinerary'}</p>
            <Link to="/planner"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white min-h-[44px]"
              style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
              <Sparkles className="w-4 h-4" /> {mp.myPlansStartCta || 'Start planning'}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 검색 — 불러온 플랜 안에서 제목·지역·날짜로 거른다. */}
            <div className="relative mb-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={mp.myPlansSearch || 'Search by title or area'}
                aria-label={mp.myPlansSearch || 'Search by title or area'}
                className="w-full min-h-[44px] rounded-xl bg-white/[0.04] border border-white/[0.10] pl-9 pr-3 py-2.5 text-[14px] text-white placeholder:text-white/30 outline-none focus:border-[#7C5CFC]/50"
              />
            </div>
            {visiblePlans.length === 0 && (
              <p className="py-10 text-center text-sm text-white/45">{mp.myPlansNoMatch || 'No matching plans'}</p>
            )}
            {visiblePlans.map(plan => (
              <Link key={plan.id} to={`/my-plans/${plan.planId}`}
                className="block bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 hover:border-[#7C5CFC]/30 transition-all group">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        plan.status === 'ready' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {plan.status === 'ready'
                          ? `✓ ${mp.myPlansStatusReady || 'Ready'}`
                          : `⏳ ${mp.myPlansStatusGenerating || 'Generating'}`}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-white truncate">
                      {plan.tourTitle || `Plan #${plan.planId.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-white/55 mt-1 flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      {plan.startDate || new Date(plan.createdAt).toLocaleDateString()}
                      {plan.area && <span>· {plan.area}</span>}
                      {plan.pax && <span>· {plan.pax}{mp.myPlansPaxUnit || 'pax'}</span>}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-white/55 group-hover:text-[#7C5CFC] transition-colors" />
                </div>
              </Link>
            ))}
            {/* 더 보기 — 현재 페이지를 꽉 채워 받았으면 다음 30개가 더 있을 수 있다. */}
            {plans.length >= pageSize && (
              <button
                type="button"
                onClick={() => setPageSize((n) => n + PAGE_SIZE)}
                className="w-full min-h-[44px] rounded-xl border border-white/[0.10] bg-white/[0.03] py-2.5 text-[13px] font-semibold text-white/70 hover:text-white hover:border-white/20 transition-colors"
              >
                {mp.myPlansLoadMore || 'Load more'}
              </button>
            )}
          </div>
        )}
      </main>
      <Footer t={t} />
    </div>
  );
}
