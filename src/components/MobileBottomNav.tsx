import { Link, useLocation } from 'react-router-dom';
import { Home, Package, Car, Sparkles, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

export function MobileBottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const nav = t.nav as Record<string, string | undefined>;
  // Icon size: 17px is one notch tighter than 18px while staying glanceable.
  // Label was 9px (too small per WCAG); bumped to 10px and trimmed gap to keep total height ~52px.
  const items = [
    { to: '/',        icon: <Home className="w-[17px] h-[17px]" />,     label: nav.home ?? '홈' },
    { to: '/tours',   icon: <Package className="w-[17px] h-[17px]" />,  label: nav.tours ?? '투어' },
    { to: '/charter', icon: <Car className="w-[17px] h-[17px]" />,      label: nav.charter ?? '전세차량' },
    { to: '/planner', icon: <Sparkles className="w-[17px] h-[17px]" />, label: nav.planner ?? 'AI 플래너' },
    // '로그인' 탭은 /mypage 로 (AuthRequired 가 비로그인 시 로그인 유도). 이전 /planner 는
    // AI 플래너 탭과 목적지 중복 + 라벨('로그인')↔목적지 불일치였음.
    { to: '/mypage', icon: <User className="w-[17px] h-[17px]" />, label: user ? (nav.myPage ?? '마이페이지') : (nav.login ?? '로그인') },
  ];

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-[200] md:hidden"
      style={{
        background: 'rgba(8,11,20,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex items-center justify-around h-[52px]">
        {items.map((item) => {
          const active = item.to === '/' ? location.pathname === '/' : isActive(item.to);
          return (
            <Link
              key={item.to + item.label}
              to={item.to}
              className="flex flex-col items-center justify-center gap-px flex-1 h-full transition-all"
              style={{ color: active ? '#7C5CFC' : 'rgba(255,255,255,0.35)' }}
            >
              <span style={{ color: active ? '#7C5CFC' : 'rgba(255,255,255,0.35)' }}>
                {item.icon}
              </span>
              <span className="text-[10px] font-semibold tracking-wide leading-tight">{item.label}</span>
              {active && (
                <span className="absolute bottom-0 w-7 h-[2px] rounded-full" style={{ background: '#7C5CFC' }} />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** 하단 네비 높이만큼 콘텐츠 여백 확보 — 페이지 레이아웃 맨 아래에 배치 */
export function MobileBottomSpacer() {
  return <div className="md:hidden h-[68px]" />;
}
