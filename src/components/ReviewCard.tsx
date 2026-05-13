/**
 * ReviewCard — 개별 리뷰 카드 (삭제/신고 메뉴 + 사진 라이트박스)
 */
import { useState } from 'react';
import { MoreHorizontal, Trash2, Flag, X } from 'lucide-react';
import { StarRating } from './StarRating';
import { useAuth } from '@/hooks/useAuth';
import { authFetch } from '@/lib/authFetch';

interface ReviewData {
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

interface Props {
  review: ReviewData;
  onDelete?: (id: string) => void;
}

export function ReviewCard({ review, onDelete }: Props) {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const isAuthor = user?.uid === review.authorUid;

  // photos가 배열이 아닌 경우 방어
  const photoList = Array.isArray(review.photos) ? review.photos.filter(Boolean) : [];

  const handleReport = async () => {
    setReporting(true);
    try {
      // PR #418 IDOR fix: Authorization Bearer — server uses verified auth.uid.
      await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'report', reviewId: review.id }),
      });
    } finally {
      setReporting(false);
      setMenuOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this review?')) return;
    try {
      // PR #418 IDOR fix: server uses verified auth.uid + auth.email.
      await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', reviewId: review.id }),
      });
      onDelete?.(review.id);
    } catch { /* silent */ }
  };

  return (
    <>
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all">
        <div className="flex items-start justify-between">
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
                <StarRating rating={review.rating} size={12} readonly />
                <span className="text-white/55 text-[10px]">
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {user && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-1 rounded hover:bg-white/5 transition-colors"
              >
                <MoreHorizontal size={14} className="text-white/55" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 bg-[#1a1d2e] border border-white/10 rounded-lg shadow-xl z-10 min-w-[140px] overflow-hidden">
                  {isAuthor && (
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-white/5"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                  <button
                    onClick={handleReport}
                    disabled={reporting}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:bg-white/5"
                  >
                    <Flag size={12} /> {reporting ? 'Reporting...' : 'Report'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {review.text && (
          <p className="text-white/70 text-sm mt-3 leading-relaxed">{review.text}</p>
        )}

        {photoList.length > 0 && (
          <div className="flex gap-2 mt-3">
            {photoList.map((url, i) => (
              <button
                key={i}
                onClick={() => setLightbox(url)}
                className="relative group"
              >
                <img
                  src={url}
                  alt={`Review photo ${i + 1}`}
                  className="w-20 h-20 rounded-lg object-cover border border-white/5 group-hover:border-[#7C5CFC]/40 transition-colors"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-4 right-4 text-white/60 hover:text-white">
            <X size={24} />
          </button>
          <img
            src={lightbox}
            alt="Review attachment"
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
