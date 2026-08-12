/**
 * ReviewCard — 개별 리뷰 카드 (삭제/신고 메뉴 + 사진 라이트박스)
 */
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Trash2, Flag, X } from 'lucide-react';
import { StarRating } from './StarRating';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
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
  surface?: 'legacy' | 'paper';
}

export function ReviewCard({ review, onDelete, surface = 'legacy' }: Props) {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; index: number } | null>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const lightboxTriggerRef = useRef<HTMLButtonElement>(null);
  const isAuthor = user?.uid === review.authorUid;
  const paper = surface === 'paper';
  const labels = t.planDetail.reviews;
  const dateLocale = language === 'ko' ? 'ko-KR' : language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : 'en-US';

  // photos가 배열이 아닌 경우 방어
  const photoList = Array.isArray(review.photos) ? review.photos.filter(Boolean) : [];

  useEffect(() => {
    if (!menuOpen && !lightbox) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setLightbox(null);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [lightbox, menuOpen]);

  useEffect(() => {
    if (!paper || !lightbox) return;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => lightboxCloseRef.current?.focus());
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      lightboxCloseRef.current?.focus();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleTab);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleTab);
      lightboxTriggerRef.current?.focus();
    };
  }, [lightbox, paper]);

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
    if (!confirm(paper ? labels.deleteConfirm : 'Delete this review?')) return;
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
      <article className={paper ? 'rounded-ec-md border border-ec-line bg-ec-raised p-4' : 'rounded-xl border border-white/5 bg-white/[0.03] p-4 transition-all hover:border-white/10'}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {review.authorPhotoURL ? (
              <img src={review.authorPhotoURL} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className={paper ? 'flex h-8 w-8 items-center justify-center rounded-full bg-ec-brand text-xs font-bold text-ec-on-brand' : 'flex h-8 w-8 items-center justify-center rounded-full bg-[#7C5CFC] text-xs font-bold text-white'}>
                {(review.authorName || 'A')[0].toUpperCase()}
              </div>
            )}
            <div>
              <p className={paper ? 'text-sm font-medium text-ec-ink' : 'text-sm font-medium text-white'}>{review.authorName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <StarRating rating={review.rating} size={12} readonly />
                <span className={paper ? 'text-[11px] text-ec-ink-3' : 'text-[10px] text-white/55'}>
                  {new Date(review.createdAt).toLocaleDateString(dateLocale)}
                </span>
              </div>
            </div>
          </div>

          {user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className={paper ? 'flex h-11 w-11 items-center justify-center rounded-ec-sm text-ec-ink-3 transition-colors hover:bg-ec-sunken hover:text-ec-ink' : 'flex h-11 w-11 items-center justify-center rounded transition-colors hover:bg-white/5'}
                aria-label={paper ? labels.optionsLabel : 'Review options'}
              >
                <MoreHorizontal size={16} className={paper ? '' : 'text-white/55'} aria-hidden />
              </button>
              {menuOpen && (
                <div className={paper ? 'absolute right-0 top-11 z-10 min-w-[140px] overflow-hidden rounded-ec-sm border border-ec-line bg-ec-raised shadow-ec-overlay' : 'absolute right-0 top-11 z-10 min-w-[140px] overflow-hidden rounded-lg border border-white/10 bg-[#1a1d2e] shadow-xl'} role="menu">
                  {isAuthor && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className={paper ? 'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-xs text-ec-critical hover:bg-ec-sunken' : 'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-white/5'}
                      role="menuitem"
                    >
                      <Trash2 size={12} aria-hidden /> {paper ? labels.deleteButton : 'Delete'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleReport}
                    disabled={reporting}
                    className={paper ? 'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-xs text-ec-ink-2 hover:bg-ec-sunken' : 'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-xs text-white/50 hover:bg-white/5'}
                    role="menuitem"
                  >
                    <Flag size={12} aria-hidden /> {paper ? (reporting ? labels.reporting : labels.reportButton) : (reporting ? 'Reporting...' : 'Report')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {review.text && (
          <p className={paper ? 'mt-3 text-sm leading-relaxed text-ec-ink-2' : 'mt-3 text-sm leading-relaxed text-white/70'}>{review.text}</p>
        )}

        {photoList.length > 0 && (
          <div className="flex gap-2 mt-3">
            {photoList.map((url, i) => (
              <button
                key={i}
                type="button"
                onClick={(event) => {
                  lightboxTriggerRef.current = event.currentTarget;
                  setLightbox({ src: url, index: i + 1 });
                }}
                className="group relative min-h-[44px] min-w-[44px]"
                aria-label={paper ? labels.photoLabel.replace('{index}', String(i + 1)) : `Review photo ${i + 1}`}
              >
                <img
                  src={url}
                  alt={paper ? labels.photoLabel.replace('{index}', String(i + 1)) : `Review photo ${i + 1}`}
                  className={paper ? 'h-20 w-20 rounded-ec-sm border border-ec-line object-cover transition-colors group-hover:border-ec-line-3' : 'h-20 w-20 rounded-lg border border-white/5 object-cover transition-colors group-hover:border-[#7C5CFC]/40'}
                />
              </button>
            ))}
          </div>
        )}
      </article>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label={paper ? labels.photoLabel.replace('{index}', String(lightbox.index)) : `Review attachment ${lightbox.index}`}
        >
          <button ref={lightboxCloseRef} type="button" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center text-white/60 hover:text-white" onClick={() => setLightbox(null)} aria-label={paper ? labels.closeImage : 'Close image'}>
            <X size={24} aria-hidden />
          </button>
          <img
            src={lightbox.src}
            alt={paper ? labels.photoLabel.replace('{index}', String(lightbox.index)) : `Review attachment ${lightbox.index}`}
            className="max-w-full max-h-[85vh] rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
