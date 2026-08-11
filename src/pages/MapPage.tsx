// MapPage (/map) — 독립 경로 지도 화면 (2026-07-19 모바일 UI 리디자인 Task 2).
// 기준 이미지 p.4 'Interactive Route Map' 을 실데이터로 구현: 내 최신 AI 플랜의
// day 별 경로 지도(DayRouteMap 재사용 — Leaflet 은 해당 컴포넌트의 lazy chunk) +
// 번호 정거장 리스트. 플랜 여러 개면 최근 5개 칩으로 전환.
// 비로그인/플랜 없음 = 빈 상태도 제품처럼 (플래너·투어 CTA). "죽은 탭 금지" 원칙의
// Map 탭 선행 화면. 모바일 라이트는 planner-detail-mobile-ai 셸 재사용(PlanDetail 과 동일).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { DayRouteMap } from '@/pages/PlanDetailPage/components/DayRouteMap';
import type { PlanDay } from '@/pages/PlanDetailPage/types';
import { GradientCTA, CocoCard } from '@/components/coco/CocoUI';
import { Map as MapIcon, Sparkles, Package, ChevronRight, LogIn } from 'lucide-react';

interface PlanRef {
  id: string;
  planId: string;
  createdAt: string;
  status: 'ready' | 'generating';
  tourTitle?: string;
  startDate?: string;
}

/** 화면 문구 — 4언어 (신규 화면이라 t 네임스페이스 대신 로컬 사전, CharterWizard 관례). */
const MAP_I18N = {
  en: {
    title: 'Route Map',
    subtitle: 'Your itinerary, route by route',
    day: 'Day',
    openPlan: 'Open full itinerary',
    noPlansTitle: 'No routes to show yet',
    noPlansBody: 'Build a Korea itinerary and your daily routes appear here — real places with the subway, bus and walking legs between them, on one map.',
    startPlanner: 'Start Trip Planner',
    browseTours: 'Browse Tours',
    signInTitle: 'Sign in to see your routes',
    signInBody: 'The routes from your saved Korea itineraries are kept in your account.',
    signIn: 'Sign in',
    noCoords: 'This day has no mappable stops yet.',
    loading: 'Loading your routes…',
  },
  ko: {
    title: '경로 지도',
    subtitle: '내 일정을 지도 위 동선으로',
    day: 'Day',
    openPlan: '전체 일정 열기',
    noPlansTitle: '아직 표시할 동선이 없어요',
    noPlansBody: '한국 일정을 만들면 날짜별 동선이 지도에 나타납니다 — 실제 장소와 그 사이 지하철·버스·도보 구간까지.',
    startPlanner: '여행 플래너 시작',
    browseTours: '투어 둘러보기',
    signInTitle: '로그인하고 내 동선 보기',
    signInBody: '저장한 한국 일정의 경로는 계정에 보관돼 있어요.',
    signIn: '로그인',
    noCoords: '이 날은 지도에 표시할 좌표가 아직 없어요.',
    loading: '동선 불러오는 중…',
  },
  ja: {
    title: 'ルートマップ',
    subtitle: '旅程を地図の動線で',
    day: 'Day',
    openPlan: '旅程全体を開く',
    noPlansTitle: '表示できるルートがまだありません',
    noPlansBody: '韓国旅程を作成すると、日別の動線が地図に表示されます — 実際の場所と、その間の地下鉄・バス・徒歩区間まで。',
    startPlanner: '旅行プランナーを開始',
    browseTours: 'ツアーを見る',
    signInTitle: 'ログインしてルートを見る',
    signInBody: '保存した韓国旅程のルートはアカウントに保管されています。',
    signIn: 'ログイン',
    noCoords: 'この日は地図に表示できる座標がまだありません。',
    loading: 'ルートを読み込み中…',
  },
  zh: {
    title: '路线地图',
    subtitle: '把行程变成地图上的动线',
    day: 'Day',
    openPlan: '打开完整行程',
    noPlansTitle: '暂时没有可显示的路线',
    noPlansBody: '创建韩国行程后，每日动线会显示在地图上 — 真实地点，以及地点之间的地铁、公交与步行路段。',
    startPlanner: '开始行程规划',
    browseTours: '浏览旅游产品',
    signInTitle: '登录后查看我的路线',
    signInBody: '已保存的韩国行程路线保存在您的账户中。',
    signIn: '登录',
    noCoords: '这一天还没有可在地图上显示的坐标。',
    loading: '正在加载路线…',
  },
} as const;

export default function MapPage() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const isMobile = useIsMobile();
  const m = MAP_I18N[(language as keyof typeof MAP_I18N)] || MAP_I18N.en;

  const [refs, setRefs] = useState<PlanRef[]>([]);
  const [refsLoading, setRefsLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [days, setDays] = useState<PlanDay[]>([]);
  const [planTitle, setPlanTitle] = useState('');
  const [dayIdx, setDayIdx] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);

  usePageMeta({
    title: `${m.title} — CocoTrip`,
    description: m.subtitle,
  });

  // 최근 플랜 ref 로드 (ready 만, 최대 5개). where+orderBy 복합 인덱스 회피 — 클라이언트 필터.
  useEffect(() => {
    if (!user?.uid) { setRefs([]); setRefsLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'plans'),
          orderBy('createdAt', 'desc'),
          limit(10),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        const ready = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as PlanRef))
          .filter(r => r.status === 'ready' && r.planId)
          .slice(0, 5);
        setRefs(ready);
        setSelectedPlanId(prev => prev || (ready[0] ? ready[0].planId : null));
      } catch {
        if (!cancelled) setRefs([]);
      } finally {
        if (!cancelled) setRefsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // 선택 플랜 본문 로드 — 소유자 read 는 Firestore 룰 허용 경로 (PlanDetail 소유자 경로와 동일).
  useEffect(() => {
    if (!selectedPlanId || !user?.uid) return;
    let cancelled = false;
    setPlanLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'plans', selectedPlanId));
        if (cancelled) return;
        const data = snap.exists() ? snap.data() as Record<string, unknown> : null;
        const itinerary = (data && data.itinerary) as { days?: unknown; tour_title?: unknown } | undefined;
        // Firestore 문서는 런타임 스키마 무보증 — days 가 배열이 아니면 [] 로 방어(하위 .map/.filter 크래시 차단).
        const rawDays = itinerary && itinerary.days;
        setDays(Array.isArray(rawDays) ? (rawDays as PlanDay[]) : []);
        setPlanTitle(typeof (itinerary && itinerary.tour_title) === 'string' ? (itinerary!.tour_title as string) : '');
        setDayIdx(0);
      } catch {
        if (!cancelled) { setDays([]); setPlanTitle(''); }
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlanId, user?.uid]);

  const selectedDay = days[dayIdx];
  // stops 도 스키마 무보증 — 배열 아니면 빈 배열로 (지도·리스트 렌더 안전).
  const dayStops = Array.isArray(selectedDay && selectedDay.stops) ? selectedDay.stops! : [];
  const hasMappable = dayStops.filter(s => typeof s.lat === 'number' && typeof s.lng === 'number').length >= 2;

  return (
    <div className={isMobile
      ? 'planner-detail-mobile-ai min-h-screen text-[#15143d]'
      : 'min-h-screen bg-[#0a0b14] text-white'}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className={`mx-auto w-full px-4 pb-10 ${isMobile ? 'max-w-[430px] pt-20' : 'max-w-3xl pt-24'}`}>
        {/* 타이틀 */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: 'var(--coco-cta-gradient)' }}>
            <MapIcon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black leading-tight">{m.title}</h1>
            <p className="text-[12px] text-white/55">{m.subtitle}</p>
          </div>
        </div>

        {!user ? (
          /* 비로그인 빈 상태 */
          <CocoCard className="px-5 py-8 text-center">
            <LogIn className="mx-auto mb-3 h-9 w-9" style={{ color: 'var(--coco-purple)' }} />
            <p className="text-[15px] font-bold">{m.signInTitle}</p>
            <p className="mx-auto mt-1 max-w-[300px] text-[12px] leading-relaxed" style={{ color: 'var(--coco-muted)' }}>{m.signInBody}</p>
            <div className="mx-auto mt-5 flex max-w-[300px] flex-col gap-2">
              <GradientCTA to="/mypage" className="px-6">{m.signIn}</GradientCTA>
              <Link to="/planner" className="flex items-center justify-center gap-1.5 rounded-full border py-3 text-[13px] font-bold"
                style={{ borderColor: 'rgba(124,92,255,0.25)', color: 'var(--coco-purple)' }}>
                <Sparkles className="h-4 w-4" /> {m.startPlanner}
              </Link>
            </div>
          </CocoCard>
        ) : refsLoading ? (
          <CocoCard className="px-5 py-10 text-center">
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-[#7C5CFF] border-t-transparent" />
            <p className="text-[12.5px]" style={{ color: 'var(--coco-muted)' }}>{m.loading}</p>
          </CocoCard>
        ) : refs.length === 0 ? (
          /* 플랜 없음 빈 상태 — 제품처럼 (기준 p.4) */
          <CocoCard className="px-5 py-8 text-center">
            <MapIcon className="mx-auto mb-3 h-9 w-9" style={{ color: 'var(--coco-purple)' }} />
            <p className="text-[15px] font-bold">{m.noPlansTitle}</p>
            <p className="mx-auto mt-1 max-w-[300px] text-[12px] leading-relaxed" style={{ color: 'var(--coco-muted)' }}>{m.noPlansBody}</p>
            <div className="mx-auto mt-5 flex max-w-[300px] flex-col gap-2">
              <GradientCTA to="/planner" className="px-6"><Sparkles className="h-4 w-4" /> {m.startPlanner}</GradientCTA>
              <Link to="/tours" className="flex items-center justify-center gap-1.5 rounded-full border py-3 text-[13px] font-bold"
                style={{ borderColor: 'rgba(124,92,255,0.25)', color: 'var(--coco-purple)' }}>
                <Package className="h-4 w-4" /> {m.browseTours}
              </Link>
            </div>
          </CocoCard>
        ) : (
          <>
            {/* 플랜 선택 칩 (2개 이상일 때만) */}
            {refs.length > 1 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {refs.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedPlanId(r.planId)}
                    className="shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px] font-bold transition-colors"
                    style={r.planId === selectedPlanId
                      ? { background: 'var(--coco-cta-gradient)', color: '#fff' }
                      : { background: 'rgba(124,92,255,0.10)', color: 'var(--coco-purple)' }}
                  >
                    {r.tourTitle || `Plan #${r.planId.slice(0, 6)}`}
                  </button>
                ))}
              </div>
            )}

            {/* Day 칩 */}
            {days.length > 0 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {days.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDayIdx(i)}
                    className={`plan-mobile-day-chip${i === dayIdx ? ' is-active' : ''}`}
                  >
                    <span>{d.day || i + 1}</span>
                    <small>{m.day}</small>
                  </button>
                ))}
              </div>
            )}

            {planLoading ? (
              <CocoCard className="px-5 py-10 text-center">
                <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-[#7C5CFF] border-t-transparent" />
                <p className="text-[12.5px]" style={{ color: 'var(--coco-muted)' }}>{m.loading}</p>
              </CocoCard>
            ) : (
              <>
                {planTitle && <p className="mb-2 truncate text-[13px] font-bold">{planTitle}</p>}
                {hasMappable ? (
                  /* DayRouteMap 재사용 — 지도+범례+번호 정거장 리스트 일체 */
                  <DayRouteMap stops={dayStops} />
                ) : (
                  <CocoCard className="px-5 py-8 text-center">
                    <p className="text-[13px] font-semibold">{m.noCoords}</p>
                  </CocoCard>
                )}
                {selectedPlanId && (
                  <Link
                    to={`/my-plans/${selectedPlanId}`}
                    className="mt-3 flex items-center justify-between rounded-2xl px-4 py-3.5 text-[13px] font-bold"
                    style={{ background: 'rgba(124,92,255,0.10)', color: 'var(--coco-purple)' }}
                  >
                    {m.openPlan}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              </>
            )}
          </>
        )}
      </main>
      <Footer t={t} />
    </div>
  );
}
