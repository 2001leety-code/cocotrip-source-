import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { ChevronRight, LogIn, Map as MapIcon, Package, Sparkles, TriangleAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { EcLoading, EcEmpty, EcError } from '@/components/ui/states';
import { DayRouteMap } from '@/pages/PlanDetailPage/components/DayRouteMap';
import type { PlanDay, PlanStop } from '@/pages/PlanDetailPage/types';
import '@/styles/editorial-map.css';

interface PlanRef {
  id: string;
  planId: string;
  createdAt: string;
  status: 'ready' | 'generating';
  tourTitle?: string;
  startDate?: string;
}

type MapFixture = 'signed-out' | 'normal' | 'loading' | 'empty' | 'error' | 'not-found' | 'permission' | 'partial';
type MapReadError = 'error' | 'permission' | 'not-found' | null;
type MapPageState = MapFixture;

const MAP_FIXTURES: MapFixture[] = [
  'signed-out',
  'normal',
  'loading',
  'empty',
  'error',
  'not-found',
  'permission',
  'partial',
];

const MAP_I18N = {
  en: {
    eyebrow: 'Saved itinerary',
    title: 'Route Map',
    subtitle: 'Read each day as one clear route.',
    introduction: 'Choose a saved itinerary and day to review its mapped stops. Open the full itinerary for the complete schedule.',
    choosePlan: 'Choose itinerary',
    chooseDay: 'Choose day',
    selectedRoute: 'Selected route',
    openPlan: 'Open full itinerary',
    noPlansTitle: 'No routes to show yet',
    noPlansBody: 'Build a Korea itinerary and its daily routes will appear here — real places with the subway, bus and walking legs between them.',
    startPlanner: 'Start Trip Planner',
    browseTours: 'Browse Tours',
    signInTitle: 'Sign in to see your routes',
    signInBody: 'The routes from your saved Korea itineraries are kept in your account.',
    signIn: 'Sign in',
    loading: 'Loading your routes',
    errorTitle: 'Could not load your routes',
    errorBody: 'The saved route could not be read. Try the same request again.',
    retry: 'Try again',
    permissionTitle: 'This route map is unavailable',
    permissionBody: 'Your account cannot open this saved route. Return to your plans and choose another itinerary.',
    notFoundTitle: 'This itinerary was not found',
    notFoundBody: 'It may have been removed or is no longer available in your saved plans.',
    partialTitle: 'Some route details are missing',
    partialBody: 'This itinerary is saved, but the selected day does not yet have enough mapped stops to draw a route.',
    backToPlans: 'Back to my plans',
    untitledPlan: 'Saved itinerary',
  },
  ko: {
    eyebrow: '저장한 일정',
    title: '경로 지도',
    subtitle: '하루 일정을 한눈에 동선으로 확인하세요.',
    introduction: '저장한 일정과 날짜를 고르면 지도에 기록된 장소를 볼 수 있습니다. 전체 일정에서는 자세한 시간표를 확인할 수 있어요.',
    choosePlan: '일정 선택',
    chooseDay: '날짜 선택',
    selectedRoute: '선택한 동선',
    openPlan: '전체 일정 열기',
    noPlansTitle: '아직 표시할 동선이 없어요',
    noPlansBody: '한국 일정을 만들면 실제 장소와 그 사이 지하철·버스·도보 구간이 날짜별 동선으로 여기에 나타납니다.',
    startPlanner: '여행 플래너 시작',
    browseTours: '투어 둘러보기',
    signInTitle: '로그인하고 내 동선 보기',
    signInBody: '저장한 한국 일정의 경로는 계정에 보관돼 있어요.',
    signIn: '로그인',
    loading: '동선을 불러오는 중',
    errorTitle: '동선을 불러오지 못했어요',
    errorBody: '저장된 경로를 읽지 못했습니다. 같은 요청을 다시 시도해 주세요.',
    retry: '다시 시도',
    permissionTitle: '이 경로 지도를 열 수 없어요',
    permissionBody: '현재 계정으로는 이 저장 경로를 볼 수 없습니다. 내 일정에서 다른 일정을 골라 주세요.',
    notFoundTitle: '일정을 찾을 수 없어요',
    notFoundBody: '일정이 삭제됐거나 저장 목록에서 더 이상 이용할 수 없을 수 있습니다.',
    partialTitle: '일부 경로 정보가 비어 있어요',
    partialBody: '일정은 저장돼 있지만 선택한 날짜에 경로를 그릴 만큼 지도 좌표가 충분하지 않습니다.',
    backToPlans: '내 일정으로 돌아가기',
    untitledPlan: '저장한 일정',
  },
  ja: {
    eyebrow: '保存した旅程',
    title: 'ルートマップ',
    subtitle: '1日の旅程をひとつの動線で確認できます。',
    introduction: '保存した旅程と日付を選ぶと、地図に記録された場所を確認できます。詳しい時間表は旅程全体で確認してください。',
    choosePlan: '旅程を選択',
    chooseDay: '日付を選択',
    selectedRoute: '選択したルート',
    openPlan: '旅程全体を開く',
    noPlansTitle: '表示できるルートがまだありません',
    noPlansBody: '韓国旅程を作成すると、実際の場所と、その間の地下鉄・バス・徒歩区間が日別ルートとしてここに表示されます。',
    startPlanner: '旅行プランナーを開始',
    browseTours: 'ツアーを見る',
    signInTitle: 'ログインしてルートを見る',
    signInBody: '保存した韓国旅程のルートはアカウントに保管されています。',
    signIn: 'ログイン',
    loading: 'ルートを読み込み中',
    errorTitle: 'ルートを読み込めませんでした',
    errorBody: '保存したルートを読み込めませんでした。同じ操作をもう一度お試しください。',
    retry: '再試行',
    permissionTitle: 'このルートマップは開けません',
    permissionBody: '現在のアカウントではこの保存ルートを開けません。旅程一覧から別の旅程を選んでください。',
    notFoundTitle: '旅程が見つかりません',
    notFoundBody: '削除されたか、保存した旅程から利用できなくなった可能性があります。',
    partialTitle: '一部のルート情報が不足しています',
    partialBody: '旅程は保存されていますが、選択した日にルートを描くための地図座標が十分にありません。',
    backToPlans: '旅程一覧に戻る',
    untitledPlan: '保存した旅程',
  },
  zh: {
    eyebrow: '已保存行程',
    title: '路线地图',
    subtitle: '用一条清晰动线查看每天的行程。',
    introduction: '选择已保存的行程和日期，即可查看地图中记录的地点。完整时间表可在详细行程中查看。',
    choosePlan: '选择行程',
    chooseDay: '选择日期',
    selectedRoute: '已选路线',
    openPlan: '打开完整行程',
    noPlansTitle: '暂时没有可显示的路线',
    noPlansBody: '创建韩国行程后，真实地点以及地点之间的地铁、公交与步行路段会按日期显示在这里。',
    startPlanner: '开始行程规划',
    browseTours: '浏览旅游产品',
    signInTitle: '登录后查看我的路线',
    signInBody: '已保存的韩国行程路线保存在您的账户中。',
    signIn: '登录',
    loading: '正在加载路线',
    errorTitle: '无法加载路线',
    errorBody: '无法读取已保存的路线，请再次尝试相同操作。',
    retry: '重试',
    permissionTitle: '无法打开此路线地图',
    permissionBody: '当前账户无法查看这条已保存路线，请返回行程列表选择其他行程。',
    notFoundTitle: '找不到此行程',
    notFoundBody: '该行程可能已被删除，或已无法从保存列表中打开。',
    partialTitle: '部分路线信息缺失',
    partialBody: '行程已保存，但所选日期没有足够的地图坐标来绘制路线。',
    backToPlans: '返回我的行程',
    untitledPlan: '已保存行程',
  },
} as const;

type MapLanguage = keyof typeof MAP_I18N;

const FIXTURE_PLAN_TITLES: Record<MapLanguage, [string, string]> = {
  en: ['Seoul essentials', 'Riverside afternoon'],
  ko: ['서울 핵심 일정', '한강 오후 일정'],
  ja: ['ソウル定番旅程', '漢江の午後旅程'],
  zh: ['首尔精选行程', '汉江午后行程'],
};

const FIXTURE_STOP_NAMES: Record<MapLanguage, [string, string, string, string, string]> = {
  en: ['Gyeongbokgung Palace', 'Seochon', 'Gwangjang Market', 'Seoul Forest', 'Ttukseom Hangang Park'],
  ko: ['경복궁', '서촌', '광장시장', '서울숲', '뚝섬한강공원'],
  ja: ['景福宮', '西村', '広蔵市場', 'ソウルの森', 'トゥクソム漢江公園'],
  zh: ['景福宫', '西村', '广藏市场', '首尔林', '纛岛汉江公园'],
};

function getMapFixture(value: string | null): MapFixture | null {
  if (!value) return null;
  return MAP_FIXTURES.includes(value as MapFixture) ? value as MapFixture : null;
}

function getFixtureRefs(language: MapLanguage): PlanRef[] {
  return [
    {
      id: 'map-fixture-ref',
      planId: 'map-fixture-plan',
      createdAt: '2026-10-01T09:00:00.000Z',
      status: 'ready',
      tourTitle: FIXTURE_PLAN_TITLES[language][0],
    },
    {
      id: 'map-fixture-ref-two',
      planId: 'map-fixture-plan-two',
      createdAt: '2026-09-30T09:00:00.000Z',
      status: 'ready',
      tourTitle: FIXTURE_PLAN_TITLES[language][1],
    },
  ];
}

function getFixtureDays(language: MapLanguage): PlanDay[] {
  const names = FIXTURE_STOP_NAMES[language];
  return [
    {
      day: 1,
      stops: [
        { display_name: names[0], start_time: '09:30', lat: 37.5796, lng: 126.9770 },
        { display_name: names[1], start_time: '12:10', lat: 37.5790, lng: 126.9695 },
        { display_name: names[2], start_time: '16:00', lat: 37.5700, lng: 126.9996 },
      ],
    },
    {
      day: 2,
      stops: [
        { display_name: names[3], start_time: '11:00', lat: 37.5444, lng: 127.0374 },
        { display_name: names[4], start_time: '15:00', lat: 37.5293, lng: 127.0698 },
      ],
    },
  ];
}

function getPartialFixtureDays(language: MapLanguage): PlanDay[] {
  return [{
    day: 1,
    stops: [{ display_name: FIXTURE_STOP_NAMES[language][0], start_time: '09:30' }],
  }];
}

function classifyReadError(error: unknown): Exclude<MapReadError, 'not-found' | null> {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return code.includes('permission-denied') ? 'permission' : 'error';
}

function formatDayLabel(language: MapLanguage, day: number | undefined, index: number): string {
  const dayNumber = typeof day === 'number' ? day : index + 1;
  if (language === 'ko') return `${dayNumber}일차`;
  if (language === 'ja') return `${dayNumber}日目`;
  if (language === 'zh') return `第${dayNumber}天`;
  return `Day ${dayNumber}`;
}

export default function MapPage() {
  const { user } = useAuth();
  const { language, t, changeLanguage } = useLanguage();
  const [searchParams] = useSearchParams();
  const fixture = import.meta.env.DEV ? getMapFixture(searchParams.get('__fixture')) : null;
  const mapLanguage = (language in MAP_I18N ? language : 'en') as MapLanguage;
  const copy = MAP_I18N[mapLanguage];

  const [refs, setRefs] = useState<PlanRef[]>([]);
  const [refsLoading, setRefsLoading] = useState(true);
  const [refsError, setRefsError] = useState<MapReadError>(null);
  const [refsReloadKey, setRefsReloadKey] = useState(0);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [days, setDays] = useState<PlanDay[]>([]);
  const [planTitle, setPlanTitle] = useState('');
  const [dayIdx, setDayIdx] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<MapReadError>(null);
  const [planReloadKey, setPlanReloadKey] = useState(0);

  usePageMeta({
    title: copy.title,
    description: copy.subtitle,
  });

  useEffect(() => {
    if (fixture) return;
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setRefsLoading(true);
      setRefsError(null);
      try {
        const plansQuery = query(
          collection(db, 'users', user.uid, 'plans'),
          orderBy('createdAt', 'desc'),
          limit(10),
        );
        const snapshot = await getDocs(plansQuery);
        if (cancelled) return;
        const ready = snapshot.docs
          .map(planDoc => ({ id: planDoc.id, ...planDoc.data() } as PlanRef))
          .filter(planRef => planRef.status === 'ready' && planRef.planId)
          .slice(0, 5);
        setRefs(ready);
        setSelectedPlanId(previous => (
          previous && ready.some(planRef => planRef.planId === previous)
            ? previous
            : ready[0] ? ready[0].planId : null
        ));
        if (ready.length > 0) setPlanLoading(true);
      } catch (error) {
        if (!cancelled) {
          setRefs([]);
          setSelectedPlanId(null);
          setRefsError(classifyReadError(error));
        }
      } finally {
        if (!cancelled) setRefsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fixture, refsReloadKey, user?.uid]);

  useEffect(() => {
    if (fixture) return;
    if (!selectedPlanId || !user?.uid) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setPlanLoading(true);
      setPlanError(null);
      try {
        const snapshot = await getDoc(doc(db, 'plans', selectedPlanId));
        if (cancelled) return;
        if (!snapshot.exists()) {
          setDays([]);
          setPlanTitle('');
          setPlanError('not-found');
          return;
        }
        const data = snapshot.data() as Record<string, unknown>;
        const itinerary = data.itinerary as { days?: unknown; tour_title?: unknown } | undefined;
        const rawDays = itinerary && itinerary.days;
        const tourTitle = itinerary && itinerary.tour_title;
        setDays(Array.isArray(rawDays) ? rawDays as PlanDay[] : []);
        setPlanTitle(typeof tourTitle === 'string' ? tourTitle : '');
        setDayIdx(0);
      } catch (error) {
        if (!cancelled) {
          setDays([]);
          setPlanTitle('');
          setPlanError(classifyReadError(error));
        }
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fixture, planReloadKey, selectedPlanId, user?.uid]);

  const fixtureHasPlan = fixture === 'normal' || fixture === 'not-found' || fixture === 'partial';
  const fixtureRefs = getFixtureRefs(mapLanguage);
  const visibleSignedIn = fixture ? fixture !== 'signed-out' : Boolean(user?.uid);
  const visibleRefs = fixture ? (fixtureHasPlan ? fixtureRefs : []) : refs;
  const visibleRefsLoading = fixture ? fixture === 'loading' : refsLoading;
  const visibleRefsError: MapReadError = fixture === 'error'
    ? 'error'
    : fixture === 'permission' ? 'permission' : fixture ? null : refsError;
  const visiblePlanId = fixtureHasPlan ? (selectedPlanId || fixtureRefs[0].planId) : selectedPlanId;
  const visibleDays = fixture === 'normal'
    ? getFixtureDays(mapLanguage)
    : fixture === 'partial' ? getPartialFixtureDays(mapLanguage) : fixture ? [] : days;
  const visiblePlanTitle = fixtureHasPlan
    ? ((visibleRefs.find(planRef => planRef.planId === visiblePlanId) || visibleRefs[0]).tourTitle || copy.untitledPlan)
    : planTitle;
  const visiblePlanLoading = fixture ? false : planLoading;
  const visiblePlanError: MapReadError = fixture === 'not-found' ? 'not-found' : fixture ? null : planError;
  const selectedDay = visibleDays[dayIdx];
  const dayStops: PlanStop[] = selectedDay && Array.isArray(selectedDay.stops) ? selectedDay.stops : [];
  const hasMappable = dayStops.filter(stop => typeof stop.lat === 'number' && typeof stop.lng === 'number').length >= 2;

  let pageState: MapPageState = 'normal';
  if (!visibleSignedIn) pageState = 'signed-out';
  else if (visibleRefsLoading) pageState = 'loading';
  else if (visibleRefsError === 'permission') pageState = 'permission';
  else if (visibleRefsError === 'error') pageState = 'error';
  else if (visibleRefs.length === 0) pageState = 'empty';
  else if (visiblePlanLoading) pageState = 'loading';
  else if (visiblePlanError === 'permission') pageState = 'permission';
  else if (visiblePlanError === 'error') pageState = 'error';
  else if (visiblePlanError === 'not-found') pageState = 'not-found';
  else if (!hasMappable) pageState = 'partial';

  const retryRefs = () => {
    if (fixture) return;
    setRefsReloadKey(value => value + 1);
  };
  const retryPlan = () => {
    if (fixture) return;
    setPlanReloadKey(value => value + 1);
  };
  const selectPlan = (planId: string) => {
    if (planId === visiblePlanId) return;
    setSelectedPlanId(planId);
    setDayIdx(0);
    if (!fixture) setPlanLoading(true);
  };
  const selectDay = (index: number) => setDayIdx(index);
  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (visibleDays.length < 2) return;
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % visibleDays.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + visibleDays.length) % visibleDays.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleDays.length - 1;
    else return;
    event.preventDefault();
    setDayIdx(nextIndex);
    document.getElementById(`map-day-tab-${nextIndex}`)?.focus();
  };

  const planActions = (
    <span className="map-editorial-actions">
      <Link to="/planner" className="ec-btn ec-btn-primary">
        <Sparkles aria-hidden size={17} />
        {copy.startPlanner}
      </Link>
      <Link to="/tours" className="ec-btn ec-btn-secondary">
        <Package aria-hidden size={17} />
        {copy.browseTours}
      </Link>
    </span>
  );

  return (
    <div
      className="ec-root map-editorial-page"
      data-testid="map-editorial-shell"
      data-state={pageState}
    >
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <main className="map-editorial-main">
        <section className="map-editorial-masthead ec-container-wide" aria-labelledby="map-editorial-title">
          <div className="map-editorial-heading-mark" aria-hidden="true">
            <MapIcon size={25} />
          </div>
          <div className="map-editorial-heading-copy">
            <p className="ec-eyebrow">{copy.eyebrow}</p>
            <h1 id="map-editorial-title" className="ec-display">{copy.title}</h1>
            <p className="map-editorial-deck">{copy.subtitle}</p>
          </div>
          <p className="ec-body map-editorial-introduction">{copy.introduction}</p>
        </section>

        <div className="map-editorial-content ec-container-wide">
          {pageState === 'signed-out' && (
            <section className="map-editorial-access" aria-labelledby="map-access-title">
              <div className="map-editorial-access-icon" aria-hidden="true"><LogIn size={25} /></div>
              <h2 id="map-access-title" className="ec-h2">{copy.signInTitle}</h2>
              <p className="ec-body">{copy.signInBody}</p>
              <div className="map-editorial-actions">
                <Link to="/mypage" className="ec-btn ec-btn-primary">{copy.signIn}</Link>
                <Link to="/planner" className="ec-btn ec-btn-secondary">
                  <Sparkles aria-hidden size={17} />
                  {copy.startPlanner}
                </Link>
              </div>
            </section>
          )}

          {pageState === 'loading' && (
            <section className="map-editorial-state-panel" aria-label={copy.loading}>
              <EcLoading label={copy.loading} lines={5} className="map-editorial-loading" />
            </section>
          )}

          {pageState === 'empty' && (
            <section className="map-editorial-state-panel">
              <EcEmpty title={copy.noPlansTitle} body={copy.noPlansBody} action={planActions} />
            </section>
          )}

          {pageState === 'error' && (
            <section className="map-editorial-state-panel">
              <EcError
                title={copy.errorTitle}
                body={copy.errorBody}
                retryLabel={copy.retry}
                onRetry={visibleRefsError ? retryRefs : retryPlan}
                secondary={<Link to="/my-plans" className="ec-btn ec-btn-secondary">{copy.backToPlans}</Link>}
              />
            </section>
          )}

          {pageState === 'permission' && (
            <section className="map-editorial-state-panel">
              <EcError
                title={copy.permissionTitle}
                body={copy.permissionBody}
                secondary={<Link to="/my-plans" className="ec-btn ec-btn-secondary">{copy.backToPlans}</Link>}
              />
            </section>
          )}

          {pageState === 'not-found' && (
            <section className="map-editorial-state-panel">
              <EcEmpty
                title={copy.notFoundTitle}
                body={copy.notFoundBody}
                action={<Link to="/my-plans" className="ec-btn ec-btn-primary">{copy.backToPlans}</Link>}
              />
            </section>
          )}

          {(pageState === 'normal' || pageState === 'partial') && visiblePlanId && (
            <article className="map-editorial-document" aria-labelledby="map-route-title">
              <header className="map-editorial-document-header">
                <div>
                  <p className="ec-eyebrow">{copy.selectedRoute}</p>
                  <h2 id="map-route-title" className="ec-h2">{visiblePlanTitle || copy.untitledPlan}</h2>
                </div>
                <Link to={`/my-plans/${visiblePlanId}`} className="ec-btn ec-btn-secondary map-editorial-open-plan">
                  {copy.openPlan}
                  <ChevronRight aria-hidden size={17} />
                </Link>
              </header>

              <div className="map-editorial-document-grid">
                <aside className="map-editorial-controls" aria-label={copy.selectedRoute}>
                  {visibleRefs.length > 1 && (
                    <div className="map-editorial-control-group" role="group" aria-label={copy.choosePlan}>
                      <p className="map-editorial-control-label">{copy.choosePlan}</p>
                      <div className="map-editorial-plan-list">
                        {visibleRefs.map(planRef => (
                          <button
                            key={planRef.id}
                            type="button"
                            aria-pressed={planRef.planId === visiblePlanId}
                            className="map-editorial-plan-button"
                            onClick={() => selectPlan(planRef.planId)}
                          >
                            {planRef.tourTitle || `${copy.untitledPlan} ${planRef.planId.slice(0, 6)}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {visibleDays.length > 0 && (
                    <div className="map-editorial-control-group">
                      <p className="map-editorial-control-label">{copy.chooseDay}</p>
                      <div className="map-editorial-day-list" role="tablist" aria-label={copy.chooseDay}>
                        {visibleDays.map((day, index) => (
                          <button
                            key={`${day.day || index + 1}-${index}`}
                            id={`map-day-tab-${index}`}
                            type="button"
                            role="tab"
                            aria-selected={index === dayIdx}
                            aria-controls="map-route-panel"
                            tabIndex={index === dayIdx ? 0 : -1}
                            className="map-editorial-day-button"
                            onClick={() => selectDay(index)}
                            onKeyDown={event => handleDayKeyDown(event, index)}
                          >
                            {formatDayLabel(mapLanguage, day.day, index)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </aside>

                <section
                  id="map-route-panel"
                  className="map-editorial-route-panel"
                  role="tabpanel"
                  aria-labelledby={visibleDays.length > 0 ? `map-day-tab-${dayIdx}` : undefined}
                  aria-label={visibleDays.length === 0 ? copy.selectedRoute : undefined}
                  tabIndex={pageState === 'partial' ? 0 : undefined}
                >
                  {pageState === 'normal' ? (
                    <DayRouteMap stops={dayStops} />
                  ) : (
                    <div className="map-editorial-partial" data-testid="map-partial-state" role="status">
                      <TriangleAlert aria-hidden size={25} />
                      <h3 className="ec-h3">{copy.partialTitle}</h3>
                      <p className="ec-body-sm">{copy.partialBody}</p>
                    </div>
                  )}
                </section>
              </div>
            </article>
          )}
        </div>
      </main>
      <Footer t={t} />
    </div>
  );
}
