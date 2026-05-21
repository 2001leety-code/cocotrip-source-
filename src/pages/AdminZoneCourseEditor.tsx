// ─────────────────────────────────────────────────────────────────────────────
// AdminZoneCourseEditor — 9-탭 어드민 zone_courses 편집 (Track C, 2026-05-21)
//   /admin/zone-courses/new — 빈 draft 시작
//   /admin/zone-courses/edit/:blockId — 기존 block 편집 (draft + published merge)
//
// AdminProductEditor (Phase 2, 2026-05-19) 패턴 100% 재활용:
//   - 1초 throttle autosave (P105)
//   - beforeunload pending flush
//   - 낙관적 lock 기반 publish
//   - 9 탭 sidebar
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast, Toaster } from 'sonner';
import {
  Settings, MapPin, Map, Star, Utensils,
  Ticket, TrendingUp, MessageSquare, FileText,
  Save, Send, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchZoneCourseById, fetchDraft, saveDraft, publishDraft,
  type ZoneCourseDoc,
} from '@/lib/zone-courses-firestore';
import { BasicTab } from '@/components/admin/ZoneCourseEditor/BasicTab';
import { StopsTab } from '@/components/admin/ZoneCourseEditor/StopsTab';
import { TransitMatrixTab } from '@/components/admin/ZoneCourseEditor/TransitMatrixTab';
import { BestForTab } from '@/components/admin/ZoneCourseEditor/BestForTab';
import { DietaryTab } from '@/components/admin/ZoneCourseEditor/DietaryTab';
import { BookingTab } from '@/components/admin/ZoneCourseEditor/BookingTab';
import { TrendHintsTab } from '@/components/admin/ZoneCourseEditor/TrendHintsTab';
import { PainpointsTab } from '@/components/admin/ZoneCourseEditor/PainpointsTab';
import { MetaTab } from '@/components/admin/ZoneCourseEditor/MetaTab';

type TabKey =
  | 'basic' | 'stops' | 'transit' | 'bestfor' | 'dietary'
  | 'booking' | 'trend' | 'painpoints' | 'meta';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'basic',      label: '① 기본정보',         icon: Settings },
  { key: 'stops',      label: '② Stops',           icon: MapPin },
  { key: 'transit',    label: '③ Transit Matrix',  icon: Map },
  { key: 'bestfor',    label: '④ Best / Unsuitable', icon: Star },
  { key: 'dietary',    label: '⑤ Dietary',          icon: Utensils },
  { key: 'booking',    label: '⑥ Booking',          icon: Ticket },
  { key: 'trend',      label: '⑦ Trend Hints',      icon: TrendingUp },
  { key: 'painpoints', label: '⑧ Painpoints',       icon: MessageSquare },
  { key: 'meta',       label: '⑨ Meta·QA',          icon: FileText },
];

const AUTOSAVE_DELAY_MS = 1000;

export default function AdminZoneCourseEditor() {
  const { blockId: paramId } = useParams<{ blockId?: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [draft, setDraft] = useState<Partial<ZoneCourseDoc>>({});
  const [blockId, setBlockId] = useState<string>(paramId || '');
  const [tab, setTab] = useState<TabKey>('basic');
  const [loadingDoc, setLoadingDoc] = useState<boolean>(!!paramId);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<Partial<ZoneCourseDoc> | null>(null);

  const isNew = !paramId;

  // 초기 로드 — 기존 blockId 면 draft + published 중 draft 우선
  useEffect(() => {
    if (!paramId) {
      setLoadingDoc(false);
      return;
    }
    let cancelled = false;
    Promise.all([fetchDraft(paramId), fetchZoneCourseById(paramId)])
      .then(([d, b]) => {
        if (cancelled) return;
        const initial = d || b || {};
        setDraft(initial);
        setBlockId(paramId);
      })
      .catch((err) => {
        toast.error(`불러오기 실패: ${err instanceof Error ? err.message : 'unknown'}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });
    return () => { cancelled = true; };
  }, [paramId]);

  // 신규 작성 시 draft.id 가 입력되면 blockId 동기화
  useEffect(() => {
    if (isNew && draft.id && draft.id !== blockId) {
      setBlockId(draft.id);
    }
  }, [draft.id, isNew, blockId]);

  // autosave (1초 throttle, P105 패턴)
  const scheduleAutosave = (next: Partial<ZoneCourseDoc>) => {
    pendingDraftRef.current = next;
    if (!blockId || !user) return; // id 미입력 시 저장 보류
    setSavingState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const toSave = pendingDraftRef.current;
      if (!toSave) return;
      try {
        await saveDraft(blockId, toSave, user.uid);
        setSavingState('saved');
        setLastSavedAt(Date.now());
        pendingDraftRef.current = null;
      } catch (err) {
        setSavingState('idle');
        toast.error(`자동저장 실패: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }, AUTOSAVE_DELAY_MS);
  };

  const handleChange = (patch: Partial<ZoneCourseDoc>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      scheduleAutosave(next);
      return next;
    });
  };

  // beforeunload — pending autosave flush
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingDraftRef.current && blockId && user) {
        e.preventDefault();
        e.returnValue = '저장 중인 변경사항이 있습니다.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [blockId, user]);

  const handleManualSave = async () => {
    if (!blockId || !user) {
      toast.error('블록 ID 를 먼저 입력해주세요.');
      setTab('basic');
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      setSavingState('saving');
      await saveDraft(blockId, draft, user.uid);
      setSavingState('saved');
      setLastSavedAt(Date.now());
      pendingDraftRef.current = null;
      toast.success('저장됨');
    } catch (err) {
      setSavingState('idle');
      toast.error(`저장 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  };

  const handlePublish = async () => {
    if (!blockId || !user) {
      toast.error('블록 ID 를 먼저 입력해주세요.');
      setTab('basic');
      return;
    }
    if (!draft.id || !draft.city || !draft.zone || !draft.theme) {
      toast.error('Basic 탭의 id / city / zone / theme 가 필수입니다.');
      setTab('basic');
      return;
    }
    if (!draft.stops || draft.stops.length < 2) {
      toast.error('Stops 2 개 이상 필요합니다.');
      setTab('stops');
      return;
    }
    if (!window.confirm(
      `"${draft.theme}" (${draft.city.toUpperCase()} ${draft.zone}) 을 발행할까요?\nAI 플래너 후보로 노출됩니다.`,
    )) return;

    setPublishing(true);
    try {
      await saveDraft(blockId, { ...draft, status: 'published' }, user.uid);
      await publishDraft(blockId, user.uid);
      toast.success('발행 완료');
      setTimeout(() => navigate('/admin/zone-courses'), 800);
    } catch (err) {
      toast.error(`발행 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setPublishing(false);
    }
  };

  const savedAgo = useMemo(() => {
    if (!lastSavedAt) return null;
    const diff = Math.floor((Date.now() - lastSavedAt) / 1000);
    if (diff < 5) return '방금';
    if (diff < 60) return `${diff}초 전`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    return `${Math.floor(diff / 3600)}시간 전`;
  }, [lastSavedAt]);

  if (authLoading || loadingDoc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-gray-500 text-sm">
        불러오는 중...
      </div>
    );
  }

  const title = draft.theme || draft.id || '새 존 코스';

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Toaster position="top-center" richColors />

      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/admin/zone-courses')}
              className="p-1.5 rounded-lg hover:bg-gray-100"
              title="목록으로"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-[#1a1a2e] truncate">{title}</h1>
              <p className="text-[10px] text-gray-400">
                {draft.status || 'draft'} · {blockId || 'ID 미입력'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[10px] text-gray-400 mr-1 tabular-nums">
              {savingState === 'saving' ? '저장 중...' : savedAgo ? `자동저장: ${savedAgo}` : ''}
            </div>
            <button
              type="button"
              onClick={handleManualSave}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <Save className="w-3.5 h-3.5" />
              저장
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#7C5CFC] rounded-lg hover:bg-[#6b4ce0] disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {publishing ? '발행 중...' : '발행'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
          {/* Sidebar 탭 */}
          <aside>
            <nav className="bg-white rounded-2xl border border-gray-100 p-2 lg:sticky lg:top-20">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 text-left transition-colors ${
                      active ? 'bg-[#7C5CFC]/10 text-[#7C5CFC]' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* 컨텐츠 */}
          <main className="bg-white rounded-2xl border border-gray-100 p-5">
            {tab === 'basic'      && <BasicTab        draft={draft} onChange={handleChange} isNew={isNew} />}
            {tab === 'stops'      && <StopsTab        draft={draft} onChange={handleChange} />}
            {tab === 'transit'    && <TransitMatrixTab draft={draft} onChange={handleChange} />}
            {tab === 'bestfor'    && <BestForTab      draft={draft} onChange={handleChange} />}
            {tab === 'dietary'    && <DietaryTab      draft={draft} onChange={handleChange} />}
            {tab === 'booking'    && <BookingTab      draft={draft} onChange={handleChange} />}
            {tab === 'trend'      && <TrendHintsTab   draft={draft} onChange={handleChange} />}
            {tab === 'painpoints' && <PainpointsTab   draft={draft} />}
            {tab === 'meta'       && <MetaTab         draft={draft} onChange={handleChange} />}
          </main>
        </div>
      </div>
    </div>
  );
}
