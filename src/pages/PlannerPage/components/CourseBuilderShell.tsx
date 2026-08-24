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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Check, ChevronDown, ChevronUp, Clock, ExternalLink, MapPin,
  PencilLine, Plus, Share2, Sparkles, Trash2, X, Wand2, LogIn,
  Layers3, Loader2, Map as MapIcon,
} from 'lucide-react';

import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';
import { authFetch } from '@/lib/authFetch';
import { useItinerary } from '@/hooks/useItinerary';
import { naverMapSearchUrl } from '@/lib/naverMap';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useCourseBuilder } from './courseBuilder/useCourseBuilder';
import {
  googleMapsUrl, toItinerarySlot, COURSE_MAX_DAYS, COURSE_MAX_STOPS_PER_DAY,
  isValidStayMinutes, type CourseStop, type CourseTimeConstraint,
} from './courseBuilder/courseOps';
import { recoCities, recoForCity, type RecoPlace } from './courseBuilder/recommendations';
import {
  loadZoneCourseTemplates, zoneCourseTemplateToStops, type ZoneCourseTemplate,
} from './courseBuilder/zoneCourseTemplates';
import { CoursePlaceSearch, type CoursePlacePick } from './courseBuilder/CoursePlaceSearch';
import { CourseMiniMap } from './courseBuilder/CourseMiniMap';
import type { TransitStepLike } from '@/lib/routeSegments';
import { fillPrice } from '@/lib/aiPlannerPrice';
import { trackCourseBuilderEvent, type CourseBuilderSource } from './courseBuilder/courseBuilderAnalytics';

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
    routeShow: 'Show transit route', routeAgain: 'Refresh route', routeBusy: 'Finding route…',
    routeNone: 'No transit route found for these stops', routeFail: "Couldn't load the route",
    aiLocked: 'AI optimize & nearby picks unlock with the {price} planner.',
    aiNeedTwo: 'Add at least 2 places with map pins to optimize.',
    aiFail: 'Optimization failed — please try again.',
    saveTitleField: 'Course title', saveDateField: 'Trip date', saveTitlePh: 'e.g. My Seoul food trip',
    saveCta: 'Save', cancel: 'Cancel',
    loginToSave: 'Sign in to save, share, and open on any device.', loginBtn: 'Sign in',
    routeTemplates: 'CocoTrip verified day routes', routeTemplateAdd: 'Add route',
    routeTemplateAddAria: 'Add the verified route {title} to this day',
    routeTemplateLoading: 'Loading verified routes…',
    routeTemplateEmpty: 'No verified route for this city yet.',
    routeTemplateAdded: '{count} stops added from a verified route.',
    routeTemplateFull: 'This day already has the maximum number of stops.',
    tcLabel: 'Time', tcFree: 'Free', tcFixed: 'Fixed time', tcWindow: 'Time window',
    windowEndLabel: 'Until', stayLabel: 'Stay (min)', stayPh: 'e.g. 60',
    moveUp: 'Move {title} up', moveDown: 'Move {title} down',
    closeDialog: 'Close',
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
    routeShow: '실제 경로 보기', routeAgain: '경로 다시 계산', routeBusy: '경로 찾는 중…',
    routeNone: '이 구간의 대중교통 경로를 못 찾았어요', routeFail: '경로를 불러오지 못했어요',
    aiLocked: 'AI 동선 최적화·주변 추천은 {price} 플래너에서 열려요.',
    aiNeedTwo: '지도핀이 있는 장소를 2곳 이상 추가하면 최적화할 수 있어요.',
    aiFail: '최적화에 실패했어요 — 다시 시도해 주세요.',
    saveTitleField: '코스 제목', saveDateField: '여행 날짜', saveTitlePh: '예: 나의 서울 맛집 투어',
    saveCta: '저장', cancel: '취소',
    loginToSave: '로그인하면 저장·공유·다른 기기에서 볼 수 있어요.', loginBtn: '로그인',
    routeTemplates: '코코트립 검증 하루 코스', routeTemplateAdd: '코스 추가',
    routeTemplateAddAria: '검증 코스 {title} 을(를) 이 Day에 추가',
    routeTemplateLoading: '검증 코스 불러오는 중…',
    routeTemplateEmpty: '이 도시에는 아직 검증 코스가 없어요.',
    routeTemplateAdded: '검증 코스에서 {count}곳을 추가했어요.',
    routeTemplateFull: '이 Day에는 더 이상 장소를 추가할 수 없어요.',
    tcLabel: '시간', tcFree: '자유', tcFixed: '시간 확정', tcWindow: '방문 시간대',
    windowEndLabel: '까지', stayLabel: '체류(분)', stayPh: '예: 60',
    moveUp: '{title} 위로 이동', moveDown: '{title} 아래로 이동',
    closeDialog: '닫기',
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
    routeShow: '実際の経路を見る', routeAgain: '経路を再計算', routeBusy: '経路を検索中…',
    routeNone: 'この区間の公共交通の経路が見つかりません', routeFail: '経路を読み込めませんでした',
    aiLocked: 'AIルート最適化・周辺のおすすめは{price}プランで解放。',
    aiNeedTwo: '地図ピン付きの場所を2か所以上追加すると最適化できます。',
    aiFail: '最適化に失敗しました — もう一度お試しください。',
    saveTitleField: 'コース名', saveDateField: '旅行日', saveTitlePh: '例: ソウルグルメ旅',
    saveCta: '保存', cancel: 'キャンセル',
    loginToSave: 'ログインすると保存・共有・他の端末で表示できます。', loginBtn: 'ログイン',
    routeTemplates: 'CocoTrip検証済み1日コース', routeTemplateAdd: 'コース追加',
    routeTemplateAddAria: '検証済みコース{title}をこのDayに追加',
    routeTemplateLoading: '検証済みコースを読込中…',
    routeTemplateEmpty: 'この都市には検証済みコースがまだありません。',
    routeTemplateAdded: '検証済みコースから{count}か所追加しました。',
    routeTemplateFull: 'このDayにはこれ以上場所を追加できません。',
    tcLabel: '時間', tcFree: '自由', tcFixed: '確定時刻', tcWindow: '訪問時間帯',
    windowEndLabel: 'まで', stayLabel: '滞在（分）', stayPh: '例: 60',
    moveUp: '{title}を上へ移動', moveDown: '{title}を下へ移動',
    closeDialog: '閉じる',
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
    routeShow: '查看实际路线', routeAgain: '重新计算路线', routeBusy: '正在查找路线…',
    routeNone: '未找到该区间的公共交通路线', routeFail: '无法加载路线',
    aiLocked: 'AI优化路线·周边推荐需{price}行程解锁。',
    aiNeedTwo: '添加至少2个带地图标记的地点后即可优化。',
    aiFail: '优化失败 — 请重试。',
    saveTitleField: '行程名称', saveDateField: '出行日期', saveTitlePh: '例: 我的首尔美食之旅',
    saveCta: '保存', cancel: '取消',
    loginToSave: '登录后可保存·分享·在其他设备查看。', loginBtn: '登录',
    routeTemplates: 'CocoTrip已验证一日路线', routeTemplateAdd: '添加路线',
    routeTemplateAddAria: '将已验证路线{title}添加到当天',
    routeTemplateLoading: '正在加载验证路线…',
    routeTemplateEmpty: '该城市暂无验证路线。',
    routeTemplateAdded: '已从验证路线添加{count}个地点。',
    routeTemplateFull: '当天地点数量已达上限。',
    tcLabel: '时间', tcFree: '自由', tcFixed: '确定时间', tcWindow: '时间段',
    windowEndLabel: '至', stayLabel: '停留(分钟)', stayPh: '例: 60',
    moveUp: '将{title}上移', moveDown: '将{title}下移',
    closeDialog: '关闭',
  },
};

interface AiNearby { name: string; lat: number; lng: number; category: string; reason: string; }

const CATEGORIES = ['food', 'sight', 'show', 'stay', 'etc'] as const;
const CAT_KEY: Record<string, string> = { food: 'catFood', sight: 'catSight', show: 'catShow', stay: 'catStay', etc: 'catEtc' };

// compact 카드 문법 (차터 PR #1037 컨벤션 — 모바일 초소형 기본, sm: 확대) — Korea Editorial
// Concierge 토큰 기반(2026-08-10). 카드 표면은 ec-raised/ec-line, 입력은 ec-field 그대로
// 사용(이 컴포넌트가 적는 padding/width 유틸이 그 뒤에 얹혀 오버라이드된다).
const CARD = 'rounded-ec-md border border-ec-line bg-ec-raised';
const INPUT = 'ec-field';

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
  // 시간 제약(자유/확정/시간대) + 체류시간 — planner-trust-course v1 확장(2026-08-24).
  const [newTc, setNewTc] = useState<'' | CourseTimeConstraint>('');
  const [newWindowEnd, setNewWindowEnd] = useState('');
  const [newStayMinutes, setNewStayMinutes] = useState('');
  // 인라인 수정 대상
  const [editingId, setEditingId] = useState<string | null>(null);
  // 추천 도시 필터
  const [recoCity, setRecoCity] = useState<string | null>(null);
  // 선택 도시의 검증 하루 코스 (Firestore zone_courses, published 만).
  // 결과에 어느 도시 것인지를 같이 담는다 — 로딩 여부를 따로 상태로 두지 않고 파생시키기 위해서다.
  const [zoneTemplates, setZoneTemplates] = useState<{ city: string; items: ZoneCourseTemplate[] }>(
    { city: '', items: [] },
  );
  // 상태 피드백 (공유/저장)
  const [flash, setFlash] = useState<string | null>(null);
  const showFlash = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(null), 2500); };
  // AI 동선 최적화
  const [aiBusy, setAiBusy] = useState(false);
  // 실경로(대중교통) 세그먼트 — /api/course-route 응답. 비어 있으면 지도는 직선 폴백.
  // `to` = 도착 지점 인덱스 — 지도가 구간별로 실경로/직선을 섞어 그리는 데 쓴다.
  const [routeSegs, setRouteSegs] = useState<{ to?: number; steps_detail?: TransitStepLike[] }[]>([]);
  const [routeBusy, setRouteBusy] = useState(false);
  const [aiRecos, setAiRecos] = useState<AiNearby[]>([]);
  // 저장 모달 (제목/날짜)
  const [showSave, setShowSave] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDate, setSaveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const cities = useMemo(() => recoCities(), []);
  const recos = useMemo(() => recoForCity(recoCity), [recoCity]);

  // 검증 하루 코스(zone_courses) — 도시 칩을 고른 뒤에만 읽는다.
  // "전체" 상태에서 미리 읽으면 도시 수만큼 Firestore 문서를 통째로 당겨오게 된다.
  // setState 는 promise 콜백 안에서만 한다(effect 본문 동기 setState = 연쇄 렌더).
  useEffect(() => {
    if (!recoCity) return;
    let cancelled = false;
    // loadZoneCourseTemplates 는 내부에서 실패를 삼키고 빈 배열을 준다 — 코스빌더는 계속 동작.
    void loadZoneCourseTemplates(recoCity).then((items) => {
      if (!cancelled) setZoneTemplates({ city: recoCity, items });
    });
    return () => { cancelled = true; };
  }, [recoCity]);

  // 로딩 여부는 별도 상태가 아니라 파생값 — "지금 고른 도시의 결과가 아직 안 왔다".
  // 도시를 바꾸면 즉시 로딩으로 바뀌어 이전 도시 코스가 잠깐 남아 보이는 일이 없다.
  const zoneTemplatesLoading = !!recoCity && zoneTemplates.city !== recoCity;

  const day = cb.draft.days[cb.activeDay] || { stops: [] };

  // course_builder_started — 이 에디팅 세션에서 "새 장소 추가"가 처음 성공한 순간 정확히 1회.
  // 드래프트/계정/공유 코스 로딩(useCourseBuilder 초기 state)은 이 ref 를 절대 건드리지 않는다 —
  // 그 경로는 addStop/addStops 핸들러를 거치지 않기 때문에 자동으로 제외된다.
  const startedFiredRef = useRef(false);
  const fireStarted = (source: CourseBuilderSource) => {
    if (startedFiredRef.current) return;
    startedFiredRef.current = true;
    trackCourseBuilderEvent('course_builder_started', { source, language: nameLang });
  };

  useEffect(() => {
    trackCourseBuilderEvent('course_builder_opened', { language: nameLang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 폼의 시간제약 상태를 CourseStop 확장필드로 변환. 'free' 는 필드 자체를 생략(자유시간). */
  const buildTimeFields = (): Partial<CourseStop> => {
    if (newTc === 'fixed') return { timeConstraint: 'fixed' };
    if (newTc === 'window' && newWindowEnd) return { timeConstraint: 'window', windowEnd: newWindowEnd };
    return {};
  };
  const buildStayField = (): Partial<CourseStop> => {
    const n = Number(newStayMinutes);
    return isValidStayMinutes(n) ? { stayMinutes: n } : {};
  };
  const resetAddForm = () => {
    setNewTitle(''); setNewTime(''); setNewMemo(''); setNewTc(''); setNewWindowEnd(''); setNewStayMinutes('');
  };

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    fireStarted('manual');
    cb.addStop(cb.activeDay, {
      title: newTitle, time: newTime, category: newCat, memo: newMemo,
      ...buildTimeFields(), ...buildStayField(),
    });
    resetAddForm();
  };

  // 자동완성에서 장소 선택 → 좌표까지 저장 (지도 동선 가능). 주소는 memo 로 보존.
  const handlePickPlace = (p: CoursePlacePick) => {
    fireStarted('place_search');
    cb.addStop(cb.activeDay, {
      title: p.title, time: newTime, category: newCat,
      memo: p.address || newMemo,
      ...(typeof p.lat === 'number' ? { lat: p.lat } : {}),
      ...(typeof p.lng === 'number' ? { lng: p.lng } : {}),
      ...buildTimeFields(), ...buildStayField(),
    });
    resetAddForm();
  };

  // 비동기 stale-result 안전망 — 현재 Day·stop 들의 "판단에 관련된 값"이 바뀌면(추가/삭제/
  // 순서/좌표/시간/시간제약/체류시간, 또는 Day 전환) 이전 요청의 응답은 더 이상 유효하지
  // 않다. basisKey 가 바뀔 때마다 generation 을 올리고 진행 중 요청을 abort, 화면에 남아있던
  // 이전 결과(routeSegs/aiRecos)도 지운다 — 다른 Day/바뀐 코스에 옛 응답이 얹혀 보이는 것 방지.
  const basisKey = useMemo(
    () => `${cb.activeDay}:${day.stops.map((s, i) => [
      s.id, i, s.lat, s.lng, s.time, s.timeConstraint || '', s.windowEnd || '', s.stayMinutes ?? '',
    ].join('|')).join(';')}`,
    [cb.activeDay, day.stops],
  );
  const generationRef = useRef(0);
  const routeAbortRef = useRef<AbortController | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const isFirstBasisRef = useRef(true);
  useEffect(() => {
    if (isFirstBasisRef.current) { isFirstBasisRef.current = false; return; }
    generationRef.current += 1;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setRouteSegs([]);
    setAiRecos([]);
  }, [basisKey]);

  // 실경로 조회 — 활성 Day 의 좌표 있는 stop 을 course-route(TMAP)로 보내 실제
  // 대중교통 경로를 받는다. 인증 불필요(공개 기능), 서버가 IP rate-limit·구간 상한으로 방어.
  const handleShowRoute = async () => {
    // 지도(CourseMiniMap.toMapPoints)·서버(validCoord)와 **동일한** 유효성 기준이어야
    // 응답 segment 의 `to` 인덱스가 지도 지점과 어긋나지 않는다.
    const stops = day.stops.filter(
      (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng)
        && (s.lat as number) >= -90 && (s.lat as number) <= 90
        && (s.lng as number) >= -180 && (s.lng as number) <= 180,
    );
    if (stops.length < 2) { showFlash(t.aiNeedTwo); return; }
    const myGen = generationRef.current;
    routeAbortRef.current?.abort();
    const controller = new AbortController();
    routeAbortRef.current = controller;
    const startedAt = performance.now();
    setRouteBusy(true);
    try {
      const res = await fetch('/api/course-route', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops: stops.map((s) => ({ lat: s.lat, lng: s.lng, name: s.title })) }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (myGen !== generationRef.current) return; // 그 사이 Day/코스가 바뀜 — 폐기
      const segs = Array.isArray(json?.segments) ? json.segments : [];
      setRouteSegs(segs);
      if (!segs.length) showFlash(t.routeNone);
      trackCourseBuilderEvent('course_builder_route_result', {
        success: segs.length > 0, reason: segs.length > 0 ? 'ok' : 'no_route',
        durationMs: performance.now() - startedAt, language: nameLang,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return; // 취소 — 폐기(에러 아님)
      if (myGen !== generationRef.current) return;
      showFlash(t.routeFail);
      trackCourseBuilderEvent('course_builder_route_result', {
        success: false, reason: 'network_error', durationMs: performance.now() - startedAt, language: nameLang,
      });
    } finally {
      if (myGen === generationRef.current) setRouteBusy(false);
    }
  };

  // AI 동선 최적화 — 활성 Day stop(좌표 있는) 을 course-ai 로 재정렬 + 주변 추천.
  const handleAiOptimize = async () => {
    const stops = day.stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
    // 2026-07-17: 기존엔 t.aiBusy('최적화 중…')를 안내문으로 오용 — 전용 문구로 교체.
    if (stops.length < 2) { showFlash(t.aiNeedTwo); return; }
    const myGen = generationRef.current;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const startedAt = performance.now();
    setAiBusy(true);
    try {
      // authFetch = Firebase 토큰 첨부 → course-ai 가 유료 플래너 구매자(aiFeaturesUnlocked)만 허용.
      const res = await authFetch('/api/course-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: day.stops.map((s) => ({
            id: s.id, title: s.title, category: s.category, lat: s.lat, lng: s.lng,
            ...(s.time ? { time: s.time } : {}),
            ...(s.timeConstraint ? { timeConstraint: s.timeConstraint } : {}),
            ...(s.windowEnd ? { windowEnd: s.windowEnd } : {}),
            ...(s.stayMinutes !== undefined ? { stayMinutes: s.stayMinutes } : {}),
          })),
          lang: nameLang,
        }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (myGen !== generationRef.current) return; // Day/코스가 그 사이 바뀜 — 폐기
      // 무료/비로그인 = 유료 AI 기능 잠김 → 업셀 안내(에러 아님).
      if (res.status === 403 && json?.code === 'AI_FEATURE_LOCKED') {
        showFlash(fillPrice(t.aiLocked, language));
        trackCourseBuilderEvent('course_builder_optimize_result', { success: false, reason: 'locked', durationMs: performance.now() - startedAt, language: nameLang });
        return;
      }
      if (json?.ok) {
        if (Array.isArray(json.optimizedOrder) && json.optimizedOrder.length) {
          cb.reorderStops(cb.activeDay, json.optimizedOrder.map(String));
        }
        setAiRecos(Array.isArray(json.nearby) ? json.nearby : []);
        trackCourseBuilderEvent('course_builder_optimize_result', { success: true, reason: 'ok', durationMs: performance.now() - startedAt, language: nameLang });
      } else {
        // 2026-07-17: 서버 실패(!ok)도 무피드백이었음 — 사용자 안내(코스 데이터는 무변).
        showFlash(t.aiFail);
        trackCourseBuilderEvent('course_builder_optimize_result', { success: false, reason: 'server_error', durationMs: performance.now() - startedAt, language: nameLang });
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return; // 취소 — 폐기(에러 아님)
      if (myGen !== generationRef.current) return;
      // 2026-07-17: 네트워크 실패 시 조용히 무시 → 버튼만 원복되고 아무 일도 없는 것처럼 보이던 갭.
      showFlash(t.aiFail);
      trackCourseBuilderEvent('course_builder_optimize_result', { success: false, reason: 'network_error', durationMs: performance.now() - startedAt, language: nameLang });
    } finally {
      if (myGen === generationRef.current) setAiBusy(false);
    }
  };

  const handleAddAiReco = (n: AiNearby) => {
    fireStarted('ai_recommendation');
    cb.addStop(cb.activeDay, { title: n.name, time: '', category: n.category || 'sight', memo: '', lat: n.lat, lng: n.lng });
    setAiRecos((prev) => prev.filter((x) => x !== n));
  };

  const handleSaveWithMeta = async () => {
    setSaving(true);
    const startedAt = performance.now();
    try {
      const title = saveTitle.trim() || `Course ${saveDate}`;
      const slotsPerDay = cb.draft.days.map((d) => d.stops.map(toItinerarySlot));
      const id = await createItineraryWithSlots(title, saveDate, slotsPerDay);
      showFlash(id ? t.saveDone : t.saveFail);
      if (id) setShowSave(false);
      trackCourseBuilderEvent('course_builder_saved', {
        success: !!id, reason: id ? 'ok' : 'server_error', durationMs: performance.now() - startedAt, language: nameLang,
      });
    } catch {
      showFlash(t.saveFail);
      trackCourseBuilderEvent('course_builder_saved', {
        success: false, reason: 'network_error', durationMs: performance.now() - startedAt, language: nameLang,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAddReco = (p: RecoPlace) => {
    fireStarted('recommendation');
    cb.addStop(cb.activeDay, {
      title: p.name[nameLang] || p.name.en, time: '', category: p.theme === 'food' ? 'food' : 'sight',
      memo: '', lat: p.lat, lng: p.lng,
    });
  };

  /** 검증된 하루 코스를 현재 Day 의 남은 자리만큼 한 번에 추가한다. */
  const handleAddZoneTemplate = (template: ZoneCourseTemplate) => {
    const remaining = COURSE_MAX_STOPS_PER_DAY - day.stops.length;
    if (remaining <= 0) {
      showFlash(t.routeTemplateFull);
      return;
    }
    const stops = zoneCourseTemplateToStops(template, nameLang).slice(0, remaining);
    fireStarted('verified_route');
    cb.addStops(cb.activeDay, stops);
    showFlash(t.routeTemplateAdded.replace('{count}', String(stops.length)));
  };

  const handleShare = async () => {
    if (cb.totalStops === 0) return; // 빈 코스 — fetch/native share/clipboard 전부 시도 금지
    const startedAt = performance.now();
    const url = await cb.share();
    showFlash(url ? t.shareCopied : t.shareFail);
    trackCourseBuilderEvent('course_builder_shared', {
      success: !!url, reason: url ? 'ok' : 'network_error', durationMs: performance.now() - startedAt, language: nameLang,
    });
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
              aria-pressed={i === cb.activeDay}
              onClick={() => cb.setActiveDay(i)}
              className={`ec-option ec-option-sm shrink-0 ${i === cb.activeDay ? 'is-selected' : ''}`}
            >
              {t.day} {i + 1}
              <span className="ml-1 text-ec-ink-3">{d.stops.length}</span>
            </button>
          ))}
          {cb.draft.days.length < COURSE_MAX_DAYS && (
            <button
              type="button"
              onClick={cb.addDay}
              className="ec-option ec-option-sm shrink-0 border-dashed text-ec-ink-3"
            >
              {t.addDay}
            </button>
          )}
          {cb.draft.days.length > 1 && (
            <button
              type="button"
              aria-label={t.delDay}
              onClick={() => { if (window.confirm(t.delDay)) cb.removeDay(cb.activeDay); }}
              className="ec-option ec-option-sm ml-auto shrink-0 text-ec-ink-3"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 장소 추가 폼 — compact */}
        <div className={`${CARD} mb-2.5 p-2.5 sm:p-3`}>
          <p className="ec-eyebrow mb-1.5 flex items-center gap-1.5">
            <PencilLine className="h-3.5 w-3.5 text-ec-brand" /> {t.addTitle}
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
              <label className="flex items-center gap-1 text-[10px] text-ec-ink-3">
                <Clock className="h-3 w-3" />
                <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={`${INPUT} w-[104px] px-1.5`} />
              </label>
              <div className="flex gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={newCat === c}
                    onClick={() => setNewCat(c)}
                    className={`ec-option ec-option-sm ${newCat === c ? 'is-selected' : ''}`}
                  >
                    {t[CAT_KEY[c]]}
                  </button>
                ))}
              </div>
            </div>
            {/* 시간제약(자유/확정/시간대) + 체류시간 — planner-trust-course v1. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-ec-ink-3">{t.tcLabel}</span>
              <div className="flex gap-1">
                {([['', t.tcFree], ['fixed', t.tcFixed], ['window', t.tcWindow]] as const).map(([v, label]) => (
                  <button
                    key={v || 'free'}
                    type="button"
                    aria-pressed={newTc === v}
                    onClick={() => setNewTc(v)}
                    className={`ec-option ec-option-sm ${newTc === v ? 'is-selected' : ''}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {newTc === 'window' && (
                <label className="flex items-center gap-1 text-[10px] text-ec-ink-3">
                  {t.windowEndLabel}
                  <input type="time" value={newWindowEnd} onChange={(e) => setNewWindowEnd(e.target.value)} className={`${INPUT} w-[104px] px-1.5`} />
                </label>
              )}
              <label className="flex items-center gap-1 text-[10px] text-ec-ink-3">
                {t.stayLabel}
                <input
                  type="number" min={1} max={1440} step={5} value={newStayMinutes} placeholder={t.stayPh}
                  onChange={(e) => setNewStayMinutes(e.target.value)}
                  className={`${INPUT} w-[72px] px-1.5`}
                />
              </label>
            </div>
            <div className="flex gap-1.5">
              <input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder={t.memoPh} className={`${INPUT} flex-1 min-w-0`} />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newTitle.trim()}
                className="ec-btn ec-btn-primary ec-btn-sm shrink-0"
              >
                <Plus className="h-3.5 w-3.5" /> {t.addBtn} {cb.activeDay + 1}
              </button>
            </div>
          </div>
        </div>

        {/* 동선 미니지도 — 좌표 있는 stop 2곳 이상일 때만 (번호핀+선 + AI 주변추천 앰버 마커).
            routeSegments 가 있으면 직선 대신 실제 대중교통 경로(노선색·승차핀·수단칩). */}
        <CourseMiniMap stops={day.stops} title={t.mapTitle} nearby={aiRecos} routeSegments={routeSegs} />

        {/* AI 동선 최적화 + 주변 추천 — 좌표 있는 stop 2곳 이상일 때만 노출 */}
        {day.stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number').length >= 2 && (
          <div className="mb-2.5">
            <button
              type="button"
              onClick={() => { void handleAiOptimize(); }}
              disabled={aiBusy}
              className="ec-btn ec-btn-secondary ec-btn-sm"
            >
              <Wand2 className="h-3.5 w-3.5" /> {aiBusy ? t.aiBusy : t.aiOptimize}
            </button>
            {/* 실경로 보기 — 온디맨드로만 TMAP 을 부른다(코스는 편집 중 자주 바뀌므로
                자동 호출하면 비용이 샌다). 실패해도 지도는 직선으로 유지(fail-soft). */}
            <button
              type="button"
              onClick={() => { void handleShowRoute(); }}
              disabled={routeBusy}
              className="ec-btn ec-btn-secondary ec-btn-sm mt-1.5"
            >
              <MapIcon className="h-3.5 w-3.5" />
              {routeBusy ? t.routeBusy : (routeSegs.length > 0 ? t.routeAgain : t.routeShow)}
            </button>
            {aiRecos.length > 0 && (
              <div className="mt-2 rounded-ec-md border border-ec-line bg-ec-brand-wash p-2">
                <p className="ec-eyebrow mb-1.5 flex items-center gap-1 text-ec-brand">
                  <Sparkles className="h-3 w-3" /> {t.aiRecosTitle}
                </p>
                <div className="flex flex-col gap-1">
                  {aiRecos.map((n, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-ec-sm bg-ec-raised px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11.5px] font-bold text-ec-ink">{n.name}</p>
                        {n.reason && <p className="truncate text-[10px] text-ec-ink-3">{n.reason}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddAiReco(n)}
                        className="ec-chip ec-chip-brand shrink-0"
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

        {/* 스탑 리스트 — 시간 컬럼 + 하드라인 행의 "인쇄된 일정표" 문법(ec-timeline). */}
        {day.stops.length === 0 ? (
          <p className="rounded-ec-md border border-dashed border-ec-line px-3 py-6 text-center text-[12px] leading-relaxed text-ec-ink-3">
            {t.empty}
          </p>
        ) : (
          <div className="ec-timeline">
            {day.stops.map((stop, idx) => (
              <StopRow
                key={stop.id}
                stop={stop}
                index={idx}
                total={day.stops.length}
                t={t}
                editing={editingId === stop.id}
                dayCount={cb.draft.days.length}
                activeDay={cb.activeDay}
                onEdit={() => setEditingId(stop.id)}
                onDone={() => setEditingId(null)}
                onPatch={(patch) => cb.updateStop(cb.activeDay, stop.id, patch)}
                onDelete={() => { if (window.confirm(t.delConfirm)) cb.removeStop(cb.activeDay, stop.id); }}
                onMove={(toDay) => { cb.moveStopToDay(cb.activeDay, stop.id, toDay); setEditingId(null); }}
                onReorder={(toIndex) => cb.moveStopWithinDay(cb.activeDay, stop.id, toIndex)}
              />
            ))}
          </div>
        )}

        {/* 하단 액션 바 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => { void handleShare(); }}
            disabled={cb.totalStops === 0}
            className="ec-btn ec-btn-primary ec-btn-sm"
          >
            <Share2 className="h-3.5 w-3.5" /> {t.share}
          </button>
          {user ? (
            <button
              type="button"
              onClick={() => { setSaveTitle(''); setShowSave(true); }}
              disabled={cb.totalStops === 0}
              className="ec-btn ec-btn-secondary ec-btn-sm"
            >
              <Check className="h-3.5 w-3.5" /> {t.saveAccount}
            </button>
          ) : (
            cb.totalStops > 0 && (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="ec-btn ec-btn-secondary ec-btn-sm"
                title={t.loginToSave}
              >
                <LogIn className="h-3.5 w-3.5" /> {t.loginBtn}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => { if (window.confirm(t.resetConfirm)) cb.reset(); }}
            className="ec-btn ec-btn-quiet ec-btn-sm"
          >
            {t.newCourse}
          </button>
          <span className="ml-auto flex items-center gap-1 text-[9.5px] text-ec-ink-3 sm:text-[10.5px]" role="status" aria-live="polite">
            {flash ? (
              <span className="font-bold text-ec-success">{flash}</span>
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
        <p className="ec-eyebrow mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-ec-brand" /> {t.recoTitle}
        </p>
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          <button
            type="button"
            aria-pressed={recoCity === null}
            onClick={() => setRecoCity(null)}
            className={`ec-option ec-option-sm shrink-0 ${recoCity === null ? 'is-selected' : ''}`}
          >
            {t.allCities}
          </button>
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={recoCity === c}
              onClick={() => setRecoCity(c)}
              className={`ec-option ec-option-sm shrink-0 capitalize ${recoCity === c ? 'is-selected' : ''}`}
            >
              {c}
            </button>
          ))}
        </div>
        {/* 검증 하루 코스 — 빈 화면에서 장소를 하나씩 찾다 이탈하는 구간을 없앤다. */}
        {recoCity && (
          <div className="mb-3 rounded-ec-md border border-ec-line bg-ec-brand-wash p-2">
            <p className="ec-eyebrow mb-1.5 flex items-center gap-1.5 text-ec-brand">
              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" /> {t.routeTemplates}
            </p>
            {zoneTemplatesLoading ? (
              <p className="flex items-center gap-1.5 py-2 text-[10px] text-ec-ink-3" role="status">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {t.routeTemplateLoading}
              </p>
            ) : zoneTemplates.items.length === 0 ? (
              <p className="py-1 text-[10px] text-ec-ink-3">{t.routeTemplateEmpty}</p>
            ) : (
              <div className="space-y-1.5">
                {zoneTemplates.items.map((template) => {
                  const title = template.theme_i18n?.[nameLang] || template.theme_i18n?.en || template.theme;
                  const hours = Math.max(1, Math.round(template.duration_min / 60));
                  return (
                    <div key={template.id} className="flex items-center gap-2 rounded-ec-sm bg-ec-raised px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10.5px] font-bold text-ec-ink">{title}</p>
                        <p className="mt-0.5 text-[9px] text-ec-ink-3">
                          {template.zone ? `${template.zone} · ` : ''}{template.stops.length}{t.stops} · {hours}h
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddZoneTemplate(template)}
                        aria-label={t.routeTemplateAddAria.replace('{title}', title)}
                        className="ec-chip ec-chip-brand shrink-0"
                      >
                        {t.routeTemplateAdd}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="space-y-1 max-h-[420px] overflow-y-auto pr-0.5">
          {recos.map((p) => (
            <div key={p.key} className="flex items-center gap-2 rounded-ec-sm border border-ec-line px-2 py-1.5">
              <MapPin className="h-3 w-3 shrink-0 text-ec-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-bold text-ec-ink">{p.name[nameLang] || p.name.en}</p>
                <p className="text-[9px] text-ec-ink-3 capitalize">{p.city}{typeof p.rating === 'number' ? ` · ★${p.rating}` : ''}</p>
              </div>
              <button
                type="button"
                onClick={() => handleAddReco(p)}
                className="ec-chip ec-chip-brand shrink-0"
              >
                {t.recoAdd}
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── 저장 모달 (제목/여행 날짜) — 로그인 사용자만 진입. Radix Dialog: 포커스 트랩·
          Escape 닫기·트리거로 포커스 복귀는 프리미티브가 보장 — 여기서는 초기 포커스
          (제목 입력)·실제 form submit·필수값·busy state·44px 닫기 버튼만 배선한다. */}
      <Dialog open={showSave} onOpenChange={(open) => { if (!open) setShowSave(false); }}>
        <DialogContent showCloseButton={false} className="max-w-xs">
          <button
            type="button"
            onClick={() => setShowSave(false)}
            aria-label={t.closeDialog}
            className="absolute right-2 top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-ec-sm text-ec-ink-3 hover:bg-ec-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ec-brand focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" />
          </button>
          <DialogHeader>
            <DialogTitle>{t.saveAccount}</DialogTitle>
            <DialogDescription className="sr-only">{t.saveAccount}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); if (saveTitle.trim()) void handleSaveWithMeta(); }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ec-ink-3">{t.saveTitleField}</span>
              <input
                autoFocus
                required
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder={t.saveTitlePh}
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ec-ink-3">{t.saveDateField}</span>
              <input type="date" required value={saveDate} onChange={(e) => setSaveDate(e.target.value)} className={INPUT} />
            </label>
            <DialogFooter>
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving}
                className="ec-btn ec-btn-primary flex-1"
              >
                {saving ? t.aiBusy : t.saveCta}
              </button>
              <button type="button" onClick={() => setShowSave(false)} className="ec-btn ec-btn-secondary">
                {t.cancel}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 스탑 1행 (표시/인라인 수정) ─────────────────────────────────────────
function StopRow({
  stop, index, total, t, editing, dayCount, activeDay, onEdit, onDone, onPatch, onDelete, onMove, onReorder,
}: {
  stop: CourseStop;
  index: number;
  total: number;
  t: Record<string, string>;
  editing: boolean;
  dayCount: number;
  activeDay: number;
  onEdit: () => void;
  onDone: () => void;
  onPatch: (patch: Partial<Omit<CourseStop, 'id'>>) => void;
  onDelete: () => void;
  onMove: (toDay: number) => void;
  onReorder: (toIndex: number) => void;
}) {
  const naverUrl = naverMapSearchUrl(stop.title);
  const gUrl = googleMapsUrl(stop);
  const orderBtnClass = 'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-ec-sm text-ec-ink-3 hover:bg-ec-sunken disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ec-brand focus-visible:ring-offset-2';

  if (editing) {
    const tc: '' | CourseTimeConstraint = stop.timeConstraint || '';
    return (
      <div className="rounded-ec-md border border-ec-brand bg-ec-brand-wash p-2.5">
        <div className="grid gap-1.5">
          <input
            value={stop.title}
            onChange={(e) => { if (e.target.value.trim()) onPatch({ title: e.target.value }); }}
            className={INPUT}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="time" value={stop.time} onChange={(e) => onPatch({ time: e.target.value })} className={`${INPUT} w-[104px] px-1.5`} />
            <div className="flex gap-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={stop.category === c}
                  onClick={() => onPatch({ category: c })}
                  className={`ec-option ec-option-sm ${stop.category === c ? 'is-selected' : ''}`}
                >
                  {t[CAT_KEY[c]]}
                </button>
              ))}
            </div>
          </div>
          {/* 시간제약 + 체류시간 — planner-trust-course v1(2026-08-24). */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-ec-ink-3">{t.tcLabel}</span>
            <div className="flex gap-1">
              {([['', t.tcFree], ['fixed', t.tcFixed], ['window', t.tcWindow]] as const).map(([v, label]) => (
                <button
                  key={v || 'free'}
                  type="button"
                  aria-pressed={tc === v}
                  onClick={() => onPatch(v === '' ? { timeConstraint: undefined, windowEnd: undefined } : { timeConstraint: v })}
                  className={`ec-option ec-option-sm ${tc === v ? 'is-selected' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tc === 'window' && (
              <label className="flex items-center gap-1 text-[10px] text-ec-ink-3">
                {t.windowEndLabel}
                <input type="time" value={stop.windowEnd || ''} onChange={(e) => onPatch({ windowEnd: e.target.value })} className={`${INPUT} w-[104px] px-1.5`} />
              </label>
            )}
            <label className="flex items-center gap-1 text-[10px] text-ec-ink-3">
              {t.stayLabel}
              <input
                type="number" min={1} max={1440} step={5}
                value={stop.stayMinutes ?? ''}
                onChange={(e) => onPatch({ stayMinutes: e.target.value ? Number(e.target.value) : undefined })}
                placeholder={t.stayPh}
                className={`${INPUT} w-[72px] px-1.5`}
              />
            </label>
          </div>
          <input value={stop.memo} onChange={(e) => onPatch({ memo: e.target.value })} placeholder={t.memoPh} className={INPUT} />
          <div className="flex flex-wrap items-center gap-1.5">
            {dayCount > 1 && (
              <label className="flex items-center gap-1 text-[10px] text-ec-ink-3">
                {t.moveTo}
                <select
                  value={activeDay}
                  onChange={(e) => onMove(Number(e.target.value))}
                  className="ec-field w-auto"
                >
                  {Array.from({ length: dayCount }, (_, i) => (
                    <option key={i} value={i}>{t.day} {i + 1}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" onClick={onDelete} className="flex items-center gap-1 rounded-ec-sm border border-ec-critical px-2.5 py-1 text-[10px] font-bold text-ec-critical">
              <Trash2 className="h-3 w-3" /> {t.delete}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="ec-btn ec-btn-primary ec-btn-sm ml-auto"
            >
              <Check className="h-3 w-3" /> {t.done}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 순서 번호 — 시간이 없는 stop 은 시간 컬럼에 순번을 대신 보여준다("인쇄된 일정표"에도
  // 시간 미정 항목은 순서로 남는다). 드래그 아이콘은 실제 드래그 미지원이라 없음(오해 방지).
  // 순서변경은 Move(다른 Day 이동)·AI 최적화로. 2026-07-05.
  const tcText = stop.timeConstraint === 'fixed' ? t.tcFixed
    : stop.timeConstraint === 'window' ? `${t.tcWindow}${stop.windowEnd ? ` ${t.windowEndLabel} ${stop.windowEnd}` : ''}`
      : '';

  return (
    <div className="ec-timeline-row">
      <div className="ec-timeline-time">{stop.time || `#${index + 1}`}</div>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="ec-chip ec-chip-brand">
            {t[CAT_KEY[stop.category] || 'catEtc']}
          </span>
          <p className="mt-1 text-[13.5px] font-bold leading-snug text-ec-ink">{stop.title}</p>
          {stop.memo && <p className="mt-0.5 text-[11px] leading-relaxed text-ec-ink-3">{stop.memo}</p>}
          {(tcText || stop.stayMinutes !== undefined) && (
            <p className="mt-0.5 text-[10px] text-ec-ink-3">
              {tcText}
              {tcText && stop.stayMinutes !== undefined ? ' · ' : ''}
              {stop.stayMinutes !== undefined ? `${t.stayLabel} ${stop.stayMinutes}` : ''}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={naverUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[11px] font-bold text-ec-ink-2 hover:text-ec-ink">
              <ExternalLink className="h-2.5 w-2.5" /> {t.naver}
            </a>
            <a href={gUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[11px] font-bold text-ec-ink-2 hover:text-ec-ink">
              <ExternalLink className="h-2.5 w-2.5" /> {t.google}
            </a>
            <button type="button" onClick={onEdit} className="ml-auto rounded-ec-sm px-2 py-1 text-[11px] font-bold text-ec-ink-3 hover:text-ec-ink">
              {t.edit}
            </button>
            <button type="button" aria-label={t.delete} onClick={onDelete} className="rounded-ec-sm p-1 text-ec-ink-3 hover:text-ec-critical">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {/* 접근성 수동 순서변경 — 실제 드래그는 지원하지 않는다(위 주석). 44x44 터치 타깃 +
            가시적 포커스 링. 경계(첫/끝)에서는 disabled(스크린리더에 이동 불가로 안내). */}
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => onReorder(index - 1)}
            disabled={index === 0}
            aria-label={t.moveUp.replace('{title}', stop.title)}
            className={orderBtnClass}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onReorder(index + 1)}
            disabled={index === total - 1}
            aria-label={t.moveDown.replace('{title}', stop.title)}
            className={orderBtnClass}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
