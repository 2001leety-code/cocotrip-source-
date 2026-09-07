import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/editorial.css';
import './index.css';

const Harness = import.meta.env.DEV ? lazy(() => import('./pages/OwnerNotificationDevHarness')) : null;
const root = document.getElementById('root');
if (!root || !Harness) throw new Error('Owner notification harness is DEV-only.');

// Simulate display mode only on this isolated DEV entry. No production adapter is imported.
const standalone = new URLSearchParams(window.location.search).get('standalone') === '1';
const originalMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (query) => {
  const result = originalMatchMedia(query);
  if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: standalone });
  return result;
};
sessionStorage.setItem('pwa_launch_path', '/admin/ai-center');
createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<main className="p-6 text-white">검증 화면 준비 중</main>}><Harness /></Suspense>
  </StrictMode>,
);
