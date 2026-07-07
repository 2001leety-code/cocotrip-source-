/**
 * CourseBuilderShell — "내 장소로 코스 만들기" MVP (2026-07-04, 정적 목업 → 실동작).
 *
 * 기능: 장소 추가/인라인 수정/삭제 · 시간 입력 · Day 탭 + Day 간 이동 · 추천 장소(정적
 * attractions DB) 추가 · localStorage 자동저장 · 공유(mock URL = 코스를 #course= 해시에
 * base64 로 실어 복사) · Naver/Google 지도 링크 · 로그인 시 내 계정 저장(useItinerary).
 *
 * 설계:
 * - 로직 = courseBuilder/courseOps.ts 순수함수(잠금테스트) + useCourseBuilder 훅.
 * - 디자인 = 차터 compact 카드 문법(모바일 초소형 기본 + sm: 확대). 기존 목업의
 *   가짜 지도/가짜 환승/가짜 AI 패널은 제거(허위 데이터 + 큰 박스 남발 금지).
 * - i18n = 컴포넌트 로컬 4-lang 딕셔너리 (AddressAutocomplete 패턴).
 */
import { useMemo, useState } from 'react';
import {
  CalendarDays, Check, Clock, ExternalLink, MapPin,
  PencilLine, Plus, Share2, Sparkles, Trash2, X, Wand2, LogIn,
} from 'lucide-react';

import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { authFetch } from '@/lib/authFetch';
import { useItinerary } from '@/hooks/useItinerary';
import { naverMapSearchUrl } from '@/lib/naverMap';
import { useCourseBuilder } from './courseBuilder/useCourseBuilder';
import { googleMapsUrl, toItinerarySlot, COURSE_MAX_DAYS, type CourseStop } from './courseBuilder/courseOps';
import { recoCities, recoForCity, type RecoPlace } from './courseBuilder/recommendations';
import { CoursePlaceSearch, type CoursePlacePick } from './courseBuilder/CoursePlaceSearch';
import { CourseMiniMap } from './courseBuilder/CourseMiniMap';

// ── i18n (4-lang 컴포넌트 로컬 — AddressAutocomplete 패턴) ───────────────
type Lang = 'ko' | 'en' | 'ja' | 'zh';
const asLang = (s: string): Lang => (s === 'ko' || s === 'ja' || s === 'zh' ? s : 'en');

const I18N: Record<Lang, Record<string, string>> = {
  en: {
    day: 'Day', addDay: '+ Day', delDay: 'Delete this day?', newCourse: 'New course',
    resetConfirm: 'Clear this course and start over?',
    addTitle: 'Add a place', namePh: 'Place name or address (e.g. Hongdae BBQ)',
    time: 'Time', memoPh: 'Memo (optional)', addBtn: 'Add to Day',
    catFood: 'Food', catSight: 'Sight', catShow: 'Show', catStay: 'Stay', catEtc: 'Etc',
    empty: 'No places yet. Add your first stop above, or pick from recommendations.',
    edit: 'Edit', done: 'Done', delete: 'Delete', delConfirm: 'Remove this place?',
    moveTo: 'Move to', naver: 'Naver', google: 'Google',
    recoTitle: 'Recommended places', recoAdd: '+ Add', allCities: 'All',
    share: 'Share', shareCopied: 'Link copied!', shareFail: 'Copy failed — try again',
    saveAccount: 'Save to my account', saveDone: 'Saved to My Page!', saveFail: 'Save failed — try again',
    saved: 'Auto-saved on this device', stops: 'stops',
    search: 'Search', mapTitle: "This day's route",
    aiOptimize: 'AI optimize route', aiBusy: 'Optimizing…', aiRecosTitle: 'AI nearby picks', aiAdd: '+ Add',
    aiLocked: 'AI optimize & nearby picks unlock with the $9.90 planner.',
    saveTitleField: 'Course title', saveDateField: 'Trip date', saveTitlePh: 'e.g. My Seoul food trip',
    saveCta: 'Save', cancel: 'Cancel',
    loginToSave: 'Sign in to save, share, and open on any device.', loginBtn: 'Sign in',
  },
  ko: {
    day: 'Day', addDay: '+ 일차', delDay: '이 일차를 삭제할까요?', newCourse: '새 코스',
    resetConfirm: '코스를 비우고 새로 시작할까요?',
    addTitle: '장소 추가', namePh: '장소 이름이나 주소 (예: 홍대 고깃집)',
    time: '시간', memoPh: '메모 (선택)', addBtn: 'Day에 추가',
    catFood: '맛집', catSight: '관광', catShow: '공연', catStay: '숙소', catEtc: '기타',
    empty: '아직 장소가 없어요. 위에서 직접 추가하거나 추천에서 골라보세요.',
    edit: '수정', done: '완료', delete: '삭제', delConfirm: '이 장소를 삭제할까요?',
    moveTo: '이동', naver: '네이버', google: '구글',
    recoTitle: '추천 장소', recoAdd: '+ 추가', allCities: '전체',
    share: '공유', shareCopied: '링크 복사됨!', shareFail: '복사 실패 — 다시 시도',
    saveAccount: '내 계정에 저장', saveDone: '마이페이지에 저장됨!', saveFail: '저장 실패 — 다시 시도',
    saved: '이 기기에 자동 저장됨', stops: '개 장소',
    search: '검색', mapTitle: '이 날의 동선',
    aiOptimize: 'AI 동선 최적화', aiBusy: '최적화 중…', aiRecosTitle: 'AI 주변 추천', aiAdd: '+ 추가',
    aiLocked: 'AI 동선 최적화·주변 추천은 $9.90 플래너에서 열려요.',
    saveTitleField: '코스 제목', saveDateField: '여행 날짜', saveTitlePh: '예: 나의 서울 맛집 투어',
    saveCta: '저장', cancel: '취소',
    loginToSave: '로그인하면 저장·공유·다른 기기에서 볼 수 있어요.', loginBtn: '로그인',
  },
  ja: {
    day: 'Day', addDay: '+ 日目', delDay: 'この日を削除しますか？', newCourse: '新規コース',
    resetConfirm: 'コースをクリアして最初からやり直しますか？',
    addTitle: '場所を追加', namePh: '場所の名前や住所（例: ホンデ焼肉）',
    time: '時間', memoPh: 'メモ（任意）', addBtn: 'Dayに追加',
    catFood: 'グルメ', catSight: '観光', catShow: '公演', catStay: '宿泊', catEtc: 'その他',
    empty: 'まだ場所がありません。上から追加するか、おすすめから選んでください。',
    edit: '編集', done: '完了', delete: '削除', delConfirm: 'この場所を削除しますか？',
    moveTo: '移動', naver: 'Naver', google: 'Google',
    recoTitle: 'おすすめの場所', recoAdd: '+ 追加', allCities: 'すべて',
    share: '共有', shareCopied: 'リンクをコピーしました！', shareFail: 'コピー失敗 — もう一度',
    saveAccount: 'アカウントに保存', saveDone: 'マイページに保存しました！', saveFail: '保存失敗 — もう一度',
    saved: 'この端末に自動保存', stops: 'か所',
    search: '検索', mapTitle: 'この日のルート',
    aiOptimize: 'AIルート最適化', aiBusy: '最適化中…', aiRecosTitle: 'AI周辺のおすすめ', aiAdd: '+ 追加',
    aiLocked: 'AIルート最適化・周辺のおすすめは$9.90プランで解放。',
    saveTitleField: 'コース名', saveDateField: '旅行日', saveTitlePh: '例: ソウルグルメ旅',
    saveCta: '保存', cancel: 'キャンセル',
    loginToSave: 'ログインすると保存・共有・他の端末で表示できます。', loginBtn: 'ログイン',
  },
  zh: {
    day: 'Day', addDay: '+ 天', delDay: '删除这一天？', newCourse: '新行程',
    resetConfirm: '清空行程重新开始？',
    addTitle: '添加地点', namePh: '地点名称或地址（例: 弘大烤肉店）',
    time: '时间', memoPh: '备注（可选）', addBtn: '添加到Day',
    catFood: '美食', catSight: '景点', catShow: '演出', catStay: '住宿', catEtc: '其他',
    empty: '还没有地点。在上方直接添加，或从推荐中选择。',
    edit: '编辑', done: '完成', delete: '删除', delConfirm: '删除这个地点？',
    moveTo: '移动到', naver: 'Naver', google: 'Google',
    recoTitle: '推荐地点', recoAdd: '+ 添加', allCities: '全部',
    share: '分享', shareCopied: '链接已复制！', shareFail: '复制失败 — 请重试',
    saveAccount: '保存到我的账户', saveDone: '已保存到我的页面！', saveFail: '保存失败 — 请重试',
    saved: '已自动保存到本设备', stops: '个地点',
    search: '搜索', mapTitle: '当天路线',
    aiOptimize: 'AI优化路线', aiBusy: '优化中…', aiRecosTitle: 'AI周边推荐', aiAdd: '+ 添加',
    aiLocked: 'AI优化路线·周边推荐需$9.90行程解锁。',
    saveTitleField: '行程名称', saveDateField: '出行日期', saveTitlePh: '例: 我的首尔美食之旅',
    saveCta: '保存', cancel: '取消',
    loginToSave: '登录后可保存·分享·在其他设备查看。', loginBtn: '登录',
  },
};

interface AiNearby { name: string; lat: number; lng: number; category: string; reason: string; }

const CATEGORIES = ['food', 'sight', 'show', 'stay', 'etc'] as const;
const CAT_KEY: Record<string, string> = { food: 'catFood', sight: 'catSight', show: 'catShow', stay: 'catStay', etc: 'catEtc' };

// compact 카드 문법 (차터 PR #1037 컨벤션 — 모바일 초소형 기본, sm: 확대)
const CARD = 'rounded-xl border border-white/10 bg-white/[0.035] sm:rounded-2xl';
const INPUT = 'rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-[#B668FC]/60 sm:rounded-xl sm:px-3 sm:py-2 sm:text-[13px]';
const CHIP_BTN = 'rounded-full px-2.5 py-1 text-[10px] font-bold sm:text-[11px]';

export function CourseBuilderShell() {
  const { language } = useLanguage();
  const t = I18N[asLang(language)];
  const nameLang = asLang(language);

  const cb = useCourseBuilder();
  const { user } = useAuth();
  const { createItineraryWithSlots } = useItinerary();

  // 새 장소 입력폼 상태
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newCat, setNewCat] = useState<string>('sight');
  const [newMemo, setNewMemo] = useState('');
  // 인라인 수정 대상
  const [editingId, setEditingId] = useState<string | null>(null);
  // 추천 도시 필터
  const [recoCity, setRecoCity] = useState<string | null>(null);
  // 상태 피드백 (공유/저장)
  const [flash, setFlash] = useState<string | null>(null);
  const showFlash = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 2500); };
  // AI 동선 최적화
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRecos, setAiRecos] = useState<AiNearby[]>([]);
  // 저장 모달 (제목/날짜)
  const [showSave, setShowSave] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDate, setSaveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const cities = useMemo(() => recoCities(), []);
  const recos = useMemo(() => recoForCity(recoCity), [recoCity]);

  const day = cb.draft.days[cb.activeDay] ?? { stops: [] };

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    cb.addStop(cb.activeDay, { title: newTitle, time: newTime, category: newCat, memo: newMemo });
    setNewTitle(''); setNewTime(''); setNewMemo('');
  };

  // 자동완성에서 장소 선택 → 좌표까지 저장 (지도 동선 가능). 주소는 memo 로 보존.
  const handlePickPlace = (p: CoursePlacePick) => {
    cb.addStop(cb.activeDay, {
      title: p.title, time: newTime, category: newCat,
      memo: p.address || newMemo,
      ...(typeof p.lat === 'number' ? { lat: p.lat } : {}),
      ...(typeof p.lng === 'number' ? { lng: p.lng } : {}),
    });
    setNewTitle(''); setNewTime(''); setNewMemo('');
  };

  // AI 동선 최적화 — 활성 Day stop(좌표 있는) 을 course-ai 로 재정렬 + 주변 추천.
  const handleAiOptimize = async () => {
    const stops = day.stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    if (stops.length < 2) { showFlash(t.aiBusy); return; }
    setAiBusy(true);
    try {
      // authFetch = Firebase 토큰 첨부 → course-ai 가 $9.90 구매자(aiFeaturesUnlocked)만 허용.
      const res = await authFetch('/api/course-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: day.stops.map((s) => ({ id: s.id, title: s.title, category: s.category, lat: s.lat, lng: s.lng })),
          lang: nameLang,
        }),
      });
      const json = await res.json().catch(() => ({}));
      // 무료/비로그인 = 유료 AI 기능 잠김 → 업셀 안내(에러 아님).
      if (res.status === 403 && json?.code === 'AI_FEATURE_LOCKED') { showFlash(t.aiLocked); return; }
      if (json?.ok) {
        if (Array.isArray(json.optimizedOrder) && json.optimizedOrder.length) {
          cb.reorderStops(cb.activeDay, json.optimizedOrder.map(String));
        }
        setAiRecos(Array.isArray(json.nearby) ? json.nearby : []);
      }
    } catch { /* fail-soft: 조용히 무시 */ } finally {
      setAiBusy(false);
    }
  };

  const handleAddAiReco = (n: AiNearby) => {
    cb.addStop(cb.activeDay, { title: n.name, time: '', category: n.category || 'sight', memo: '', lat: n.lat, lng: n.lng });
    setAiRecos((prev) => prev.filter((x) => x !== n));
  };

  const handleSaveWithMeta = async () => {
    setSaving(true);
    try {
      const title = saveTitle.trim() || `Course ${saveDate}`;
      const slotsPerDay = cb.draft.days.map((d) => d.stops.map(toItinerarySlot));
      const id = await createItineraryWithSlots(title, saveDate, slotsPerDay);
      showFlash(id ? t.saveDone : t.saveFail);
      if (id) setShowSave(false);
    } catch {
      showFlash(t.saveFail);
    } finally {
      setSaving(false);
    }
  };

  const handleAddReco = (p: RecoPlace) => {
    cb.addStop(cb.activeDay, {
      title: p.name[nameLang] || p.name.en, time: '', category: p.theme === 'food' ? 'food' : 'sight',
      memo: '', lat: p.lat, lng: p.lng,
    });
  };

  const handleShare = async () => {
    const url = await cb.share();
    showFlash(url ? t.shareCopied : t.shareFail);
  };

  return (
    // grid-cols-1(=minmax(0,1fr)) 필수 — 템플릿 없는 auto 트랙은 overflow-x-auto 내용까지
    // max-content 로 계산해 모바일 가로 폭주(도시 칩 스트립에서 실측 3200px 오버플로).
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── 메인: Day 탭 + 추가 폼 + 스탑 리스트 ── */}
      <section className={`${CARD} p-2.5 sm:p-4`}>
        {/* Day 탭 */}
        <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {cb.draft.days.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => cb.setActiveDay(i)}
              className={`h-8 shrink-0 rounded-full px-3.5 text-[11px] font-black sm:h-9 sm:px-4 sm:text-[12px] ${i === cb.activeDay ? 'text-white' : 'text-white/50'}`}
              style={i === cb.activeDay
                ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.52)' }
                : { background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {t.day} {i + 1}
              <span className="ml-1 text-[9px] font-bold text-white/40">{d.stops.length}</span>
            </button>
          ))}
          {cb.draft.days.length < COURSE_MAX_DAYS && (
            <button
              type="button"
              onClick={cb.addDay}
              className="h-8 shrink-0 rounded-full border border-dashed border-white/20 px-3 text-[11px] font-bold text-white/55 sm:h-9"
            >
              {t.addDay}
            </button>
          )}
          {cb.draft.days.length > 1 && (
            <button
              type="button"
              aria-label={t.delDay}
              onClick={() => { if (window.confirm(t.delDay)) cb.removeDay(cb.activeDay); }}
              className="ml-auto h-8 shrink-0 rounded-full border border-white/10 px-2.5 text-white/40 sm:h-9"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 장소 추가 폼 — compact */}
        <div className={`${CARD} mb-2.5 p-2.5 sm:p-3`} style={{ borderColor: 'rgba(182,104,252,0.18)' }}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black text-white sm:text-[12px]">
            <PencilLine className="h-3.5 w-3.5 text-[#B668FC]" /> {t.addTitle}
          </p>
          <div className="grid gap-1.5">
            {/* 장소 자동완성 — 검색해서 고르면 좌표까지 저장(지도 동선). 자유입력도 유지. */}
            <CoursePlaceSearch
              value={newTitle}
              onChange={setNewTitle}
              onPick={handlePickPlace}
              onEnterFreeText={handleAdd}
              placeholder={t.namePh}
              searchLabel={t.search}
              lang={nameLang}
              inputClassName={INPUT}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="flex items-center gap-1 text-[10px] text-white/45">
                <Clock className="h-3 w-3" />
                <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={`${INPUT} w-[92px] px-1.5`} />
              </label>
              <div className="flex gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewCat(c)}
                    className={CHIP_BTN}
                    style={newCat === c
                      ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.5)', color: '#E4CCFF' }
                      : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)' }}
                  >
                    {t[CAT_KEY[c]]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-1.5">
              <input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder={t.memoPh} className={`${INPUT} flex-1 min-w-0`} />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newTitle.trim()}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-40 sm:rounded-xl sm:px-4 sm:text-[12px]"
                style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
              >
                <Plus className="h-3.5 w-3.5" /> {t.addBtn} {cb.activeDay + 1}
              </button>
            </div>
          </div>
        </div>

        {/* 동선 미니지도 — 좌표 있는 stop 2곳 이상일 때만 (번호핀+선 + AI 주변추천 앰버 마커) */}
        <CourseMiniMap stops={day.stops} title={t.mapTitle} nearby={aiRecos} />

        {/* AI 동선 최적화 + 주변 추천 — 좌표 있는 stop 2곳 이상일 때만 노출 */}
        {day.stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number').length >= 2 && (
          <div className="mb-2.5">
            <button
              type="button"
              onClick={() => { void handleAiOptimize(); }}
              disabled={aiBusy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50 sm:rounded-xl sm:text-[12px]"
              style={{ background: 'rgba(182,104,252,0.16)', border: '1px solid rgba(182,104,252,0.45)' }}
            >
              <Wand2 className="h-3.5 w-3.5 text-[#E4CCFF]" /> {aiBusy ? t.aiBusy : t.aiOptimize}
            </button>
            {aiRecos.length > 0 && (
              <div className="mt-2 rounded-xl border border-white/10 p-2" style={{ background: 'rgba(182,104,252,0.05)' }}>
                <p className="mb-1.5 flex items-center gap-1 text-[10.5px] font-bold text-[#B9A4FF]">
                  <Sparkles className="h-3 w-3" /> {t.aiRecosTitle}
                </p>
                <div className="flex flex-col gap-1">
                  {aiRecos.map((n, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-bold text-white">{n.name}</p>
                        {n.reason && <p className="truncate text-[10px] text-white/45">{n.reason}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddAiReco(n)}
                        className="shrink-0 rounded-md px-2 py-1 text-[10px] font-bold text-white"
                        style={{ background: 'rgba(182,104,252,0.25)' }}
                      >
                        {t.aiAdd}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 스탑 리스트 */}
        {day.stops.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/[0.14] px-3 py-6 text-center text-[11px] leading-relaxed text-white/40 sm:text-[12px]">
            {t.empty}
          </p>
        ) : (
          <div className="space-y-1.5">
            {day.stops.map((stop, idx) => (
              <StopRow
                key={stop.id}
                stop={stop}
                index={idx}
                t={t}
                editing={editingId === stop.id}
                dayCount={cb.draft.days.length}
                activeDay={cb.activeDay}
                onEdit={() => setEditingId(stop.id)}
                onDone={() => setEditingId(null)}
                onPatch={(patch) => cb.updateStop(cb.activeDay, stop.id, patch)}
                onDelete={() => { if (window.confirm(t.delConfirm)) cb.removeStop(cb.activeDay, stop.id); }}
                onMove={(toDay) => { cb.moveStopToDay(cb.activeDay, stop.id, toDay); setEditingId(null); }}
              />
            ))}
          </div>
        )}

        {/* 하단 액션 바 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black text-white sm:rounded-xl sm:text-[12px]"
            style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
          >
            <Share2 className="h-3.5 w-3.5" /> {t.share}
          </button>
          {user ? (
            <button
              type="button"
              onClick={() => { setSaveTitle(''); setShowSave(true); }}
              disabled={cb.totalStops === 0}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.14] px-3 py-2 text-[11px] font-bold text-white/70 disabled:opacity-40 sm:rounded-xl sm:text-[12px]"
            >
              <Check className="h-3.5 w-3.5" /> {t.saveAccount}
            </button>
          ) : (
            cb.totalStops > 0 && (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="flex items-center gap-1.5 rounded-lg border border-[#B668FC]/35 px-3 py-2 text-[11px] font-bold text-[#E4CCFF] sm:rounded-xl sm:text-[12px]"
                style={{ background: 'rgba(182,104,252,0.10)' }}
                title={t.loginToSave}
              >
                <LogIn className="h-3.5 w-3.5" /> {t.loginBtn}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => { if (window.confirm(t.resetConfirm)) cb.reset(); }}
            className="rounded-lg border border-white/[0.10] px-3 py-2 text-[11px] font-bold text-white/45 sm:rounded-xl sm:text-[12px]"
          >
            {t.newCourse}
          </button>
          <span className="ml-auto flex items-center gap-1 text-[9.5px] text-white/35 sm:text-[10.5px]">
            {flash ? (
              <span className="font-bold text-[#B9F36E]">{flash}</span>
            ) : (
              <>
                <CalendarDays className="h-3 w-3" />
                {cb.totalStops}{t.stops} · {t.saved}
              </>
            )}
          </span>
        </div>
      </section>

      {/* ── 추천 패널 (정적 attractions DB — 진짜 데이터) ── */}
      <aside className={`${CARD} h-fit p-2.5 sm:p-3.5`}>
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-black text-white sm:text-[13px]">
          <Sparkles className="h-3.5 w-3.5 text-[#B668FC]" /> {t.recoTitle}
        </p>
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <button
            type="button"
            onClick={() => setRecoCity(null)}
            className={`${CHIP_BTN} shrink-0`}
            style={recoCity === null
              ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.5)', color: '#E4CCFF' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)' }}
          >
            {t.allCities}
          </button>
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setRecoCity(c)}
              className={`${CHIP_BTN} shrink-0 capitalize`}
              style={recoCity === c
                ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.5)', color: '#E4CCFF' }
                : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)' }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="space-y-1 max-h-[420px] overflow-y-auto pr-0.5">
          {recos.map((p) => (
            <div key={p.key} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2 py-1.5">
              <MapPin className="h-3 w-3 shrink-0 text-white/30" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-bold text-white/85">{p.name[nameLang] || p.name.en}</p>
                <p className="text-[9px] text-white/35 capitalize">{p.city}{typeof p.rating === 'number' ? ` · ★${p.rating}` : ''}</p>
              </div>
              <button
                type="button"
                onClick={() => handleAddReco(p)}
                className="shrink-0 rounded-full bg-lime-300/15 px-2 py-0.5 text-[10px] font-black text-lime-200"
              >
                {t.recoAdd}
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── 저장 모달 (제목/여행 날짜) — 로그인 사용자만 진입 ── */}
      {showSave && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSave(false); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSave(false)} />
          <div className="relative w-full max-w-xs rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'rgba(15,10,26,0.98)', border: '1px solid rgba(182,104,252,0.25)' }}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-white">{t.saveAccount}</p>
              <button type="button" onClick={() => setShowSave(false)} className="rounded-lg p-1 text-white/50 hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-white/55">{t.saveTitleField}</span>
              <input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder={t.saveTitlePh} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-white/55">{t.saveDateField}</span>
              <input type="date" value={saveDate} onChange={(e) => setSaveDate(e.target.value)} className={INPUT} />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { void handleSaveWithMeta(); }}
                disabled={saving}
                className="flex-1 rounded-lg py-2 text-[12px] font-black text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
              >
                {saving ? t.aiBusy : t.saveCta}
              </button>
              <button
                type="button"
                onClick={() => setShowSave(false)}
                className="rounded-lg border border-white/[0.12] px-3 py-2 text-[12px] font-bold text-white/55"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 스탑 1행 (표시/인라인 수정) ─────────────────────────────────────────
function StopRow({
  stop, index, t, editing, dayCount, activeDay, onEdit, onDone, onPatch, onDelete, onMove,
}: {
  stop: CourseStop;
  index: number;
  t: Record<string, string>;
  editing: boolean;
  dayCount: number;
  activeDay: number;
  onEdit: () => void;
  onDone: () => void;
  onPatch: (patch: Partial<Omit<CourseStop, 'id'>>) => void;
  onDelete: () => void;
  onMove: (toDay: number) => void;
}) {
  const naverUrl = naverMapSearchUrl(stop.title);
  const gUrl = googleMapsUrl(stop);

  if (editing) {
    return (
      <div className="rounded-xl border border-[#B668FC]/40 bg-[#B668FC]/[0.06] p-2.5">
        <div className="grid gap-1.5">
          <input
            value={stop.title}
            onChange={(e) => { if (e.target.value.trim()) onPatch({ title: e.target.value }); }}
            className={INPUT}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="time" value={stop.time} onChange={(e) => onPatch({ time: e.target.value })} className={`${INPUT} w-[92px] px-1.5`} />
            <div className="flex gap-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onPatch({ category: c })}
                  className={CHIP_BTN}
                  style={stop.category === c
                    ? { background: 'rgba(182,104,252,0.22)', border: '1px solid rgba(182,104,252,0.5)', color: '#E4CCFF' }
                    : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)' }}
                >
                  {t[CAT_KEY[c]]}
                </button>
              ))}
            </div>
          </div>
          <input value={stop.memo} onChange={(e) => onPatch({ memo: e.target.value })} placeholder={t.memoPh} className={INPUT} />
          <div className="flex flex-wrap items-center gap-1.5">
            {dayCount > 1 && (
              <label className="flex items-center gap-1 text-[10px] text-white/45">
                {t.moveTo}
                <select
                  value={activeDay}
                  onChange={(e) => onMove(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-[#141824] px-1.5 py-1 text-[11px] text-white"
                >
                  {Array.from({ length: dayCount }, (_, i) => (
                    <option key={i} value={i}>{t.day} {i + 1}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={onDelete} className="flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[10px] font-bold text-rose-300">
              <Trash2 className="h-3 w-3" /> {t.delete}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="ml-auto flex items-center gap-1 rounded-lg px-3 py-1 text-[11px] font-black text-white"
              style={{ background: 'linear-gradient(135deg,#B668FC,#FF6B9D)' }}
            >
              <Check className="h-3 w-3" /> {t.done}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-2 sm:gap-2.5 sm:p-2.5">
      {/* 순서 번호 — 드래그 아이콘은 실제 드래그 미지원이라 제거(오해 방지). 순서변경은
          Move(다른 Day 이동)·AI 최적화로. 2026-07-05. */}
      <div className="flex flex-col items-center pt-0.5">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-lime-300 text-[11px] font-black text-[#101522] sm:h-7 sm:w-7 sm:text-[12px]">{index + 1}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {stop.time && <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold text-white/60">{stop.time}</span>}
          <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.06em] text-purple-200">
            {t[CAT_KEY[stop.category] ?? 'catEtc']}
          </span>
        </div>
        <p className="mt-0.5 text-[12.5px] font-black leading-snug text-white sm:text-[13.5px]">{stop.title}</p>
        {stop.memo && <p className="mt-0.5 text-[10px] leading-relaxed text-white/40 sm:text-[10.5px]">{stop.memo}</p>}
        <div className="mt-1 flex items-center gap-2">
          <a href={naverUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] font-bold text-[#7CE372]">
            <ExternalLink className="h-2.5 w-2.5" /> {t.naver}
          </a>
          <a href={gUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] font-bold text-[#8AB4F8]">
            <ExternalLink className="h-2.5 w-2.5" /> {t.google}
          </a>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={onEdit} className="rounded-full border border-white/[0.10] px-2.5 py-1 text-[10px] font-bold text-white/60">
          {t.edit}
        </button>
        <button type="button" aria-label={t.delete} onClick={onDelete} className="rounded-full border border-white/[0.08] p-1 text-white/30 hover:text-rose-300">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
