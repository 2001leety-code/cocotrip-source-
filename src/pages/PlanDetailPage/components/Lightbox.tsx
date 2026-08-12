/**
 * Photo lightbox — click a stop thumbnail to view full-size.
 *
 * Self-contained: dark backdrop, centered image, close button, Esc key,
 * focus containment, and backdrop click to dismiss.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Props {
  src: string;
  alt: string;
  closeLabel?: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, closeLabel = 'Close', onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Lock body scroll while open so swipe doesn't bleed through.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-ec-inverse/90 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-ec-sm border border-ec-line bg-ec-raised text-ec-ink transition-colors hover:bg-ec-sunken sm:right-5 sm:top-5"
        aria-label={closeLabel}
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-ec-sm object-contain shadow-ec-overlay"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
