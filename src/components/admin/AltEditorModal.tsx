// AltEditorModal — TourPhoto.alt 4-lang 편집 (Phase 1, 2026-05-19)
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { I18nString, TourPhoto } from '@/data/tours';

interface Props {
  photo: TourPhoto;
  open: boolean;
  onSave: (newAlt: I18nString) => void;
  onClose: () => void;
}

const LANG_LABEL: Record<keyof I18nString, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文',
};

export function AltEditorModal({ photo, open, onSave, onClose }: Props) {
  const [alt, setAlt] = useState<I18nString>(photo.alt);

  useEffect(() => {
    setAlt(photo.alt);
  }, [photo.alt]);

  const handleSave = () => {
    onSave(alt);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">사진 설명 (Alt) — 4개 언어</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <img
            src={photo.url}
            alt="preview"
            className="w-full max-h-48 object-contain rounded-xl bg-gray-50"
          />
          {(['ko', 'en', 'ja', 'zh'] as const).map((lang) => (
            <div key={lang}>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {LANG_LABEL[lang]}
              </label>
              <input
                type="text"
                value={alt[lang] ?? ''}
                onChange={(e) => setAlt({ ...alt, [lang]: e.target.value })}
                placeholder={`Alt text (${lang})`}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC]"
              />
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#7C5CFC] hover:bg-[#6b4ce0]"
          >
            저장
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
