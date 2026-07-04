/**
 * MyCoursesTab — 마이페이지 '내 코스' 탭 (2026-07-04)
 *
 * 코스 빌더 '내 계정에 저장'(useItinerary, users/{uid}/itineraries)의 열람 UI 복원 —
 * 2026-04-29 일정 탭 제거 후 저장만 되고 볼 곳이 없던 반쪽 기능 완성.
 * 목록(제목·기간·Day/장소 수) + '플래너에서 열기'(draft 로 변환→/planner?mode=course) + 삭제.
 *
 * i18n = 컴포넌트 로컬 4-lang (코스 빌더와 동일 패턴). compact 카드 문법.
 */
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ListPlus, MapPin, Trash2 } from 'lucide-react';

import { useLanguage } from '@/hooks/useLanguage';
import { useItinerary, type Itinerary } from '@/hooks/useItinerary';
import { fromItinerarySlots, persistDraft } from '@/pages/PlannerPage/components/courseBuilder/courseOps';

type Lang = 'ko' | 'en' | 'ja' | 'zh';
const asLang = (s: string): Lang => (s === 'ko' || s === 'ja' || s === 'zh' ? s : 'en');

const I18N: Record<Lang, Record<string, string>> = {
  en: {
    empty: 'No saved courses yet. Build one in the planner and tap "Save to my account".',
    goBuild: 'Open course builder', open: 'Open in planner', del: 'Delete',
    delConfirm: 'Delete this course?', days: 'days', stops: 'stops', loading: 'Loading…',
  },
  ko: {
    empty: '저장된 코스가 없어요. 플래너에서 코스를 만들고 "내 계정에 저장"을 눌러보세요.',
    goBuild: '코스 빌더 열기', open: '플래너에서 열기', del: '삭제',
    delConfirm: '이 코스를 삭제할까요?', days: '일', stops: '개 장소', loading: '불러오는 중…',
  },
  ja: {
    empty: '保存されたコースはまだありません。プランナーで作成して「アカウントに保存」を押してください。',
    goBuild: 'コースビルダーを開く', open: 'プランナーで開く', del: '削除',
    delConfirm: 'このコースを削除しますか？', days: '日', stops: 'か所', loading: '読み込み中…',
  },
  zh: {
    empty: '还没有保存的行程。在规划器中创建后点击"保存到我的账户"。',
    goBuild: '打开行程编辑器', open: '在规划器中打开', del: '删除',
    delConfirm: '删除这个行程？', days: '天', stops: '个地点', loading: '加载中…',
  },
};

const CARD = 'rounded-xl border border-white/10 bg-white/[0.035] sm:rounded-2xl';

export function MyCoursesTab() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = I18N[asLang(language)];
  const { itineraries, loading, deleteItinerary } = useItinerary();

  const handleOpen = (it: Itinerary) => {
    const draft = fromItinerarySlots(it.days.map((d) => d.slots));
    persistDraft(draft);
    navigate('/planner?mode=course');
  };

  if (loading) return <p className="text-sm text-white/50">{t.loading}</p>;

  if (!itineraries.length) {
    return (
      <div className={`${CARD} p-5 text-center`}>
        <p className="text-sm leading-relaxed text-white/55">{t.empty}</p>
        <button
          type="button"
          onClick={() => navigate('/planner?mode=course')}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[12px] font-black text-white"
          style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
        >
          <ListPlus className="h-4 w-4" /> {t.goBuild}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {itineraries.map((it) => {
        const stops = it.days.reduce((n, d) => n + d.slots.length, 0);
        return (
          <div key={it.id} className={`${CARD} flex items-center gap-3 p-3 sm:p-3.5`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'rgba(182,104,252,0.15)' }}>
              <MapPin className="h-4 w-4 text-[#B668FC]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-black text-white sm:text-[14px]">{it.title}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-white/40">
                <CalendarDays className="h-3 w-3" />
                {it.startDate}{it.endDate && it.endDate !== it.startDate ? ` ~ ${it.endDate}` : ''}
                {' · '}{it.days.length}{t.days} · {stops}{t.stops}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleOpen(it)}
                className="rounded-lg px-3 py-2 text-[11px] font-black text-white sm:rounded-xl"
                style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
              >
                {t.open}
              </button>
              <button
                type="button"
                aria-label={t.del}
                onClick={() => { if (window.confirm(t.delConfirm)) void deleteItinerary(it.id); }}
                className="rounded-lg border border-white/[0.10] p-2 text-white/35 hover:text-rose-300 sm:rounded-xl"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
