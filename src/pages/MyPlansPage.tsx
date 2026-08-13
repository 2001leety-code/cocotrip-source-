import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  limit,
  startAfter,
  getDocs,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { Calendar, ChevronRight, MapPin, Package, Plane, Search, Sparkles } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useLoyalty } from '@/hooks/useLoyalty';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { MyBookingsTab } from '@/components/MyBookingsTab';
import { EcLoading, EcEmpty, EcError, EcSkeleton } from '@/components/ui/states';
import '@/styles/editorial-my-plans.css';

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

type MyPlansLanguage = 'ko' | 'en' | 'ja' | 'zh';
type MyPlansFixture = 'normal' | 'loading' | 'empty' | 'error' | 'partial';
type MyPlansTab = 'plans' | 'bookings';

const SHELL_COPY: Record<MyPlansLanguage, {
  eyebrow: string;
  subtitle: string;
  accountLabel: string;
  viewsLabel: string;
  loading: string;
  errorTitle: string;
  errorBody: string;
  retry: string;
  partialTitle: string;
  partialBody: string;
  clearSearch: string;
  loadMoreLoading: string;
  openPlan: (title: string) => string;
  untitledPlan: (id: string) => string;
  fixtureReadyTitle: string;
  fixtureGeneratingTitle: string;
  fixtureSeoul: string;
  fixtureBusan: string;
}> = {
  ko: {
    eyebrow: '여행 실행 보관함',
    subtitle: '저장한 일정을 한눈에 확인하고, 필요한 여행 문서를 바로 열어보세요.',
    accountLabel: '일정 소유 계정',
    viewsLabel: '내 여행 보기',
    loading: '저장한 일정을 불러오는 중',
    errorTitle: '일정을 불러오지 못했어요',
    errorBody: '연결을 확인한 뒤 다시 시도하세요. 저장된 내용은 변경되지 않습니다.',
    retry: '다시 시도',
    partialTitle: '일부 일정을 더 불러오지 못했어요',
    partialBody: '이미 표시된 일정은 계속 열 수 있어요. 나머지 목록만 다시 불러오세요.',
    clearSearch: '검색 지우기',
    loadMoreLoading: '불러오는 중',
    openPlan: (title) => `${title} 일정 열기`,
    untitledPlan: (id) => `일정 ${id}`,
    fixtureReadyTitle: '서울 골목과 궁궐 일정',
    fixtureGeneratingTitle: '부산 바다 여행 일정',
    fixtureSeoul: '서울',
    fixtureBusan: '부산',
  },
  en: {
    eyebrow: 'Travel document library',
    subtitle: 'Review saved itineraries at a glance and open the document you need.',
    accountLabel: 'Plan owner',
    viewsLabel: 'Travel views',
    loading: 'Loading your saved plans',
    errorTitle: 'Could not load your plans',
    errorBody: 'Check your connection and try again. Your saved plans have not changed.',
    retry: 'Try again',
    partialTitle: 'Some plans could not be loaded',
    partialBody: 'The plans already shown are still available. Retry only the remaining list.',
    clearSearch: 'Clear search',
    loadMoreLoading: 'Loading more',
    openPlan: (title) => `Open ${title}`,
    untitledPlan: (id) => `Plan ${id}`,
    fixtureReadyTitle: 'Seoul lanes and palaces',
    fixtureGeneratingTitle: 'Busan coast itinerary',
    fixtureSeoul: 'Seoul',
    fixtureBusan: 'Busan',
  },
  ja: {
    eyebrow: '旅の実行書庫',
    subtitle: '保存した旅程を一覧で確認し、必要な旅行文書をすぐに開けます。',
    accountLabel: '旅程の所有アカウント',
    viewsLabel: '旅行ビュー',
    loading: '保存したプランを読み込んでいます',
    errorTitle: 'プランを読み込めませんでした',
    errorBody: '接続を確認して、もう一度お試しください。保存内容は変更されません。',
    retry: '再試行',
    partialTitle: '一部のプランを追加で読み込めませんでした',
    partialBody: '表示済みのプランはそのまま開けます。残りの一覧だけ再試行してください。',
    clearSearch: '検索をクリア',
    loadMoreLoading: '読み込み中',
    openPlan: (title) => `${title}を開く`,
    untitledPlan: (id) => `プラン ${id}`,
    fixtureReadyTitle: 'ソウルの路地と宮殿プラン',
    fixtureGeneratingTitle: '釜山の海辺プラン',
    fixtureSeoul: 'ソウル',
    fixtureBusan: '釜山',
  },
  zh: {
    eyebrow: '旅行执行资料库',
    subtitle: '集中查看已保存的行程，并随时打开需要的旅行文档。',
    accountLabel: '行程所属账号',
    viewsLabel: '旅行视图',
    loading: '正在加载已保存的行程',
    errorTitle: '无法加载行程',
    errorBody: '请检查网络后重试。已保存的内容不会改变。',
    retry: '重试',
    partialTitle: '部分行程未能继续加载',
    partialBody: '已显示的行程仍可打开，只需重试剩余列表。',
    clearSearch: '清除搜索',
    loadMoreLoading: '正在加载',
    openPlan: (title) => `打开${title}`,
    untitledPlan: (id) => `行程 ${id}`,
    fixtureReadyTitle: '首尔巷弄与宫殿行程',
    fixtureGeneratingTitle: '釜山海岸行程',
    fixtureSeoul: '首尔',
    fixtureBusan: '釜山',
  },
};

const DATE_LOCALE: Record<MyPlansLanguage, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

const PAGE_SIZE = 30;
const MY_PLANS_TABS: MyPlansTab[] = ['plans', 'bookings'];

function parseFixture(pathname: string, value: string | null): MyPlansFixture | null {
  if (!import.meta.env.DEV || pathname !== '/dev/my-plans-editorial') return null;
  if (value === 'loading' || value === 'empty' || value === 'error' || value === 'partial') return value;
  return 'normal';
}

function createFixturePlans(copy: (typeof SHELL_COPY)[MyPlansLanguage]): PlanRef[] {
  return [
    {
      id: 'fixture-ready',
      planId: 'fixture-ready',
      createdAt: '2026-08-13T00:00:00.000Z',
      status: 'ready',
      tourTitle: copy.fixtureReadyTitle,
      startDate: '2026-09-12',
      area: copy.fixtureSeoul,
      pax: 2,
    },
    {
      id: 'fixture-generating',
      planId: 'fixture-generating',
      createdAt: '2026-08-12T00:00:00.000Z',
      status: 'generating',
      tourTitle: copy.fixtureGeneratingTitle,
      startDate: '2026-10-03',
      area: copy.fixtureBusan,
      pax: 3,
    },
  ];
}

function formatDate(plan: PlanRef, language: MyPlansLanguage) {
  if (plan.startDate) return plan.startDate;
  const date = new Date(plan.createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(DATE_LOCALE[language], { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export default function MyPlansPage() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const { loyalty } = useLoyalty();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLanguage = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as MyPlansLanguage;
  const copy = SHELL_COPY[selectedLanguage];
  const p = t.planner as unknown as Record<string, string>;
  const mp = t.mypage as unknown as Record<string, string>;
  const fixture = parseFixture(pathname, searchParams.get('__fixture'));
  const [fixtureRecovered, setFixtureRecovered] = useState(false);
  const fixtureState = fixtureRecovered && fixture === 'error' ? 'normal' : fixture;
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [firstPage, setFirstPage] = useState<PlanRef[]>([]);
  const [morePages, setMorePages] = useState<{ uid: string; items: PlanRef[] }>({ uid: '', items: [] });
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [fixturePartialResolved, setFixturePartialResolved] = useState(false);
  const [search, setSearch] = useState('');
  const tab: MyPlansTab = searchParams.get('tab') === 'bookings' ? 'bookings' : 'plans';

  const setTab = (next: MyPlansTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'plans') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: MyPlansTab) => {
    const currentIndex = MY_PLANS_TABS.indexOf(current);
    let next: MyPlansTab | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = MY_PLANS_TABS[(currentIndex + 1) % MY_PLANS_TABS.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = MY_PLANS_TABS[(currentIndex - 1 + MY_PLANS_TABS.length) % MY_PLANS_TABS.length];
    } else if (event.key === 'Home') {
      next = MY_PLANS_TABS[0];
    } else if (event.key === 'End') {
      next = MY_PLANS_TABS[MY_PLANS_TABS.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    document.getElementById(`my-plans-${next}-tab`)?.focus();
    setTab(next);
  };

  usePageMeta({
    title: t.pageMeta?.myPlans?.title || 'My Plans — AI Travel Itineraries',
    description: t.pageMeta?.myPlans?.description || 'View and manage your AI-generated Korea travel itineraries.',
  });

  useEffect(() => {
    if (!user?.uid || fixture) return;
    const plansQuery = query(
      collection(db, 'users', user.uid, 'plans'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    );
    const unsubscribe = onSnapshot(plansQuery, (snapshot) => {
      setFirstPage(snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as PlanRef)));
      setLastDoc(snapshot.docs.length ? snapshot.docs[snapshot.docs.length - 1] : null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
      setListError(false);
      setLoading(false);
    }, () => {
      setListError(true);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [fixture, reloadKey, user?.uid]);

  const loadMore = async () => {
    if (fixtureState === 'partial') {
      setFixturePartialResolved(true);
      return;
    }
    if (!user?.uid || !lastDoc || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const snapshot = await getDocs(query(
        collection(db, 'users', user.uid, 'plans'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE),
      ));
      const uid = user.uid;
      const page = snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as PlanRef));
      setMorePages((previous) => (previous.uid === uid
        ? { uid, items: [...previous.items, ...page] }
        : { uid, items: page }));
      if (snapshot.docs.length) setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const retryList = () => {
    if (fixture === 'error') {
      setFixtureRecovered(true);
      return;
    }
    setListError(false);
    setLoading(true);
    setReloadKey((current) => current + 1);
  };

  const actualPlans = (() => {
    const seen = new Set(firstPage.map((plan) => plan.id));
    const extra = morePages.uid === (user?.uid || '') ? morePages.items : [];
    return [...firstPage, ...extra.filter((plan) => !seen.has(plan.id))];
  })();
  const fixturePlans = createFixturePlans(copy);
  const plans = fixtureState === 'normal' || fixtureState === 'partial'
    ? fixturePlans
    : fixtureState
      ? []
      : actualPlans;
  const pageLoading = fixtureState === 'loading' || (!fixtureState && loading);
  const pageError = fixtureState === 'error' || (!fixtureState && listError);
  const partialError = (fixtureState === 'partial' && !fixturePartialResolved) || loadMoreError;
  const keyword = search.trim().toLowerCase();
  const visiblePlans = keyword
    ? plans.filter((plan) => [plan.tourTitle, plan.area, plan.startDate, plan.planId]
      .some((value) => String(value || '').toLowerCase().includes(keyword)))
    : plans;
  const accountName = user?.displayName || user?.email || 'CocoTrip';

  return (
    <div className="my-plans-editorial ec-root min-h-screen">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="my-plans-editorial-main" data-testid="my-plans-library">
        <section className="my-plans-editorial-masthead" aria-labelledby="my-plans-title">
          <div className="my-plans-editorial-heading">
            <span className="my-plans-editorial-mark" aria-hidden><Plane /></span>
            <div>
              <p className="ec-eyebrow">{copy.eyebrow}</p>
              <h1 id="my-plans-title" className="ec-h1">{p.my_plans || 'My Plans'}</h1>
              <p className="ec-body my-plans-editorial-subtitle">{copy.subtitle}</p>
            </div>
          </div>
          <dl className="my-plans-editorial-account">
            <dt>{copy.accountLabel}</dt>
            <dd>{accountName}</dd>
          </dl>
        </section>

        <div className="my-plans-editorial-tabs" role="tablist" aria-label={copy.viewsLabel}>
          {([
            { id: 'plans' as const, label: p.my_plans || 'My Plans', icon: Sparkles },
            { id: 'bookings' as const, label: mp.tabBookings || 'My Bookings', icon: Package },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`my-plans-${id}-tab`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`my-plans-${id}-panel`}
              tabIndex={tab === id ? 0 : -1}
              className={`my-plans-editorial-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => handleTabKeyDown(event, id)}
            >
              <Icon aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {tab === 'bookings' && (
          <section id="my-plans-plans-panel" role="tabpanel" aria-labelledby="my-plans-plans-tab" hidden />
        )}
        {tab === 'plans' && (
          <section id="my-plans-bookings-panel" role="tabpanel" aria-labelledby="my-plans-bookings-tab" hidden />
        )}

        {tab === 'bookings' ? (
          <section
            id="my-plans-bookings-panel"
            role="tabpanel"
            aria-labelledby="my-plans-bookings-tab"
            className="my-plans-bookings-boundary"
            data-testid="my-plans-bookings-boundary"
          >
            <MyBookingsTab
              userEmail={user?.email || ''}
              tier={loyalty?.tier || 'Bronze'}
              language={selectedLanguage}
            />
          </section>
        ) : (
          <section
            id="my-plans-plans-panel"
            role="tabpanel"
            aria-labelledby="my-plans-plans-tab"
            className="my-plans-editorial-panel"
          >
            {pageLoading ? (
              <div className="my-plans-editorial-state" data-testid="my-plans-list-loading" aria-busy="true">
                <EcLoading label={copy.loading} lines={2} className="my-plans-editorial-loading-copy" />
                <div className="my-plans-editorial-skeleton-grid" aria-hidden>
                  {[1, 2].map((item) => (
                    <div key={item} className="my-plans-editorial-skeleton-card">
                      <EcSkeleton className="h-4 w-24" />
                      <EcSkeleton className="mt-5 h-6 w-3/4" />
                      <EcSkeleton className="mt-4 h-4 w-1/2" />
                    </div>
                  ))}
                </div>
              </div>
            ) : pageError ? (
              <div className="my-plans-editorial-state" data-testid="my-plans-list-error">
                <EcError
                  title={copy.errorTitle}
                  body={copy.errorBody}
                  retryLabel={copy.retry}
                  onRetry={retryList}
                />
              </div>
            ) : plans.length === 0 ? (
              <div className="my-plans-editorial-state" data-testid="my-plans-list-empty">
                <EcEmpty
                  title={mp.myPlansEmptyTitle || 'No plans yet'}
                  body={mp.myPlansEmptyBody || 'Create your first AI-powered Korea itinerary'}
                  action={<Link to="/planner" className="ec-btn ec-btn-primary">{mp.myPlansStartCta || 'Start planning'}</Link>}
                />
              </div>
            ) : (
              <div className="my-plans-editorial-library">
                <label className="my-plans-editorial-search" htmlFor="my-plans-search">
                  <Search aria-hidden />
                  <input
                    id="my-plans-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={mp.myPlansSearch || 'Search by title or area'}
                    aria-label={mp.myPlansSearch || 'Search by title or area'}
                  />
                </label>

                {partialError && (
                  <div className="my-plans-editorial-partial" role="status" data-testid="my-plans-list-partial">
                    <div>
                      <h2>{copy.partialTitle}</h2>
                      <p>{copy.partialBody}</p>
                    </div>
                    <button type="button" className="ec-btn ec-btn-secondary" onClick={() => { void loadMore(); }}>
                      {copy.retry}
                    </button>
                  </div>
                )}

                {visiblePlans.length === 0 ? (
                  <div className="my-plans-editorial-state is-compact" data-testid="my-plans-list-no-match">
                    <EcEmpty
                      title={mp.myPlansNoMatch || 'No matching plans'}
                      action={(
                        <button type="button" className="ec-btn ec-btn-secondary" onClick={() => setSearch('')}>
                          {copy.clearSearch}
                        </button>
                      )}
                    />
                  </div>
                ) : (
                  <div className="my-plans-editorial-grid" aria-busy={loadingMore}>
                    {visiblePlans.map((plan) => {
                      const title = plan.tourTitle || copy.untitledPlan(plan.planId.slice(0, 8));
                      const displayDate = formatDate(plan, selectedLanguage);
                      const hasPax = typeof plan.pax === 'number' && plan.pax > 0;
                      const hasMetadata = Boolean(displayDate || plan.area || hasPax);
                      return (
                        <Link
                          key={plan.id}
                          to={`/my-plans/${plan.planId}`}
                          className="my-plans-editorial-card"
                          aria-label={copy.openPlan(title)}
                          data-testid="my-plans-plan-card"
                        >
                          <span className={`my-plans-editorial-status is-${plan.status}`}>
                            {plan.status === 'ready'
                              ? mp.myPlansStatusReady || 'Ready'
                              : mp.myPlansStatusGenerating || 'Generating'}
                          </span>
                          <h2>{title}</h2>
                          {hasMetadata && (
                            <div className="my-plans-editorial-meta">
                              {displayDate && <span><Calendar aria-hidden />{displayDate}</span>}
                              {plan.area && <span><MapPin aria-hidden />{plan.area}</span>}
                              {hasPax && <span>{plan.pax} {mp.myPlansPaxUnit || 'pax'}</span>}
                            </div>
                          )}
                          <ChevronRight className="my-plans-editorial-chevron" aria-hidden />
                        </Link>
                      );
                    })}
                  </div>
                )}

                {!fixtureState && hasMore && !loadMoreError && (
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => { void loadMore(); }}
                    className="my-plans-editorial-load-more ec-btn ec-btn-secondary"
                  >
                    {loadingMore ? copy.loadMoreLoading : mp.myPlansLoadMore || 'Load more'}
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </main>
      <Footer t={t} />
    </div>
  );
}
