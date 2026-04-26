/**
 * ReviewWriteModal — 리뷰 작성 모달 (별점 + 텍스트 + 사진 업로드)
 */
import { useState, useRef } from 'react';
import { X, Send, Coins, Camera, Trash2 } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { StarRating } from './StarRating';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

interface Props {
  targetType: 'plan' | 'tour';
  targetId: string;
  onClose: () => void;
  onCreated: () => void;
}

const MAX_PHOTOS = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function ReviewWriteModal({ targetType, targetId, onClose, onCreated }: Props) {
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

  const tRec = t as Record<string, unknown>;
  const rl = (tRec.reviews as Record<string, string> | undefined) || {
    rating: 'Your rating',
    placeholder: 'Share your experience...',
    submit: 'Submit review',
    rewardToast: 'Thanks! +50 Trip Coins earned',
    charLimit: '{used}/500',
  };

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - photos.length;
    const validFiles = files.slice(0, remaining).filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        setError('Photo must be under 5MB');
        return false;
      }
      if (!f.type.startsWith('image/')) {
        setError('Only images allowed');
        return false;
      }
      return true;
    });

    const newPhotos = validFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos(prev => [...prev, ...newPhotos]);
    setError(null);
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
      setUploadProgress(`Uploading ${i + 1}/${photos.length}...`);
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
    if (!rating) { setError('Please select a rating'); return; }
    if (!user) return;

    setSubmitting(true);
    setError(null);
    try {
      // 1. Upload photos to Firebase Storage
      const photoUrls = await uploadPhotos();

      // 2. Create review with photo URLs
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          userId: user.uid,
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
        setError(data.error === 'alreadyReviewed' ? (rl.alreadyReviewed || 'Already reviewed') : data.error);
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[#12152a] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 text-white/30 hover:text-white/60 transition-colors">
          <X size={18} />
        </button>

        {success ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-r from-[#FFD700]/20 to-[#7C5CFC]/20 flex items-center justify-center mb-4">
              <Coins className="w-7 h-7 text-[#FFD700]" />
            </div>
            <p className="text-white font-bold text-lg">{rl.rewardToast}</p>
            <p className="text-white/40 text-sm mt-2">Your review has been published</p>
          </div>
        ) : (
          <>
            <h3 className="text-white font-bold text-lg mb-6">{rl.writeButton || 'Write a review'}</h3>

            {/* Rating */}
            <div className="mb-5">
              <label className="text-white/50 text-xs mb-2 block">{rl.rating}</label>
              <StarRating rating={rating} onChange={setRating} size={28} />
            </div>

            {/* Text */}
            <div className="mb-4">
              <textarea
                value={text}
                onChange={e => setText(e.target.value.slice(0, 500))}
                placeholder={rl.placeholder}
                rows={4}
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl p-3 text-white text-sm placeholder-white/20 focus:border-[#7C5CFC]/50 focus:outline-none resize-none"
              />
              <div className="text-right text-white/20 text-[10px] mt-1">
                {rl.charLimit?.replace('{used}', String(text.length)) || `${text.length}/500`}
              </div>
            </div>

            {/* Photo Upload */}
            <div className="mb-5">
              <label className="text-white/50 text-xs mb-2 block">
                Photos ({photos.length}/{MAX_PHOTOS})
              </label>
              <div className="flex gap-2 flex-wrap">
                {photos.map((photo, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden group">
                    <img src={photo.preview} alt={`Preview photo ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removePhoto(idx)}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                    >
                      <Trash2 size={16} className="text-red-400" />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-20 h-20 rounded-xl border-2 border-dashed border-white/15 hover:border-[#7C5CFC]/40 flex flex-col items-center justify-center gap-1 transition-colors"
                  >
                    <Camera size={18} className="text-white/30" />
                    <span className="text-white/20 text-[9px]">Add</span>
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
              <div className="text-red-400 text-xs mb-4 p-2 rounded-lg bg-red-400/10">{error}</div>
            )}

            {/* Reward hint */}
            <div className="flex items-center gap-2 mb-5 p-3 rounded-xl bg-[#FFD700]/[0.06] border border-[#FFD700]/15">
              <Coins className="w-4 h-4 text-[#FFD700]" />
              <span className="text-white/60 text-xs">Earn <span className="text-[#FFD700] font-bold">+50 Trip Coins</span> for your review</span>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting || !rating}
              className={`w-full py-3 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                rating
                  ? 'bg-gradient-to-r from-[#7C5CFC] to-[#EA537E] hover:opacity-90'
                  : 'bg-white/10 cursor-not-allowed opacity-40'
              }`}
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                  <span className="text-xs">{uploadProgress || 'Submitting...'}</span>
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
