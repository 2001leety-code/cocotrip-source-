/**
 * ReviewList — 리뷰 목록 + 작성 버튼
 */
import { useState, useEffect, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { ReviewCard } from './ReviewCard';
import { ReviewWriteModal } from './ReviewWriteModal';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  targetType: 'plan' | 'tour';
  targetId: string;
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

export function ReviewList({ targetType, targetId }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  const fetchReviews = useCallback(async () => {
    try {
      const res = await fetch('/api/reviews', {
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
  const rl = (tRec.reviews as Record<string, string> | undefined) || {
    writeButton: 'Write a review',
    empty: 'Be the first to review',
    count: '{count} reviews',
    alreadyReviewed: "You've already reviewed this",
  };

  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0';

  return (
    <div className="mt-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-[#7C5CFC]" />
          <h3 className="text-white text-lg font-bold">
            {rl.count?.replace('{count}', String(reviews.length)) || `${reviews.length} reviews`}
          </h3>
          {reviews.length > 0 && (
            <span className="text-[#FFD700] text-sm font-semibold">★ {avgRating}</span>
          )}
        </div>
        {user && !hasReviewed && (
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {rl.writeButton}
          </button>
        )}
        {user && hasReviewed && (
          <span className="text-white/55 text-xs">{rl.alreadyReviewed}</span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#7C5CFC] border-t-transparent animate-spin rounded-full" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-10 text-white/55 text-sm">
          {rl.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map(r => (
            <ReviewCard key={r.id} review={r} onDelete={handleDelete} />
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
        />
      )}
    </div>
  );
}
