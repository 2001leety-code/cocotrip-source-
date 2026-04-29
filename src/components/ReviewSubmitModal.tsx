/**
 * ReviewSubmitModal — star rating + free-text review for completed bookings.
 *
 * Wires to the existing /api/reviews POST (action: 'create'). Reward of
 * +50 Trip Coins is granted server-side on success. Shown from the
 * "Review" button on MyBookingsTab cards (status === 'COMPLETED').
 *
 * Translations: pulled from t.reviews.* (ko/en/ja/zh). All copy falls back
 * to English so a missing key never breaks the modal.
 */
import { useState } from 'react';
import { Star, X, Loader2 } from 'lucide-react';
import { haptic } from '@/lib/haptic';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Auth uid — required to attribute the review + grant coins. */
  userId: string;
  authorName?: string;
  authorPhotoURL?: string;
  /** What the review is for. 'tour' for tour bookings; 'charter' covers charter rentals. */
  targetType: 'tour' | 'charter' | 'planner';
  /** productType from the booking (e.g. 'tour-seoul-city'). */
  targetId: string;
  /** Display name of the booked product, for the modal header. */
  productLabel?: string;
  onSuccess?: () => void;
}

export function ReviewSubmitModal({
  open, onClose, userId, authorName, authorPhotoURL, targetType, targetId, productLabel, onSuccess,
}: Props) {
  const { language, t } = useLanguage();
  const r = (t as { reviews?: Record<string, string> }).reviews || {};

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSubmit = rating > 0 && text.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          userId,
          targetType,
          targetId,
          rating,
          text: text.trim(),
          photos: [],
          authorName: authorName || '',
          authorPhotoURL: authorPhotoURL || '',
          language,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        haptic('success');
        onSuccess?.();
        onClose();
      } else {
        setError(json.error || (r.errSubmit || 'Submission failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (r.errNetwork || 'Network error'));
    } finally {
      setSubmitting(false);
    }
  }

  const STAR_LABELS: Record<number, string> = {
    1: r.s1 || 'Disappointing',
    2: r.s2 || 'Below average',
    3: r.s3 || 'OK',
    4: r.s4 || 'Good',
    5: r.s5 || 'Excellent',
  };
  const activeStar = hoverRating || rating;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden border"
        style={{
          background: 'linear-gradient(180deg, #0f0820 0%, #0a0512 100%)',
          borderColor: 'rgba(182,104,252,0.30)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex-1 min-w-0">
            <h3 className="text-white text-[15px] font-black truncate">{r.title || 'Write a review'}</h3>
            {productLabel && (
              <p className="text-[11px] text-white/55 mt-0.5 truncate">{productLabel}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/[0.05] flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-white/55" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Star picker */}
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/55 font-semibold mb-2">{r.starsLabel || 'Your rating'}</p>
            <div
              className="flex items-center gap-1"
              onMouseLeave={() => setHoverRating(0)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { haptic('select'); setRating(n); }}
                  onMouseEnter={() => setHoverRating(n)}
                  className="p-1 transition-transform active:scale-90"
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${activeStar >= n ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-white/25'}`}
                  />
                </button>
              ))}
              {activeStar > 0 && (
                <span className="ml-2 text-[12px] font-semibold text-white/65">{STAR_LABELS[activeStar]}</span>
              )}
            </div>
          </div>

          {/* Free text */}
          <div>
            <p className="text-[11px] uppercase tracking-widest text-white/55 font-semibold mb-2">
              {r.textLabel || 'How was your trip?'}
            </p>
            <textarea
              rows={4}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={r.textPlaceholder || 'Driver was friendly, route was perfect...'}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white placeholder:text-white/30 focus:outline-none resize-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
              }}
            />
            <p className="text-[10px] text-white/35 text-right mt-1">{text.length}/500</p>
          </div>

          {/* Reward note */}
          <div
            className="px-3 py-2 rounded-xl flex items-center gap-2"
            style={{ background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.18)' }}
          >
            <span className="text-[14px]">🪙</span>
            <p className="text-[11.5px] text-yellow-200/80">
              {r.rewardNote || 'Earn +50 Trip Coins when your review is posted.'}
            </p>
          </div>

          {error && (
            <p className="text-[11.5px] text-red-400">⚠ {error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {r.submitting || 'Submitting...'}
              </>
            ) : (
              r.submit || 'Submit review'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
