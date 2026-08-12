/**
 * ReviewWriteModal — 리뷰 작성 모달 (별점 + 텍스트 + 사진 업로드)
 */
import { useEffect, useState, useRef } from 'react';
import { X, Send, Coins, Camera, Trash2 } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { StarRating } from './StarRating';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { authFetch } from '@/lib/authFetch';

interface Props {
  targetType: 'plan' | 'tour';
  targetId: string;
  onClose: () => void;
  onCreated: () => void;
  surface?: 'legacy' | 'paper';
}

const MAX_PHOTOS = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function ReviewWriteModal({ targetType, targetId, onClose, onCreated, surface = 'legacy' }: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const paper = surface === 'paper';

  const tRec = t as Record<string, unknown>;
  const legacyReviews = (tRec.reviews as Record<string, string> | undefined) || {
    rating: 'Your rating',
    placeholder: 'Share your experience...',
    submit: 'Submit review',
    rewardToast: 'Thanks! +50 Trip Coins earned',
    charLimit: '{used}/500',
  };
  const rl = paper ? t.planDetail.reviews : legacyReviews;

  useEffect(() => {
    if (!paper) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const focusIsOutside = !dialogRef.current.contains(activeElement);
      if (event.shiftKey && (activeElement === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, paper]);

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - photos.length;
    let validationError: string | null = null;
    const validFiles = files.slice(0, remaining).filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        validationError = paper ? rl.photoSize : 'Photo must be under 5MB';
        return false;
      }
      if (!f.type.startsWith('image/')) {
        validationError = paper ? rl.photoType : 'Only images allowed';
        return false;
      }
      return true;
    });

    const newPhotos = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    setError(validationError);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => {
      const removed = prev[index];
      URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadPhotos = async (): Promise<string[]> => {
    if (photos.length === 0) return [];
    const urls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      setUploadProgress(paper ? `${rl.photoUploading} ${i + 1}/${photos.length}` : `Uploading ${i + 1}/${photos.length}...`);
      const file = photos[i].file;
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `reviews/${user?.uid}/${Date.now()}_${i}.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      urls.push(url);
    }
    setUploadProgress('');
    return urls;
  };

  const handleSubmit = async () => {
    if (!rating) { setError(paper ? rl.ratingRequired : 'Please select a rating'); return; }
    if (!user) return;

    setSubmitting(true);
    setError(null);
    try {
      // 1. Upload photos to Firebase Storage
      const photoUrls = await uploadPhotos();

      // 2. Create review with photo URLs
      // PR #418 IDOR fix: Authorization Bearer — server uses verified auth.uid.
      const res = await authFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          targetType,
          targetId,
          rating,
          text: text.trim(),
          photos: photoUrls,
          authorName: user.displayName || 'Anonymous',
          authorPhotoURL: user.photoURL || null,
          language: (tRec as any)?._code || 'en',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => onCreated(), 2000);
      } else {
        setError(data.error === 'alreadyReviewed'
          ? (rl.alreadyReviewed || 'Already reviewed')
          : (paper ? t.reviews.errSubmit : data.error));
      }
    } catch {
      setError(paper ? t.reviews.errNetwork : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} className={paper ? 'ec-root relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-ec-md border border-ec-line bg-ec-raised p-6 shadow-ec-overlay' : 'relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#12152a] p-6 shadow-2xl'} role="dialog" aria-modal="true" aria-labelledby="review-write-title">
        {/* Close */}
        <button type="button" onClick={onClose} className={paper ? 'absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-ec-sm text-ec-ink-3 transition-colors hover:bg-ec-sunken hover:text-ec-ink' : 'absolute right-2 top-2 flex h-11 w-11 items-center justify-center text-white/55 transition-colors hover:text-white/60'} aria-label={paper ? t.a11y.close : 'Close review form'}>
          <X size={18} aria-hidden />
        </button>

        {success ? (
          <div className="text-center py-8">
            <div className={paper ? 'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ec-brand-wash' : 'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#7C5CFC]/20'}>
              <Coins className={paper ? 'h-7 w-7 text-ec-brand' : 'h-7 w-7 text-[#FFD700]'} />
            </div>
            <p className={paper ? 'text-lg font-bold text-ec-ink' : 'text-lg font-bold text-white'}>{rl.rewardToast}</p>
            {!paper && <p className="mt-2 text-sm text-white/55">Your review has been published</p>}
          </div>
        ) : (
          <>
            <h3 id="review-write-title" className={paper ? 'mb-6 text-lg font-bold text-ec-ink' : 'mb-6 text-lg font-bold text-white'}>{rl.writeButton || 'Write a review'}</h3>

            {/* Rating */}
            <div className="mb-5">
              <span className={paper ? 'mb-2 block text-xs text-ec-ink-2' : 'mb-2 block text-xs text-white/50'}>{rl.rating}</span>
              <StarRating rating={rating} onChange={setRating} size={28} />
            </div>

            {/* Text */}
            <div className="mb-4">
              <textarea
                id="review-text"
                aria-label={rl.placeholder}
                value={text}
                onChange={e => setText(e.target.value.slice(0, 500))}
                placeholder={rl.placeholder}
                rows={4}
                className={paper ? 'ec-field min-h-[112px] w-full resize-none p-3 text-base' : 'w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] p-3 text-base text-white placeholder-white/20 focus:border-[#7C5CFC]/50 focus:outline-none'}
              />
              <div className={paper ? 'mt-1 text-right text-[11px] text-ec-ink-3' : 'mt-1 text-right text-[10px] text-white/55'}>
                {rl.charLimit?.replace('{used}', String(text.length)) || `${text.length}/500`}
              </div>
            </div>

            {/* Photo Upload */}
            <div className="mb-5">
              <label className={paper ? 'mb-2 block text-xs text-ec-ink-2' : 'mb-2 block text-xs text-white/50'}>
                {paper ? rl.photoUpload : 'Photos'} ({photos.length}/{MAX_PHOTOS})
              </label>
              <div className="flex gap-2 flex-wrap">
                {photos.map((photo, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                    <img src={photo.preview} alt={paper ? rl.photoLabel.replace('{index}', String(idx + 1)) : `Preview photo ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className={paper ? 'absolute inset-0 flex min-h-[44px] min-w-[44px] items-center justify-center bg-black/45 opacity-100 transition-opacity' : 'absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'}
                      aria-label={paper ? rl.removePhoto.replace('{index}', String(idx + 1)) : `Remove photo ${idx + 1}`}
                    >
                      <Trash2 size={16} className="text-red-400" />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={paper ? 'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-ec-sm border-2 border-dashed border-ec-line-2 text-ec-ink-3 transition-colors hover:border-ec-brand hover:text-ec-brand' : 'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/15 transition-colors hover:border-[#7C5CFC]/40'}
                    aria-label={paper ? rl.photoUpload : 'Add photos'}
                  >
                    <Camera size={18} className={paper ? '' : 'text-white/55'} />
                    <span className={paper ? 'text-[10px]' : 'text-[9px] text-white/55'}>{paper ? rl.photoUpload : 'Add'}</span>
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoAdd}
                className="hidden"
              />
            </div>

            {/* Error */}
            {error && (
              <div className={paper ? 'mb-4 border-l-2 border-ec-critical bg-ec-sunken p-2 text-xs text-ec-critical' : 'mb-4 rounded-lg bg-red-400/10 p-2 text-xs text-red-400'} role="alert">{error}</div>
            )}

            {/* Reward hint */}
            <div className={paper ? 'mb-5 flex items-center gap-2 border-l-2 border-ec-notice bg-ec-sunken p-3' : 'mb-5 flex items-center gap-2 rounded-xl border border-[#FFD700]/15 bg-[#FFD700]/[0.06] p-3'}>
              <Coins className={paper ? 'h-4 w-4 text-ec-notice' : 'h-4 w-4 text-[#FFD700]'} />
              {paper ? (
                <span className="text-xs text-ec-ink-2">{t.reviews.rewardNote}</span>
              ) : (
                <span className="text-xs text-white/60">Earn <span className="font-bold text-[#FFD700]">+50 Trip Coins</span> for your review</span>
              )}
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !rating}
              className={paper
                ? `ec-btn ec-btn-primary min-h-[44px] w-full ${rating ? '' : 'cursor-not-allowed opacity-40'}`
                : `flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white transition-all ${rating ? 'bg-[#7C5CFC] hover:opacity-90' : 'cursor-not-allowed bg-white/10 opacity-40'}`}
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs">{uploadProgress || (paper ? t.reviews.submitting : 'Submitting...')}</span>
                </div>
              ) : (
                <>
                  <Send size={14} />
                  {rl.submit}
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
