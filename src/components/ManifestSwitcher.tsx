/**
 * ManifestSwitcher — /mood 진입 시 PWA 매니페스트를 MOOD 전용으로 교체.
 *
 * /mood 에서 "홈에 추가/설치" 하면 MOOD 아이콘·이름·시작경로(/mood)로 설치되고,
 * 그 외 경로에선 기본(코코트립) 매니페스트로 복원. iOS 는 apple-touch-icon 도 교체.
 * (vite-plugin-pwa 가 주입한 <link rel="manifest"> href 를 동적 swap.)
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ManifestSwitcher() {
  const location = useLocation();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isMood = location.pathname.startsWith('/mood');

    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (link) {
      if (!link.dataset.defaultHref) link.dataset.defaultHref = link.getAttribute('href') || '/manifest.webmanifest';
      link.setAttribute('href', isMood ? '/manifest-mood.webmanifest' : link.dataset.defaultHref);
    }

    const apple = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement | null;
    if (apple) {
      if (!apple.dataset.defaultHref) apple.dataset.defaultHref = apple.getAttribute('href') || '/icons/icon-192.png';
      apple.setAttribute('href', isMood ? '/icons/mood-192.png' : apple.dataset.defaultHref);
    }
  }, [location.pathname]);

  return null;
}
