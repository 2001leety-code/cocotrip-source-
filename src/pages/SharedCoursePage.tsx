/**
 * SharedCoursePage — /s/:id 공유 코스 공개 열람 (2026-07-04)
 *
 * 코스 빌더의 저장형 공유 수신 페이지. GET /api/course-share?id= 로 조회(공개 —
 * 장소명/시간/메모뿐, PII 없음) → Day 탭 + 스탑 리스트 읽기전용 + 지도 링크.
 * "이 코스로 시작하기" = draft 로 로컬 저장 후 /planner?mode=course (게스트 OK).
 *
 * i18n = 컴포넌트 로컬 4-lang (코스 빌더와 동일 패턴). compact 카드 문법.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CalendarDays, ExternalLink, ListPlus, MapPin } from 'lucide-react';

import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { naverMapSearchUrl } from '@/lib/naverMap';
import {
  googleMapsUrl, persistDraft, type CourseDraft, type CourseStop,
} from './PlannerPage/components/courseBuilder/courseOps';

type Lang = 'ko' | 'en' | 'ja' | 'zh';
const asLang = (s: string): Lang => (s === 'ko' || s === 'ja' || s === 'zh' ? s : 'en');

const I18N: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Shared course', loading: 'Loading course…',
    notFound: 'This shared course was not found or has been removed.',
    day: 'Day', stops: 'stops', naver: 'Naver', google: 'Google',
    start: 'Use this course in my planner', startHint: 'Opens the course builder with these places — free, no login.',
    home: 'Go home',
  },
  ko: {
    title: '공유된 코스', loading: '코스 불러오는 중…',
    notFound: '공유 코스를 찾을 수 없거나 삭제되었습니다.',
    day: 'Day', stops: '개 장소', naver: '네이버', google: '구글',
    start: '이 코스로 시작하기', startHint: '이 장소들로 코스 빌더가 열립니다 — 무료, 로그인 불필요.',
    home: '홈으로',
  },
  ja: {
    title: '共有されたコース', loading: 'コースを読み込み中…',
    notFound: '共有コースが見つからないか、削除されました。',
    day: 'Day', stops: 'か所', naver: 'Naver', google: 'Google',
    start: 'このコースで始める', startHint: 'この場所でコースビルダーが開きます — 無料・ログイン不要。',
    home: 'ホームへ',
  },
  zh: {
    title: '共享行程', loading: '正在加载行程…',
    notFound: '找不到该共享行程，或已被删除。',
    day: 'Day', stops: '个地点', naver: 'Naver', google: 'Google',
    start: '用这个行程开始', startHint: '将用这些地点打开行程编辑器 — 免费，无需登录。',
    home: '回到首页',
  },
};

const CAT_LABEL: Record<Lang, Record<string, string>> = {
  en: { food: 'Food', sight: 'Sight', show: 'Show', stay: 'Stay', etc: 'Etc' },
  ko: { food: '맛집', sight: '관광', show: '공연', stay: '숙소', etc: '기타' },
  ja: { food: 'グルメ', sight: '観光', show: '公演', stay: '宿泊', etc: 'その他' },
  zh: { food: '美食', sight: '景点', show: '演出', stay: '住宿', etc: '其他' },
};

const CARD = 'rounded-xl border border-white/10 bg-white/[0.035] sm:rounded-2xl';

export default function SharedCoursePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language, t: gt, changeLanguage } = useLanguage();
  const lang = asLang(language);
  const t = I18N[lang];
  usePageMeta({ title: 'Shared Course — CocoTrip', description: 'A Korea trip course shared via CocoTrip course builder.' });

  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [course, setCourse] = useState<CourseDraft | null>(null);
  const [activeDay, setActiveDay] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/course-share?id=${encodeURIComponent(String(id || ''))}`);
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (json?.ok && json.data && Array.isArray(json.data.days)) {
          setCourse({ v: 1, days: json.data.days, updatedAt: Date.now() });
          setState('ready');
        } else {
          setState('notfound');
        }
      } catch {
        if (alive) setState('notfound');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const handleStart = () => {
    if (!course) return;
    persistDraft(course);
    navigate('/planner?mode=course');
  };

  const day = course?.days[Math.min(activeDay, (course?.days.length ?? 1) - 1)] ?? { stops: [] };
  const total = course?.days.reduce((n, d) => n + d.stops.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      <Header language={language} t={gt} onLanguageChange={changeLanguage} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-3 flex items-center gap-2 text-lg font-black sm:text-xl">
          <MapPin className="h-5 w-5 text-[#B668FC]" /> {t.title}
          {state === 'ready' && (
            <span className="text-[11px] font-bold text-white/40">{total}{t.stops}</span>
          )}
        </h1>

        {state === 'loading' && <p className="text-sm text-white/50">{t.loading}</p>}

        {state === 'notfound' && (
          <div className={`${CARD} p-5 text-center`}>
            <p className="text-sm text-white/60">{t.notFound}</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-4 rounded-xl border border-white/[0.14] px-4 py-2 text-[12px] font-bold text-white/70"
            >
              {t.home}
            </button>
          </div>
        )}

        {state === 'ready' && course && (
          <>
            {/* Day 탭 */}
            <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {course.days.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveDay(i)}
                  className={`h-8 shrink-0 rounded-full px-3.5 text-[11px] font-black sm:h-9 sm:px-4 sm:text-[12px] ${i === activeDay ? 'text-white' : 'text-white/50'}`}
                  style={i === activeDay
                    ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.52)' }
                    : { background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {t.day} {i + 1}
                  <span className="ml-1 text-[9px] font-bold text-white/40">{d.stops.length}</span>
                </button>
              ))}
            </div>

            {/* 스탑 리스트 (읽기전용) */}
            <div className="space-y-1.5">
              {day.stops.map((stop: CourseStop, idx: number) => (
                <div key={stop.id} className={`${CARD} flex gap-2.5 p-2.5`}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime-300 text-[11px] font-black text-[#101522] sm:h-7 sm:w-7">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {stop.time && <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold text-white/60">{stop.time}</span>}
                      <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-purple-200">
                        {CAT_LABEL[lang][stop.category] ?? CAT_LABEL[lang].etc}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] font-black leading-snug sm:text-[14px]">{stop.title}</p>
                    {stop.memo && <p className="mt-0.5 text-[10.5px] leading-relaxed text-white/40">{stop.memo}</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <a href={naverMapSearchUrl(stop.title)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] font-bold text-[#7CE372]">
                        <ExternalLink className="h-2.5 w-2.5" /> {t.naver}
                      </a>
                      <a href={googleMapsUrl(stop)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] font-bold text-[#8AB4F8]">
                        <ExternalLink className="h-2.5 w-2.5" /> {t.google}
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA — 내 플래너로 */}
            <div className={`${CARD} mt-4 p-3.5 sm:p-4`} style={{ borderColor: 'rgba(182,104,252,0.25)' }}>
              <button
                type="button"
                onClick={handleStart}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-black text-white sm:text-[14px]"
                style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
              >
                <ListPlus className="h-4 w-4" /> {t.start}
              </button>
              <p className="mt-2 flex items-center justify-center gap-1 text-center text-[10.5px] text-white/40">
                <CalendarDays className="h-3 w-3" /> {t.startHint}
              </p>
            </div>
          </>
        )}
      </main>
      <Footer t={gt} />
    </div>
  );
}
