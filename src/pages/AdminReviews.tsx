/**
 * AdminReviews — 어드민 리뷰 모더레이션 대시보드
 *
 * /admin/reviews 경로에서 어드민만 접근 가능.
 * 신고된 리뷰(status='reported') 목록 조회 + Keep/Hide/Delete 액션.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ArrowLeft, CheckCircle, EyeOff, Trash2, RefreshCw, AlertTriangle, MessageSquare, Star, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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

const ADMIN_EMAILS = ['2001leety@gmail.com'];

export default function AdminReviews() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<ReportedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'reported' | 'hidden' | 'all'>('reported');
  const [toast, setToast] = useState<string | null>(null);

  const isAdmin = ADMIN_EMAILS.includes((user?.email || '').toLowerCase());

  const fetchReviews = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-list',
          userEmail: user?.email,
          filter,
        }),
      });
      const data = await res.json();
      setReviews(data.reviews || []);
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.email, filter]);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    fetchReviews();
  }, [isAdmin, navigate, fetchReviews]);

  const handleModerate = async (reviewId: string, decision: 'keep' | 'hide' | 'delete') => {
    setActionLoading(reviewId);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'moderate',
          reviewId,
          decision,
          userEmail: user?.email,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReviews(prev => prev.filter(r => r.id !== reviewId));
        const labels = { keep: 'Published', hide: 'Hidden', delete: 'Deleted' };
        showToast(`Review ${labels[decision]}: ${reviewId.slice(0, 8)}...`);
      }
    } catch {
      showToast('Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  if (!isAdmin) return null;

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
            <h1 className="text-lg font-bold">Review Moderation</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchReviews}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} className={`text-white/50 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-white/30 text-xs">{reviews.length} items</span>
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
              {f === 'reported' && '🚩 Reported'}
              {f === 'hidden' && '👁️ Hidden'}
              {f === 'all' && '📋 All'}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-20">
            <MessageSquare size={48} className="mx-auto text-white/10 mb-4" />
            <p className="text-white/30 text-sm">No {filter} reviews</p>
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
                      <img src={review.authorPhotoURL} alt="" className="w-8 h-8 rounded-full" />
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
                        <span className="text-white/20 text-[10px]">
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
                    {review.status}
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
                      <img key={i} src={url} alt="" className="w-16 h-16 rounded-lg object-cover border border-white/5" />
                    ))}
                  </div>
                )}

                {/* Report info */}
                <div className="bg-red-500/[0.05] border border-red-500/10 rounded-xl p-3 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={12} className="text-red-400" />
                    <span className="text-red-400 text-xs font-medium">Report Details</span>
                  </div>
                  {review.reports && review.reports.length > 0 ? (
                    <div className="space-y-1">
                      {review.reports.map((rpt, idx) => (
                        <p key={idx} className="text-white/40 text-xs">
                          • {rpt.reason || 'No reason given'} — {new Date(rpt.createdAt).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-white/40 text-xs">
                      {review.reportReason || 'No reason'} — by {review.reportedBy || 'unknown'}
                    </p>
                  )}
                </div>

                {/* Meta */}
                <div className="flex items-center gap-4 mb-4 text-white/20 text-[10px]">
                  <span>Type: {review.targetType}</span>
                  <span>Target: {review.targetId.slice(0, 12)}...</span>
                  <span>Author UID: {review.authorUid.slice(0, 12)}...</span>
                  {review.targetType === 'plan' && (
                    <a
                      href={`/my-plans/${review.targetId}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-1 text-[#7C5CFC] hover:text-[#7C5CFC]/80"
                    >
                      <ExternalLink size={10} /> View Plan
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
                    <CheckCircle size={14} /> Keep
                  </button>
                  <button
                    onClick={() => handleModerate(review.id, 'hide')}
                    disabled={actionLoading === review.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-yellow-500/10 text-yellow-400 text-xs font-medium hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                  >
                    <EyeOff size={14} /> Hide
                  </button>
                  <button
                    onClick={() => handleModerate(review.id, 'delete')}
                    disabled={actionLoading === review.id}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={14} /> Delete
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
