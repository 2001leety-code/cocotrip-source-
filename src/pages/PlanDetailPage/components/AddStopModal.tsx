// Add Stop modal -- bottom sheet on mobile, centered on desktop.
// Collects: name, address (optional), start_time, stay_min, category.
import { useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { BRAND } from '@/lib/design-tokens';
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
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className={`relative bg-[#1a1a2e] border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md overflow-y-auto shadow-2xl transition-[max-height] duration-200 ${keyboardOpen ? 'max-h-[55vh]' : 'max-h-[85vh]'} sm:max-h-[85vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="text-white font-semibold text-base">{ed.addStop || 'Add Stop'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-white/50 text-[14px] mb-1.5">{ed.nameLabel || 'Place name'}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePh}
              onFocus={() => setKeyboardOpen(true)}
              onBlur={() => setKeyboardOpen(false)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/55 focus:outline-none focus:border-[#7C5CFC]/50 transition-colors"
              autoFocus
              required
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-white/50 text-[14px] mb-1.5">{ed.addressLabel || 'Address (optional)'}</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => setKeyboardOpen(true)}
              onBlur={() => setKeyboardOpen(false)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/55 focus:outline-none focus:border-[#7C5CFC]/50 transition-colors"
            />
          </div>

          {/* Start Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-white/50 text-[14px] mb-1.5">{ed.startTimeLabel || 'Start time'}</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                onFocus={() => setKeyboardOpen(true)}
                onBlur={() => setKeyboardOpen(false)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#7C5CFC]/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-white/50 text-[14px] mb-1.5">{ed.stayMinLabel || 'Duration (min)'}</label>
              <input
                type="number"
                value={stayMin}
                onChange={(e) => setStayMin(Number(e.target.value) || 30)}
                min={15}
                max={240}
                step={15}
                onFocus={() => setKeyboardOpen(true)}
                onBlur={() => setKeyboardOpen(false)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#7C5CFC]/50 transition-colors"
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-white/50 text-[14px] mb-1.5">{ed.categoryLabel || 'Category'}</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors min-h-[44px] ${
                    category === cat.value
                      ? 'bg-[#7C5CFC] text-white'
                      : 'bg-white/5 text-white/55 hover:bg-white/10'
                  }`}
                >
                  {cat.labelKey}
                </button>
              ))}
            </div>
          </div>

          {/* Submit — sticky bottom so keyboard doesn't hide it */}
          <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-2 bg-[#1a1a2e] border-t border-white/[0.06]">
            <button
              type="submit"
              disabled={!name.trim()}
              style={{ background: BRAND.gradient.primary }}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-30 transition-opacity"
            >
              {ed.addBtn || 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
