/**
 * AdminReviews — 어드민 리뷰 모더레이션 대시보드
 *
 * /admin/reviews 경로에서 어드민만 접근 가능.
 * 신고된 리뷰(status='reported') 목록 조회 + Keep/Hide/Delete 액션.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ArrowLeft, CheckCircle, EyeOff, Trash2, RefreshCw, AlertTriangle, MessageSquare, Star, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { authFetch } from '@/lib/authFetch';

interface ReportedReview {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  targetType: string;
  targetId: string;
  rating: number;
  text: string;
  photos?: string[];
  status: string;
  reports?: Array<{ reporterUid: string; reason: string; createdAt: number }>;
  reportReason?: string;
  reportedBy?: string;
  reportedAt?: number;
  createdAt: number;
}

// 🔴 2026-07-28: 자체 ADMIN_EMAILS 검사 제거.
// 이 화면은 App.tsx 에서 이미 <AdminRoute> 로 감싸져 있고(중앙 가드), 서버도
// verifyAdminToken 으로 막는다. 여기 있던 중복 검사가 관리자를 홈으로 튕겼다:
// useAuth 는 공유 컨텍스트가 아니라 컴포넌트마다 새 인스턴스라 첫 렌더에서 항상
// user=null 이고, loading 을 안 보고 navigate('/') 를 즉시 실행했다.
// 권한 판단은 중앙 AdminRoute + 서버 verifyAdminToken 두 곳으로 통일한다.

export default function AdminReviews() {
  const { t } = useLanguage();
  const ta = t.admin;
  const tr = ta.reviews;
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<ReportedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'reported' | 'hidden' | 'all'>('reported');
  const [toast, setToast] = useState<string | null>(null);
  // A1-5: silent fail fix — fetch 실패 시 운영자에게 빨간 banner 명시 표시.
  // Before: catch {} + setReviews([]) → "신고 0건" 화면만 보고 fetch 실패 영영 모름.
  const [error, setError] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null); // A1-5: 재시도 시 이전 error 깨끗이 reset
    try {
      // PR #418 IDOR fix: Authorization Bearer — server uses verifyAdminToken.
      const res = await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-list',
          filter,
        }),
      });
      // A1-5: HTTP non-2xx 도 throw 처리 — 401/403/500 silent fail 차단.
      // res.ok 먼저 검증 후 json 파싱 (error body 도 json 일 수 있으니 try-safe).
      // 서버 규격: { ok: true, data: { reviews, count } } — api/reviews.js 의 _ok() 래퍼.
      // 이전에는 최상위 body.reviews 를 읽어 항상 undefined → "Unexpected response shape".
      let body: { ok?: boolean; data?: { reviews?: unknown }; error?: string } = {};
      try {
        body = await res.json();
      } catch {
        // JSON 파싱 실패 — non-2xx 도 본문이 비어있을 수 있음
      }
      if (!res.ok) {
        const serverMsg = typeof body?.error === 'string' ? body.error : res.statusText;
        throw new Error(`HTTP ${res.status}: ${serverMsg}`);
      }
      const reviewList = body?.data?.reviews;
      // A1-5: array 가 아니면 명시적 error — undefined → [] silent fallback 차단.
      // (0건은 빈 배열로 정상 도달한다 = "신고 없음" 화면, 실패와 구분됨)
      if (!Array.isArray(reviewList)) {
        throw new Error(`Unexpected response shape: ${JSON.stringify(body).slice(0, 100)}`);
      }
      setReviews(reviewList as ReportedReview[]);
    } catch (err) {
      // A1-5: catch (err) — error 변수 잡고 console.error + setError.
      // Before: catch {} → console 에 아무것도 안 찍히고 UI 알림 없음.
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error('[AdminReviews] fetchReviews failed:', err);
      setError(msg);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    // 마운트·필터 변경 시 조회. fetchReviews 가 첫 줄에서 setLoading(true) 를 하므로
    // 린트가 "effect 안 setState" 로 잡지만, 이건 의도된 데이터 로딩이다.
    // (이전에는 여기 있던 권한 검사가 관리자를 홈으로 튕겼다 — 파일 상단 주석 참조)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchReviews();
  }, [fetchReviews]);

  const handleModerate = async (reviewId: string, decision: 'keep' | 'hide' | 'delete') => {
    setActionLoading(reviewId);
    try {
      // PR #418 IDOR fix: Authorization Bearer — server uses verifyAdminToken.
      const res = await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'moderate',
          reviewId,
          decision,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReviews(prev => prev.filter(r => r.id !== reviewId));
        const statusLabel =
          decision === 'keep'
            ? ta.statusLabels.kept
            : decision === 'hide'
            ? ta.statusLabels.hidden
            : ta.statusLabels.deleted;
        showToast(
          ta.toasts.reviewAction
            .replace('{status}', statusLabel)
            .replace('{id}', reviewId.slice(0, 8)),
        );
      }
    } catch {
      showToast(ta.toasts.actionFailed);
    } finally {
      setActionLoading(null);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const emptyMessage =
    filter === 'reported'
      ? tr.emptyReported
      : filter === 'hidden'
      ? tr.emptyHidden
      : tr.emptyAll;

  const statusBadgeLabel = (status: string) => {
    if (status === 'reported') return tr.statusBadge.reported;
    if (status === 'hidden') return tr.statusBadge.hidden;
    if (status === 'published') return tr.statusBadge.published;
    return status;
  };

  return (
    <div className="min-h-screen bg-[#0a0b14] text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0b14]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin')} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
              <ArrowLeft size={18} className="text-white/50" />
            </button>
            <Shield size={20} className="text-[#7C5CFC]" />
            <h1 className="text-lg font-bold">{tr.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchReviews}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              title={tr.refresh}
            >
              <RefreshCw size={16} className={`text-white/50 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-white/55 text-xs">{tr.itemCount.replace('{n}', String(reviews.length))}</span>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="flex gap-2 mb-6">
          {(['reported', 'hidden', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                filter === f
                  ? 'bg-[#7C5CFC] text-white'
                  : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              {tr.filters[f]}
            </button>
          ))}
        </div>

        {/* A1-5: silent fail fix — fetch 실패 시 빨간 banner + 다시 시도 버튼.
            Before: error 발생해도 "신고 0건" empty state 만 노출 → 운영자 영영 모름.
            loading 끝나고 error 있을 때만 노출 (loading 중에는 spinner 가 우선). */}
        {!loading && error && (
          <div className="flex items-start gap-3 mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-red-200">리뷰 목록을 불러오지 못했습니다</p>
              <p className="text-red-300/80 text-xs mt-1 break-words">{error}</p>
            </div>
            <button
              onClick={fetchReviews}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-medium transition-colors"
            >
              다시 시도
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
          </div>
        ) : error ? (
          // 🔴 2026-07-28: 조회 실패일 때 "신고 0건" 빈 상태를 같이 그리지 않는다.
          //   위 빨간 배너만 남긴다 — 실패를 "없음"으로 오해하면 신고 리뷰가 방치된다.
          null
        ) : reviews.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquare size={48} className="mx-auto text-white/10 mb-4" />
            <p className="text-white/55 text-sm">{emptyMessage}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map(review => (
              <div
                key={review.id}
                className="rounded-2xl bg-white/[0.03] border border-white/5 p-5 hover:border-white/10 transition-all"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {review.authorPhotoURL ? (
                      <img src={review.authorPhotoURL} alt={review.authorName || 'Reviewer'} className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7C5CFC] to-[#EA537E] flex items-center justify-center text-white text-xs font-bold">
                        {(review.authorName || 'A')[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-white text-sm font-medium">{review.authorName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} size={10} className={i < review.rating ? 'text-[#FFD700] fill-[#FFD700]' : 'text-white/10'} />
                          ))}
                        </div>
                        <span className="text-white/55 text-[10px]">
                          {new Date(review.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    review.status === 'reported' ? 'bg-red-500/20 text-red-400' :
                    review.status === 'hidden' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {statusBadgeLabel(review.status)}
                  </span>
                </div>

                {/* Content */}
                {review.text && (
                  <p className="text-white/70 text-sm mb-3 leading-relaxed">{review.text}</p>
                )}

                {/* Photos */}
                {review.photos && review.photos.length > 0 && (
                  <div className="flex gap-2 mb-3">
                    {review.photos.map((url, i) => (
                      <img key={i} src={url} alt={`Review attachment ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-white/5" />
                    ))}
                  </div>
                )}

                {/* Report info */}
                <div className="bg-red-500/[0.05] border border-red-500/10 rounded-xl p-3 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={12} className="text-red-400" />
                    <span className="text-red-400 text-xs font-medium">{tr.reportDetails}</span>
                  </div>
                  {review.reports && review.reports.length > 0 ? (
                    <div className="space-y-1">
                      {review.reports.map((rpt, idx) => (
                        <p key={idx} className="text-white/55 text-xs">
                          • {rpt.reason || tr.noReasonGiven} — {new Date(rpt.createdAt).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-white/55 text-xs">
                      {review.reportReason || tr.noReason} — {tr.byReporter.replace('{name}', review.reportedBy || tr.unknown)}
                    </p>
                  )}
                </div>

                {/* Meta */}
                <div className="flex items-center gap-4 mb-4 text-white/55 text-[10px]">
                  <span>{tr.metaType.replace('{type}', review.targetType)}</span>
                  <span>{tr.metaTarget.replace('{id}', review.targetId.slice(0, 12))}</span>
                  <span>{tr.metaAuthor.replace('{id}', review.authorUid.slice(0, 12))}</span>
                  {review.targetType === 'plan' && (
                    <a
                      href={`/my-plans/${review.targetId}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-1 text-[#7C5CFC] hover:text-[#7C5CFC]/80"
                    >
                      <ExternalLink size={10} /> {tr.viewPlan}
                    </a>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleModerate(review.id, 'keep')}
                    disabled={actionLoading === review.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/10 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle size={14} /> {tr.actions.keep}
                  </button>
                  <button
                    onClick={() => handleModerate(review.id, 'hide')}
                    disabled={actionLoading === review.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-yellow-500/10 text-yellow-400 text-xs font-medium hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                  >
                    <EyeOff size={14} /> {tr.actions.hide}
                  </button>
                  <button
                    onClick={() => handleModerate(review.id, 'delete')}
                    disabled={actionLoading === review.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={14} /> {tr.actions.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl bg-[#1a1d2e] border border-white/10 text-white text-sm shadow-xl animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
