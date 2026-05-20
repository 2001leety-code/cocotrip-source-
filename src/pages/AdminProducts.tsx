// ─────────────────────────────────────────────────────────────────────────────
// AdminProducts — 어드민 상품 목록 (Phase 2, 2026-05-19)
//   /admin/products
//   Firestore tours 컬렉션의 모든 상품 (draft/published/archived) 노출
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { toast, Toaster } from 'sonner';
import {
  Plus, Edit2, ArrowLeft, Eye, EyeOff, Image as ImageIcon, RefreshCw, Download, ChevronDown, ChevronUp,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { resolvePhotoUrl, importStaticTour } from '@/lib/tours-firestore';
import type { Tour, TourStatus } from '@/data/tours';
import { TOURS } from '@/data/tours';

export default function AdminProducts() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<Array<Tour & { _docId: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showStaticImport, setShowStaticImport] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      // 어드민은 모든 status 봐야 함 → orderBy createdAt desc 만 사용 (where 없음)
      // status 필터 X 상태로 전체 fetch
      const q = query(collection(db, 'tours'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ ...(d.data() as Tour), _docId: d.id }));
      setItems(list);
    } catch (err) {
      // 인덱스/권한 문제 시 ordering 없이 재시도
      try {
        const snap = await getDocs(collection(db, 'tours'));
        const list = snap.docs.map((d) => ({ ...(d.data() as Tour), _docId: d.id }));
        setItems(list);
      } catch (err2) {
        toast.error(`불러오기 실패: ${err2 instanceof Error ? err2.message : 'unknown'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading]);

  const handleImportStatic = async (staticTour: Tour) => {
    if (!user) return;
    const existing = items.find((it) => it._docId === staticTour.id);
    if (existing && !window.confirm(`이미 Firestore 에 "${staticTour.id}" 가 있습니다. draft 를 덮어쓸까요?`)) return;

    setImportingId(staticTour.id);
    try {
      const tourId = await importStaticTour(staticTour, user.uid);
      toast.success(`정적 투어 → Firestore draft 로 import 완료`);
      navigate(`/admin/products/edit/${tourId}`);
    } catch (err) {
      toast.error(`Import 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setImportingId(null);
    }
  };

  // Firestore 에 이미 등록된 정적 투어 id set — UI 에 "이미 가져옴" 표시
  const importedIds = new Set(items.map((it) => it._docId));

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-sm text-gray-500">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] p-4 sm:p-6">
      <Toaster position="top-center" richColors />

      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="p-1.5 rounded-lg hover:bg-gray-100"
              title="어드민 홈"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#1a1a2e]">상품 관리</h1>
              <p className="text-sm text-gray-500 mt-0.5">OTA 표준 30+ 필드 — 4언어·갤러리·일정·미팅포인트·FAQ·취소정책</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 hover:text-[#7C5CFC]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/products/new')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#7C5CFC] rounded-xl hover:bg-[#6b4ce0]"
            >
              <Plus className="w-4 h-4" />
              새 상품 등록
            </button>
          </div>
        </div>

        {/* 정적 9 투어 import 섹션 (collapse) */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowStaticImport((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50/50 transition-colors"
            aria-expanded={showStaticImport}
          >
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-[#7C5CFC]" />
              <span className="text-sm font-bold text-[#1a1a2e]">정적 투어 가져오기 (TOURS.ts → Firestore)</span>
              <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                {TOURS.length} 개
              </span>
            </div>
            {showStaticImport ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showStaticImport && (
            <div className="px-5 pb-4 border-t border-gray-100">
              <p className="text-[11px] text-gray-500 mt-3 mb-3">
                코드에 하드코드된 정적 투어를 Firestore draft 로 복제합니다. 사진은 /public 경로 그대로 유지 (legacy_public_path 보존).
                Import 후 편집 → Publish 하면 Firestore 가 정적보다 우선 표시됩니다.
              </p>
              <ul className="divide-y divide-gray-100">
                {TOURS.map((staticTour) => {
                  const already = importedIds.has(staticTour.id);
                  const busy = importingId === staticTour.id;
                  return (
                    <li key={staticTour.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">
                          {staticTour.title.ko}
                        </p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {staticTour.id} · {staticTour.region} · {staticTour.durationDays}일 · {staticTour.images.length}장
                        </p>
                      </div>
                      <div className="shrink-0">
                        {already ? (
                          <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                            ✓ 이미 등록됨
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleImportStatic(staticTour)}
                            disabled={busy}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10 disabled:opacity-50"
                          >
                            <Download className="w-3 h-3" />
                            {busy ? '가져오는 중...' : '가져오기'}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              등록된 상품이 없습니다.
              <br />
              <button
                type="button"
                onClick={() => navigate('/admin/products/new')}
                className="mt-3 text-[#7C5CFC] underline"
              >
                첫 상품 등록하기
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((tour) => (
                <ProductRow key={tour._docId} tour={tour} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductRow({ tour }: { tour: Tour & { _docId: string } }) {
  const navigate = useNavigate();
  const thumb = tour.thumbnail_photo
    ? resolvePhotoUrl(tour.thumbnail_photo)
    : tour.thumbnail || (tour.photos?.[0] ? resolvePhotoUrl(tour.photos[0]) : '');

  const statusBadge = (s: TourStatus | undefined) => {
    const cfg = {
      draft:     { bg: 'bg-amber-50',   text: 'text-amber-700',  label: 'Draft', icon: EyeOff },
      published: { bg: 'bg-green-50',   text: 'text-green-700',  label: 'Published', icon: Eye },
      archived:  { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Archived', icon: EyeOff },
    }[s ?? 'draft'];
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 ${cfg.bg} ${cfg.text} px-2 py-0.5 rounded-full text-[10px] font-bold`}>
        <Icon className="w-2.5 h-2.5" />
        {cfg.label}
      </span>
    );
  };

  return (
    <li className="px-4 sm:px-5 py-3 hover:bg-gray-50/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-20 h-14 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
          {thumb ? (
            <img
              src={thumb}
              alt={tour.title?.ko ?? ''}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <ImageIcon className="w-5 h-5 text-gray-300" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-[#1a1a2e] truncate">
              {tour.title?.ko || tour.title?.en || tour._docId}
            </p>
            {statusBadge(tour.status)}
            {tour.do_not_delete && (
              <span className="text-[9px] font-bold bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">
                🔒 보호
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 truncate">
            {tour.region} · {tour.durationDays}일 · {tour.vehicleType} · /tours/{tour.slug ?? tour._docId}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {tour.slug && tour.status === 'published' && (
            <a
              href={`/tours/${tour.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:text-[#7C5CFC]"
            >
              사용자 보기 ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => navigate(`/admin/products/edit/${tour._docId}`)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10"
          >
            <Edit2 className="w-3 h-3" />
            편집
          </button>
        </div>
      </div>
    </li>
  );
}
