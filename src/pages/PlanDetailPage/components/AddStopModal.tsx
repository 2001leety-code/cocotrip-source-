// Add Stop modal -- bottom sheet on mobile, centered on desktop.
// Collects: name, address (optional), start_time, stay_min, category.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';

interface AddStopModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (stopData: {
    name: string;
    display_name: string;
    address: string;
    start_time: string;
    stay_min: number;
    category: string;
  }) => void;
}

const CATEGORIES = [
  { value: 'landmark', labelKey: 'landmark' },
  { value: 'food', labelKey: 'food' },
  { value: 'cafe', labelKey: 'cafe' },
  { value: 'shopping', labelKey: 'shopping' },
  { value: 'culture', labelKey: 'culture' },
  { value: 'activity', labelKey: 'activity' },
];

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  landmark: { ko: '명소', en: 'Landmark', ja: '名所', zh: '景点' },
  food: { ko: '음식', en: 'Food', ja: 'グルメ', zh: '美食' },
  cafe: { ko: '카페', en: 'Cafe', ja: 'カフェ', zh: '咖啡馆' },
  shopping: { ko: '쇼핑', en: 'Shopping', ja: 'ショッピング', zh: '购物' },
  culture: { ko: '문화', en: 'Culture', ja: '文化', zh: '文化' },
  activity: { ko: '체험', en: 'Activity', ja: '体験', zh: '体验' },
};

export function AddStopModal({ open, onClose, onAdd }: AddStopModalProps) {
  const { t, language } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ed = pd.editor || {};
  // 장소명 예시 placeholder 4언어 (2026-07-17 — 영어 고정 해소).
  const namePh = language === 'ko' ? '예: 경복궁' : language === 'ja' ? '例: 景福宮' : language === 'zh' ? '例: 景福宫' : 'e.g. Gyeongbokgung';

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [startTime, setStartTime] = useState('12:00');
  const [stayMin, setStayMin] = useState(60);
  const [category, setCategory] = useState('landmark');
  // Mobile keyboard detection: when an input has focus the on-screen keyboard
  // pushes ~350px up. Shrink modal max-h so the form + sticky submit stay visible.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
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
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      display_name: name.trim(),
      address: address.trim(),
      start_time: startTime,
      stay_min: stayMin,
      category,
    });
    // Reset form
    setName('');
    setAddress('');
    setStartTime('12:00');
    setStayMin(60);
    setCategory('landmark');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={onClose}
      role="presentation"
    >
      <div data-testid="plan-add-stop-scrim" className="absolute inset-0 bg-black/45" />
      <div
        ref={dialogRef}
        data-testid="plan-add-stop-modal"
        tabIndex={-1}
        className={`relative w-full overflow-y-auto rounded-t-ec-lg border border-ec-line bg-ec-raised shadow-ec-overlay transition-[max-height] duration-200 sm:max-w-md sm:rounded-ec-lg ${keyboardOpen ? 'max-h-[55vh]' : 'max-h-[85vh]'} sm:max-h-[85vh]`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-stop-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ec-line p-4">
          <h3 id="add-stop-title" className="ec-h3 text-[20px]">{ed.addStop || 'Add Stop'}</h3>
          <button type="button" onClick={onClose} className="ec-btn ec-btn-quiet min-h-[44px] min-w-[44px] px-0" aria-label={t.a11y?.close || 'Close'}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="plan-stop-name" className="mb-1.5 block text-[14px] font-semibold text-ec-ink-2">{ed.nameLabel || 'Place name'}</label>
            <input
              ref={nameInputRef}
              id="plan-stop-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePh}
              onFocus={() => setKeyboardOpen(true)}
              onBlur={() => setKeyboardOpen(false)}
              className="ec-field text-base"
              autoFocus
              required
            />
          </div>

          {/* Address */}
          <div>
            <label htmlFor="plan-stop-address" className="mb-1.5 block text-[14px] font-semibold text-ec-ink-2">{ed.addressLabel || 'Address (optional)'}</label>
            <input
              id="plan-stop-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => setKeyboardOpen(true)}
              onBlur={() => setKeyboardOpen(false)}
              className="ec-field text-base"
            />
          </div>

          {/* Start Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="plan-stop-time" className="mb-1.5 block text-[14px] font-semibold text-ec-ink-2">{ed.startTimeLabel || 'Start time'}</label>
              <input
                id="plan-stop-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                onFocus={() => setKeyboardOpen(true)}
                onBlur={() => setKeyboardOpen(false)}
                className="ec-field text-base"
              />
            </div>
            <div>
              <label htmlFor="plan-stop-duration" className="mb-1.5 block text-[14px] font-semibold text-ec-ink-2">{ed.stayMinLabel || 'Duration (min)'}</label>
              <input
                id="plan-stop-duration"
                type="number"
                value={stayMin}
                onChange={(e) => setStayMin(Number(e.target.value) || 30)}
                min={15}
                max={240}
                step={15}
                onFocus={() => setKeyboardOpen(true)}
                onBlur={() => setKeyboardOpen(false)}
                className="ec-field text-base"
              />
            </div>
          </div>

          {/* Category */}
          <fieldset>
            <legend className="mb-1.5 block text-[14px] font-semibold text-ec-ink-2">{ed.categoryLabel || 'Category'}</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors min-h-[44px] ${
                    category === cat.value
                      ? 'bg-ec-brand text-ec-on-brand'
                      : 'border border-ec-line bg-ec-raised text-ec-ink-2 hover:border-ec-line-2'
                  }`}
                  aria-pressed={category === cat.value}
                >
                  {CATEGORY_LABELS[cat.labelKey][language] || CATEGORY_LABELS[cat.labelKey].en}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Submit — sticky bottom so keyboard doesn't hide it */}
          <div className="sticky bottom-0 -mx-4 border-t border-ec-line bg-ec-raised px-4 pb-2 pt-3">
            <button
              type="submit"
              disabled={!name.trim()}
              className="ec-btn ec-btn-primary w-full min-h-[44px]"
            >
              {ed.addBtn || 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
