import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/editorial.css';
import './index.css';

const InquiryResponseDevHarness = import.meta.env.DEV
  ? lazy(() => import('./pages/InquiryResponseDevHarness'))
  : null;

const root = document.getElementById('root');
if (!root || !InquiryResponseDevHarness) {
  throw new Error('문의 응답 하네스는 로컬 DEV 서버에서만 사용할 수 있습니다.');
}

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<main className="min-h-screen bg-[#0a0b14] p-6 text-white">검증 화면을 준비하는 중입니다.</main>}>
      <InquiryResponseDevHarness />
    </Suspense>
  </StrictMode>,
);
