/**
 * BackToAdminHome — 어드민 하위 페이지 공통 "← 어드민 홈" 버튼.
 * 모든 /admin/* 하위 페이지 최상단에 추가.
 */
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';

export function BackToAdminHome() {
  const { t } = useLanguage();
  const label = (t.admin as Record<string, string>)?.backToHome ?? '어드민 홈으로';

  return (
    <Link
      to="/admin"
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50 text-sm font-medium transition-all duration-200 min-h-[44px]"
    >
      <ArrowLeft className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

export default BackToAdminHome;
