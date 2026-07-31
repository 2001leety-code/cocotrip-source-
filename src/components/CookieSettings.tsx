/**
 * 쿠키·분석 설정 진입점 (2026-07-30, P1-1).
 *
 * Footer 에 상시 노출되는 작은 링크. 패널 자체는 눌렀을 때만 불러온다
 * (첫 페인트 번들 예산 — `.size-limit.json` 의 entry 한도 참조).
 */
import { Suspense, lazy, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';

const CookieSettingsDialog = lazy(() => import('./CookieSettingsDialog'));

export function CookieSettings({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const cb = (t as unknown as { cookieBanner?: Record<string, string> }).cookieBanner || {};
  const label = cb.settingsLink || 'Cookie & analytics settings';

  return (
    <>
      <button
        type="button"
        data-testid="cookie-settings-trigger"
        onClick={() => setOpen(true)}
        className={className}
      >
        {label}
      </button>
      {open && (
        <Suspense fallback={null}>
          <CookieSettingsDialog labels={cb} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
