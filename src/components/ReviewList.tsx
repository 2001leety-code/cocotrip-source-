/**
 * ReviewList — 리뷰 목록 + 작성 버튼
 */
import { useState, useEffect, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { ReviewCard } from './ReviewCard';
import { ReviewWriteModal } from './ReviewWriteModal';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { authFetch } from '@/lib/authFetch';

interface Props {
  targetType: 'plan' | 'tour';
  targetId: string;
  surface?: 'legacy' | 'paper';
}

interface ReviewItem {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  rating: number;
  text: string;
  photos?: string[];
  createdAt: number;
  language?: string;
}

export function ReviewList({ targetType, targetId, surface = 'legacy' }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  const fetchReviews = useCallback(async () => {
    try {
      const res = await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', targetType, targetId }),
      });
      const data = await res.json();
      setReviews(data.reviews || []);
      if (user) {
        setHasReviewed(data.reviews?.some((r: ReviewItem) => r.authorUid === user.uid) || false);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [targetType, targetId, user]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const handleDelete = (id: string) => {
    setReviews(prev => prev.filter(r => r.id !== id));
  };

  const handleCreated = () => {
    setShowModal(false);
    setHasReviewed(true);
    fetchReviews();
  };

  const tRec = t as Record<string, unknown>;
  const legacyReviews = (tRec.reviews as Record<string, string> | undefined) || {
    writeButton: 'Write a review',
    empty: 'Be the first to review',
    count: '{count} reviews',
    alreadyReviewed: "You've already reviewed this",
  };

  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0';
  const paper = surface === 'paper';
  const rl = paper ? t.planDetail.reviews : legacyReviews;

  if (paper && !loading && reviews.length === 0 && !user) return null;

  return (
    <section className={paper ? 'mt-10 border-t border-ec-line pt-8' : 'mt-10'} data-review-surface={surface}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare className={paper ? 'h-5 w-5 text-ec-brand' : 'h-5 w-5 text-[#7C5CFC]'} aria-hidden />
          {(paper || reviews.length > 0) && (
            <h3 className={paper ? 'text-[18px] font-bold text-ec-ink' : 'text-lg font-bold text-white'}>
              {reviews.length > 0
                ? (rl.count?.replace('{count}', String(reviews.length)) || `${reviews.length} reviews`)
                : rl.empty}
            </h3>
          )}
          {reviews.length > 0 && (
            <span className={paper ? 'text-sm font-semibold text-ec-notice' : 'text-sm font-semibold text-[#FFD700]'}>★ {avgRating}</span>
          )}
        </div>
        {user && !hasReviewed && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className={paper ? 'ec-btn ec-btn-primary min-h-[44px]' : 'min-h-[44px] rounded-xl bg-[#7C5CFC] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90'}
          >
            {rl.writeButton}
          </button>
        )}
        {user && hasReviewed && (
          <span className={paper ? 'text-xs text-ec-ink-3' : 'text-xs text-white/55'}>{rl.alreadyReviewed}</span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-label={paper ? t.planDetail.reviews.loading : 'Loading reviews'}>
          <div className={paper ? 'h-6 w-6 animate-spin rounded-full border-2 border-ec-brand border-t-transparent' : 'h-6 w-6 animate-spin rounded-full border-2 border-[#7C5CFC] border-t-transparent'} />
        </div>
      ) : reviews.length === 0 ? (
        paper ? null : (
          <div className="py-10 text-center text-sm text-white/55">
            {rl.empty}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {reviews.map(r => (
            <ReviewCard key={r.id} review={r} onDelete={handleDelete} surface={surface} />
          ))}
        </div>
      )}

      {/* Write Modal */}
      {showModal && (
        <ReviewWriteModal
          targetType={targetType}
          targetId={targetId}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          surface={surface}
        />
      )}
    </section>
  );
}
