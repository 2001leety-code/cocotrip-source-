// ─────────────────────────────────────────────────────────────────────────────
// AdminProductEditor — 9-탭 어드민 상품 등록/편집 (Phase 2, 2026-05-19)
//   /admin/products/new — 빈 draft 시작
//   /admin/products/edit/:tourId — 기존 tour 편집 (draft + published merge)
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast, Toaster } from 'sonner';
import {
  Settings, Image as ImageIcon, MapPin, Clock, Tag,
  Map, ShieldCheck, HelpCircle, FileText, Save, Send, Eye, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchTourById, fetchDraft, saveDraft, publishDraft,
} from '@/lib/tours-firestore';
import { validateProductPublish } from '@/lib/admin-product-publish-validation';
import type { Tour } from '@/data/tours';
import { BasicInfoTab } from '@/components/admin/ProductEditor/BasicInfoTab';
import { MediaTab } from '@/components/admin/ProductEditor/MediaTab';
import { StopsTab } from '@/components/admin/ProductEditor/StopsTab';
import { MeetingPointTab } from '@/components/admin/ProductEditor/MeetingPointTab';
import { PricingTab } from '@/components/admin/ProductEditor/PricingTab';
import { IncludedExcludedTab } from '@/components/admin/ProductEditor/IncludedExcludedTab';
import { CancellationTab } from '@/components/admin/ProductEditor/CancellationTab';
import { FaqTab } from '@/components/admin/ProductEditor/FaqTab';
import { MetaTab } from '@/components/admin/ProductEditor/MetaTab';

type TabKey = 'basic' | 'media' | 'stops' | 'meeting' | 'pricing' | 'included' | 'cancel' | 'faq' | 'meta';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'basic',    label: '① 기본정보',    icon: Settings },
  { key: 'media',    label: '② 미디어',      icon: ImageIcon },
  { key: 'stops',    label: '③ 일정',        icon: Clock },
  { key: 'meeting',  label: '④ 미팅포인트',   icon: MapPin },
  { key: 'pricing',  label: '⑤ 가격·예약',    icon: Tag },
  { key: 'included', label: '⑥ 포함·미포함',  icon: Map },
  { key: 'cancel',   label: '⑦ 취소정책',     icon: ShieldCheck },
  { key: 'faq',      label: '⑧ FAQ',         icon: HelpCircle },
  { key: 'meta',     label: '⑨ 메타·QA',     icon: FileText },
];

const AUTOSAVE_DELAY_MS = 1000;

export default function AdminProductEditor() {
  const { tourId: paramId } = useParams<{ tourId?: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [draft, setDraft] = useState<Partial<Tour>>({});
  const [tourId, setTourId] = useState<string>(paramId || '');
  const [tab, setTab] = useState<TabKey>('basic');
  const [loadingDoc, setLoadingDoc] = useState<boolean>(!!paramId);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<Partial<Tour> | null>(null);

  // 초기 로드 — 기존 tourId 면 draft + published 중 최신
  useEffect(() => {
    if (!paramId) {
      setLoadingDoc(false);
      return;
    }
    let cancelled = false;
    Promise.all([fetchDraft(paramId), fetchTourById(paramId)])
      .then(([d, t]) => {
        if (cancelled) return;
        // draft 가 있으면 그게 우선 (작성 중 상태 보존). 없으면 published 복제.
        const initial = d || t || {};
        setDraft(initial);
        setTourId(paramId);
      })
      .catch((err) => {
        toast.error(`불러오기 실패: ${err instanceof Error ? err.message : 'unknown'}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });
    return () => { cancelled = true; };
  }, [paramId]);

  // slug 가 tourId 와 다른 경우 (신규 입력) → tourId 동기화
  useEffect(() => {
    if (!paramId && draft.slug && draft.slug !== tourId) {
      setTourId(draft.slug);
    }
  }, [draft.slug, paramId, tourId]);

  // autosave (1초 throttle)
  const scheduleAutosave = (next: Partial<Tour>) => {
    pendingDraftRef.current = next;
    if (!tourId || !user) return; // slug 가 아직 입력 안 됨 → 저장 보류
    setSavingState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const toSave = pendingDraftRef.current;
      if (!toSave) return;
      try {
        await saveDraft(tourId, toSave, user.uid);
        setSavingState('saved');
        setLastSavedAt(Date.now());
        pendingDraftRef.current = null;
      } catch (err) {
        setSavingState('idle');
        toast.error(`자동저장 실패: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }, AUTOSAVE_DELAY_MS);
  };

  const handleChange = (patch: Partial<Tour>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      scheduleAutosave(next);
      return next;
    });
  };

  // beforeunload — pending autosave flush
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingDraftRef.current && tourId && user) {
        // sync save 안 됨 (Firestore async) — 사용자에게 confirm
        e.preventDefault();
        e.returnValue = '저장 중인 변경사항이 있습니다.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [tourId, user]);

  const handleManualSave = async () => {
    if (!tourId || !user) {
      toast.error('슬러그를 먼저 입력해주세요.');
      setTab('basic');
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      setSavingState('saving');
      await saveDraft(tourId, draft, user.uid);
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
    if (!tourId || !user) {
      toast.error('슬러그를 먼저 입력해주세요.');
      setTab('basic');
      return;
    }
    // A1-7-3: SSOT publish 검증 (i18n basic / stops>=2 / slots>=1 / photos>=3)
    const validation = validateProductPublish(draft);
    if (!validation.ok) {
      toast.error(validation.message || '발행 전 필수 항목이 부족합니다.');
      if (validation.suggestedTab) {
        setTab(validation.suggestedTab);
      }
      return;
    }
    if (!window.confirm(`"${draft.title?.ko}" 투어를 발행할까요?\n공개되어 사용자에게 노출됩니다.`)) return;

    setPublishing(true);
    try {
      // 먼저 latest draft flush
      await saveDraft(tourId, { ...draft, status: 'published' }, user.uid);
      await publishDraft(tourId, user.uid);
      toast.success('발행 완료');
      // 목록으로 이동
      setTimeout(() => navigate('/admin/products'), 800);
    } catch (err) {
      toast.error(`발행 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setPublishing(false);
    }
  };

  const handlePreview = () => {
    if (!draft.slug) {
      toast.error('슬러그를 먼저 입력해주세요.');
      setTab('basic');
      return;
    }
    window.open(`/tours/${draft.slug}?preview=draft`, '_blank');
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

  const title = draft.title?.ko || draft.title?.en || (paramId ? paramId : '새 상품');

  return (
    <div className="min-h-screen bg-[#faf9f6]">
      <Toaster position="top-center" richColors />

      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/admin/products')}
              className="p-1.5 rounded-lg hover:bg-gray-100"
              title="목록으로"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-[#1a1a2e] truncate">{title}</h1>
              <p className="text-[10px] text-gray-400">
                {draft.status || 'draft'} · {tourId || 'slug 미입력'}
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
              onClick={handlePreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10"
            >
              <Eye className="w-3.5 h-3.5" />
              미리보기
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
            {tab === 'basic' && <BasicInfoTab draft={draft} onChange={handleChange} />}
            {tab === 'media' && <MediaTab draft={draft} tourId={tourId || 'new'} onChange={handleChange} />}
            {tab === 'stops' && <StopsTab draft={draft} tourId={tourId || 'new'} onChange={handleChange} />}
            {tab === 'meeting' && <MeetingPointTab draft={draft} tourId={tourId || 'new'} onChange={handleChange} />}
            {tab === 'pricing' && <PricingTab draft={draft} onChange={handleChange} />}
            {tab === 'included' && <IncludedExcludedTab draft={draft} onChange={handleChange} />}
            {tab === 'cancel' && <CancellationTab draft={draft} onChange={handleChange} />}
            {tab === 'faq' && <FaqTab draft={draft} onChange={handleChange} />}
            {tab === 'meta' && <MetaTab draft={draft} onChange={handleChange} />}
          </main>
        </div>
      </div>
    </div>
  );
}
