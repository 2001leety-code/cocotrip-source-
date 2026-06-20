// Generic confirm dialog overlay. Used for delete confirmations.
// #3 fix: createPortal(document.body) — framer-motion transform 조상(SwipeContainer) 안에서
// position:fixed 가 슬라이드 기준으로 배치되는 CSS 스펙 문제 회피.
// RevisionReasonModal.tsx 와 동일한 패턴 적용.
import { createPortal } from 'react-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlanDetailDict } from '../types';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const ed = pd.editor || {};

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[#1a1a2e] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-white text-sm mb-6 leading-relaxed">{title}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-white/60 text-sm font-medium hover:bg-white/10 transition-colors"
          >
            {ed.cancelButton || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500/80 text-white text-sm font-medium hover:bg-red-500 transition-colors"
          >
            {ed.deleteButton || 'Remove'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
