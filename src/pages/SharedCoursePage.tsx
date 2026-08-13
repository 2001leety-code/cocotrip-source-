import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, ExternalLink, ListPlus } from 'lucide-react';

import { EcEmpty, EcError, EcLoading } from '@/components/ui/states';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { naverMapSearchUrl } from '@/lib/naverMap';
import { Footer } from '@/sections/Footer';
import { Header } from '@/sections/Header';
import { CourseMiniMap } from './PlannerPage/components/courseBuilder/CourseMiniMap';
import {
  googleMapsUrl,
  persistDraft,
  type CourseDay,
  type CourseDraft,
  type CourseStop,
} from './PlannerPage/components/courseBuilder/courseOps';
import '@/styles/editorial-shared-course.css';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type SharedCourseState = 'loading' | 'ready' | 'empty' | 'error' | 'not-found';

interface SharedCourseResult {
  requestKey: string;
  state: SharedCourseState;
  course: CourseDraft | null;
  partial: boolean;
}

interface SharedCourseCopy {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  title: string;
  intro: string;
  loading: string;
  notFoundTitle: string;
  notFoundBody: string;
  errorTitle: string;
  errorBody: string;
  emptyTitle: string;
  emptyBody: string;
  partialTitle: string;
  partialBody: string;
  retry: string;
  home: string;
  planner: string;
  day: string;
  daysLabel: string;
  summary: string;
  naver: string;
  google: string;
  mapTitle: string;
  start: string;
  startHint: string;
}

const COPY: Record<Language, SharedCourseCopy> = {
  ko: {
    pageTitle: '공유된 코스 | CocoTrip',
    pageDescription: 'CocoTrip에서 공유된 한국 여행 코스를 확인하세요.',
    eyebrow: '공개 일정',
    title: '공유된 코스',
    intro: '날짜별 장소와 이동 순서를 한눈에 확인하고 내 코스 빌더로 가져올 수 있어요.',
    loading: '공유 코스를 불러오는 중',
    notFoundTitle: '이 공유 코스를 찾을 수 없어요.',
    notFoundBody: '링크가 만료되었거나 코스가 삭제되었을 수 있어요.',
    errorTitle: '공유 코스를 불러오지 못했어요.',
    errorBody: '연결을 확인한 뒤 다시 시도해 주세요.',
    emptyTitle: '표시할 장소가 없어요',
    emptyBody: '이 코스에는 아직 공개된 장소가 없어요. 새 코스를 직접 만들 수 있어요.',
    partialTitle: '일부 장소 정보만 표시하고 있어요.',
    partialBody: '형식이 맞지 않는 항목은 제외했어요. 보이는 장소는 그대로 사용할 수 있어요.',
    retry: '다시 시도',
    home: '홈으로',
    planner: '새 코스 만들기',
    day: '일차',
    daysLabel: '코스 날짜',
    summary: '{days}일 · {stops}곳',
    naver: '네이버 지도',
    google: 'Google 지도',
    mapTitle: '오늘의 동선',
    start: '내 플래너에서 이 코스 사용하기',
    startHint: '이 기기의 코스 빌더에 장소를 복사합니다.',
  },
  en: {
    pageTitle: 'Shared course | CocoTrip',
    pageDescription: 'Review a Korea itinerary shared through CocoTrip.',
    eyebrow: 'Public itinerary',
    title: 'Shared course',
    intro: 'Review each day and place in order, then copy the course into your planner.',
    loading: 'Loading shared course',
    notFoundTitle: 'This shared course was not found.',
    notFoundBody: 'The link may have expired or the course may have been removed.',
    errorTitle: 'Could not load this shared course.',
    errorBody: 'Check your connection and try again.',
    emptyTitle: 'There are no places to show',
    emptyBody: 'This course has no public places yet. You can start a new course instead.',
    partialTitle: 'Some place details are unavailable.',
    partialBody: 'Items with an invalid format were left out. The visible places are ready to use.',
    retry: 'Try again',
    home: 'Go home',
    planner: 'Build a new course',
    day: 'Day',
    daysLabel: 'Course days',
    summary: '{days} days · {stops} places',
    naver: 'Naver map',
    google: 'Google Maps',
    mapTitle: "This day's route",
    start: 'Use this course in my planner',
    startHint: 'Copies these places into the course builder on this device.',
  },
  ja: {
    pageTitle: '共有されたコース | CocoTrip',
    pageDescription: 'CocoTripで共有された韓国旅行コースを確認できます。',
    eyebrow: '公開日程',
    title: '共有されたコース',
    intro: '日ごとの場所と順番を確認し、自分のコースビルダーに取り込めます。',
    loading: '共有コースを読み込んでいます',
    notFoundTitle: 'この共有コースは見つかりませんでした。',
    notFoundBody: 'リンクの期限が切れたか、コースが削除された可能性があります。',
    errorTitle: '共有コースを読み込めませんでした。',
    errorBody: '接続を確認して、もう一度お試しください。',
    emptyTitle: '表示できる場所がありません',
    emptyBody: 'このコースには公開された場所がまだありません。新しいコースを作成できます。',
    partialTitle: '一部の場所情報を表示できません。',
    partialBody: '形式が正しくない項目は除外しました。表示中の場所はそのまま利用できます。',
    retry: '再試行',
    home: 'ホームへ',
    planner: '新しいコースを作る',
    day: '日目',
    daysLabel: 'コースの日程',
    summary: '{days}日 · {stops}か所',
    naver: 'Naver地図',
    google: 'Googleマップ',
    mapTitle: 'この日のルート',
    start: 'このコースをプランナーで使う',
    startHint: 'この端末のコースビルダーに場所をコピーします。',
  },
  zh: {
    pageTitle: '共享行程 | CocoTrip',
    pageDescription: '查看通过CocoTrip共享的韩国旅行行程。',
    eyebrow: '公开行程',
    title: '共享行程',
    intro: '按天查看地点和顺序，然后将行程复制到你的规划工具。',
    loading: '正在加载共享行程',
    notFoundTitle: '未找到此共享行程。',
    notFoundBody: '链接可能已过期，或该行程已被删除。',
    errorTitle: '无法加载此共享行程。',
    errorBody: '请检查网络连接后重试。',
    emptyTitle: '没有可显示的地点',
    emptyBody: '此行程还没有公开地点。你可以新建一个行程。',
    partialTitle: '部分地点信息无法显示。',
    partialBody: '格式不正确的项目已被排除。当前显示的地点仍可正常使用。',
    retry: '重试',
    home: '返回首页',
    planner: '新建行程',
    day: '第{day}天',
    daysLabel: '行程日期',
    summary: '{days}天 · {stops}个地点',
    naver: 'Naver地图',
    google: 'Google地图',
    mapTitle: '当天路线',
    start: '在规划工具中使用此行程',
    startHint: '将这些地点复制到此设备的行程工具中。',
  },
};

const CATEGORY_LABELS: Record<Language, Record<string, string>> = {
  ko: { food: '맛집', sight: '명소', show: '공연', stay: '숙소', etc: '기타' },
  en: { food: 'Food', sight: 'Sight', show: 'Show', stay: 'Stay', etc: 'Other' },
  ja: { food: '食事', sight: '観光', show: '公演', stay: '宿泊', etc: 'その他' },
  zh: { food: '美食', sight: '景点', show: '演出', stay: '住宿', etc: '其他' },
};

function toLanguage(value: string): Language {
  return value === 'ko' || value === 'ja' || value === 'zh' ? value : 'en';
}

function normaliseStop(value: unknown, index: number): CourseStop | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return null;

  const stop: CourseStop = {
    id: typeof input.id === 'string' && input.id ? input.id : `shared-${index}`,
    time: typeof input.time === 'string' ? input.time : '',
    title,
    category: typeof input.category === 'string' && input.category ? input.category : 'etc',
    memo: typeof input.memo === 'string' ? input.memo : '',
  };
  if (typeof input.lat === 'number' && Number.isFinite(input.lat)) stop.lat = input.lat;
  if (typeof input.lng === 'number' && Number.isFinite(input.lng)) stop.lng = input.lng;
  return stop;
}

function normaliseCourse(data: unknown): { course: CourseDraft; partial: boolean } | null {
  if (!data || typeof data !== 'object') return null;
  const input = data as Record<string, unknown>;
  if (!Array.isArray(input.days)) return null;

  let partial = false;
  let stopIndex = 0;
  const days: CourseDay[] = input.days.map((value) => {
    if (!value || typeof value !== 'object') {
      partial = true;
      return { stops: [] };
    }
    const rawStops = (value as Record<string, unknown>).stops;
    if (!Array.isArray(rawStops)) {
      partial = true;
      return { stops: [] };
    }
    const stops = rawStops.map((stop) => {
      stopIndex += 1;
      return normaliseStop(stop, stopIndex);
    }).filter((stop): stop is CourseStop => {
      if (!stop) partial = true;
      return Boolean(stop);
    });
    return { stops };
  });

  return {
    course: { v: 1, days: days.length ? days : [{ stops: [] }], updatedAt: Date.now() },
    partial,
  };
}

function formatTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

export default function SharedCoursePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language, t: globalCopy, changeLanguage } = useLanguage();
  const activeLanguage = toLanguage(language);
  const copy = COPY[activeLanguage];

  usePageMeta({ title: copy.pageTitle, description: copy.pageDescription });

  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${id || ''}:${retryKey}`;
  const [result, setResult] = useState<SharedCourseResult>({
    requestKey: '',
    state: 'loading',
    course: null,
    partial: false,
  });
  const [daySelection, setDaySelection] = useState({ requestKey: '', index: 0 });

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const response = await fetch(`/api/course-share?id=${encodeURIComponent(String(id || ''))}`);
        const body = await response.json().catch(() => null);
        if (!alive) return;

        if (response.ok && body && body.ok && body.data) {
          const normalised = normaliseCourse(body.data);
          if (!normalised) {
            setResult({ requestKey, state: 'error', course: null, partial: false });
            return;
          }
          const totalStops = normalised.course.days.reduce((count, day) => count + day.stops.length, 0);
          setResult({
            requestKey,
            state: totalStops > 0 ? 'ready' : 'empty',
            course: normalised.course,
            partial: normalised.partial,
          });
          return;
        }

        const code = body && typeof body.code === 'string' ? body.code : '';
        if (response.status === 404 || response.status === 400 || code === 'NOT_FOUND' || code === 'BAD_ID') {
          setResult({ requestKey, state: 'not-found', course: null, partial: false });
          return;
        }
        setResult({ requestKey, state: 'error', course: null, partial: false });
      } catch {
        if (alive) setResult({ requestKey, state: 'error', course: null, partial: false });
      }
    })();

    return () => { alive = false; };
  }, [id, requestKey]);

  const isCurrentResult = result.requestKey === requestKey;
  const state = isCurrentResult ? result.state : 'loading';
  const course = isCurrentResult ? result.course : null;
  const partial = isCurrentResult ? result.partial : false;
  const activeDay = daySelection.requestKey === requestKey ? daySelection.index : 0;

  const totalStops = course ? course.days.reduce((count, day) => count + day.stops.length, 0) : 0;
  const dayIndex = course ? Math.min(activeDay, Math.max(course.days.length - 1, 0)) : 0;
  const selectedDay = course && course.days[dayIndex] ? course.days[dayIndex] : { stops: [] as CourseStop[] };
  const summary = course
    ? formatTemplate(copy.summary, { days: course.days.length, stops: totalStops })
    : '';

  const handleStart = () => {
    if (!course) return;
    persistDraft(course);
    navigate('/planner?mode=course');
  };

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!course) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % course.days.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + course.days.length) % course.days.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = course.days.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    setDaySelection({ requestKey, index: nextIndex });
    document.getElementById(`shared-course-tab-${nextIndex + 1}`)?.focus();
  };

  const renderState = () => {
    if (state === 'loading') {
      return (
        <section data-testid="shared-course-loading" aria-busy="true" className="shared-course-state ec-card">
          <EcLoading label={copy.loading} lines={6} />
        </section>
      );
    }

    if (state === 'not-found') {
      return (
        <section data-testid="shared-course-not-found" className="shared-course-state">
          <EcEmpty
            title={copy.notFoundTitle}
            body={copy.notFoundBody}
            action={<Link to="/" className="ec-btn ec-btn-secondary">{copy.home}</Link>}
          />
        </section>
      );
    }

    if (state === 'error') {
      return (
        <section data-testid="shared-course-error" className="shared-course-state">
          <EcError
            title={copy.errorTitle}
            body={copy.errorBody}
            retryLabel={copy.retry}
            onRetry={() => setRetryKey((value) => value + 1)}
            secondary={<Link to="/" className="ec-btn ec-btn-secondary">{copy.home}</Link>}
          />
        </section>
      );
    }

    if (state === 'empty') {
      return (
        <section data-testid="shared-course-empty" className="shared-course-state">
          <EcEmpty
            title={copy.emptyTitle}
            body={copy.emptyBody}
            action={<Link to="/planner?mode=course" className="ec-btn ec-btn-primary">{copy.planner}</Link>}
          />
        </section>
      );
    }

    if (state !== 'ready' || !course) return null;

    return (
      <section data-testid="shared-course-ready" className="shared-course-document">
        {partial && (
          <aside className="shared-course-partial" role="status" aria-live="polite">
            <p className="ec-eyebrow">{copy.partialTitle}</p>
            <p className="ec-body-sm">{copy.partialBody}</p>
          </aside>
        )}

        <div className="shared-course-day-tabs" role="tablist" aria-label={copy.daysLabel}>
          {course.days.map((day, index) => {
            const label = activeLanguage === 'zh'
              ? formatTemplate(copy.day, { day: index + 1 })
              : activeLanguage === 'en'
                ? `${copy.day} ${index + 1}`
                : `${index + 1}${copy.day}`;
            return (
              <button
                key={`day-${index + 1}`}
                id={`shared-course-tab-${index + 1}`}
                type="button"
                role="tab"
                aria-selected={index === dayIndex}
                aria-controls={`shared-course-panel-${index + 1}`}
                tabIndex={index === dayIndex ? 0 : -1}
                className={index === dayIndex ? 'is-active' : ''}
                onClick={() => setDaySelection({ requestKey, index })}
                onKeyDown={(event) => handleDayKeyDown(event, index)}
              >
                <span>{label}</span>
                <span className="shared-course-day-count">{day.stops.length}</span>
              </button>
            );
          })}
        </div>

        <div
          id={`shared-course-panel-${dayIndex + 1}`}
          role="tabpanel"
          aria-labelledby={`shared-course-tab-${dayIndex + 1}`}
          className="shared-course-day-panel"
        >
          <div className="shared-course-map">
            <CourseMiniMap stops={selectedDay.stops} title={copy.mapTitle} />
          </div>

          <ol className="shared-course-stop-list">
            {selectedDay.stops.map((stop, index) => (
              <li key={stop.id} className="shared-course-stop-card">
                <span className="shared-course-stop-number" aria-hidden>{index + 1}</span>
                <div className="shared-course-stop-body">
                  <div className="shared-course-stop-meta">
                    {stop.time && <span>{stop.time}</span>}
                    <span>{CATEGORY_LABELS[activeLanguage][stop.category] || CATEGORY_LABELS[activeLanguage].etc}</span>
                  </div>
                  <h2>{stop.title}</h2>
                  {stop.memo && <p>{stop.memo}</p>}
                  <div className="shared-course-map-links">
                    <a href={naverMapSearchUrl(stop.title)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden />
                      {copy.naver}
                    </a>
                    <a href={googleMapsUrl(stop)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden />
                      {copy.google}
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="shared-course-handoff">
          <div>
            <p className="ec-h3">{copy.start}</p>
            <p className="ec-body-sm">
              <CalendarDays aria-hidden />
              {copy.startHint}
            </p>
          </div>
          <button type="button" onClick={handleStart} className="ec-btn ec-btn-primary">
            <ListPlus aria-hidden />
            {copy.start}
          </button>
        </div>
      </section>
    );
  };

  return (
    <div className="shared-course-app ec-root min-h-screen">
      <Header language={language} t={globalCopy} onLanguageChange={changeLanguage} />
      <main className="shared-course-main">
        <header className="shared-course-masthead">
          <p className="ec-eyebrow">{copy.eyebrow}</p>
          <div className="shared-course-title-row">
            <h1 className="ec-display">{copy.title}</h1>
            {summary && <span className="shared-course-summary">{summary}</span>}
          </div>
          <p className="ec-body ec-measure">{copy.intro}</p>
        </header>
        {renderState()}
      </main>
      <Footer t={globalCopy} />
    </div>
  );
}
