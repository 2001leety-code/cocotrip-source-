// Generic confirm dialog overlay. Used for delete confirmations.
// #3 fix: createPortal(document.body) — transformed ancestor 안에서
// position:fixed 가 슬라이드 기준으로 배치되는 CSS 스펙 문제 회피.
// RevisionReasonModal.tsx 와 동일한 패턴 적용.
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
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
  }, [onCancel, open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="ec-root relative w-full max-w-sm rounded-ec-md border border-ec-line bg-ec-raised p-6 shadow-ec-overlay"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="plan-delete-dialog-title"
      >
        <p id="plan-delete-dialog-title" className="mb-6 text-[15px] leading-relaxed text-ec-ink">{title}</p>
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="ec-btn ec-btn-secondary min-h-[44px] flex-1"
          >
            {ed.cancelButton || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="ec-btn min-h-[44px] flex-1 border border-ec-critical bg-ec-raised text-ec-critical hover:bg-ec-sunken"
          >
            {ed.deleteButton || 'Remove'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
