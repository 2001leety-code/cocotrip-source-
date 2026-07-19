import { Link, useLocation } from 'react-router-dom';
import { Home, Package, CalendarCheck, Sparkles, User, Map as MapIcon, Bot } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

// 2026-07-19 리디자인: 탭 배열 프리셋 분리 — 'standard'(현행 매출 동선 유지) ↔
// 'guide'(가이드 p.10: Plan·Map·Assistant·Bookings·Profile). 운영자가 A안 원하면
// 아래 상수만 'guide' 로 바꾸면 됨. /map·/assistant 실화면은 이미 존재(죽은 탭 아님).
const NAV_PRESET = 'standard' as 'standard' | 'guide';

export function MobileBottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');
  const isMobileAppLight = !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/mood');
  const activeColor = isMobileAppLight ? '#7653F6' : '#7C5CFC';
  const inactiveColor = isMobileAppLight ? 'rgba(21,20,61,0.42)' : 'rgba(255,255,255,0.35)';

  const nav = t.nav as Record<string, string | undefined>;
  // Icon size: 17px is one notch tighter than 18px while staying glanceable.
  // Label was 9px (too small per WCAG); bumped to 10px and trimmed gap to keep total height ~52px.
  // 2026-07-12 운영자 승인: UI/UX 가이드 내비로 교체 — 차터 탭 제거(홈 카테고리/투어에서 접근),
  // 예약(Bookings) 탭 신설. 매출 모니터링: 차터 유입 감소 시 운영자 지시로 즉시 롤백.
  const items = NAV_PRESET === 'guide'
    ? [
        { to: '/planner', icon: <Sparkles className="w-[17px] h-[17px]" />, label: nav.planner || 'Plan' },
        { to: '/map', icon: <MapIcon className="w-[17px] h-[17px]" />, label: nav.map || 'Map' },
        { to: '/assistant', icon: <Bot className="w-[17px] h-[17px]" />, label: nav.assistant || 'Assistant' },
        { to: '/my-plans', icon: <CalendarCheck className="w-[17px] h-[17px]" />, label: nav.myBookings || '예약' },
        { to: '/mypage', icon: <User className="w-[17px] h-[17px]" />, label: user ? (nav.myPage || '마이페이지') : (nav.login || '로그인') },
      ]
    : [
        { to: '/',        icon: <Home className="w-[17px] h-[17px]" />,     label: nav.home || '홈' },
        { to: '/tours',   icon: <Package className="w-[17px] h-[17px]" />,  label: nav.tours || '투어' },
        { to: '/planner', icon: <Sparkles className="w-[17px] h-[17px]" />, label: nav.planner || 'AI 플래너' },
        { to: '/my-plans', icon: <CalendarCheck className="w-[17px] h-[17px]" />, label: nav.myBookings || '예약' },
        // '로그인' 탭은 /mypage 로 (AuthRequired 가 비로그인 시 로그인 유도).
        { to: '/mypage', icon: <User className="w-[17px] h-[17px]" />, label: user ? (nav.myPage || '마이페이지') : (nav.login || '로그인') },
      ];

  return (
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-[200] md:hidden"
      style={{
        background: isMobileAppLight ? 'rgba(255,255,255,0.92)' : 'rgba(8,11,20,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: isMobileAppLight ? '1px solid rgba(124,92,255,0.12)' : '1px solid rgba(255,255,255,0.07)',
        boxShadow: isMobileAppLight ? '0 -14px 34px rgba(48,39,118,0.10)' : undefined,
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
              style={{ color: active ? activeColor : inactiveColor }}
            >
              {/* 활성 = 라벤더 필 + 퍼플 아이콘 (가이드 p.10 하단 네비 활성 상태) */}
              <span
                className="flex h-[24px] w-[40px] items-center justify-center rounded-full transition-colors"
                style={{
                  color: active ? activeColor : inactiveColor,
                  background: active
                    ? (isMobileAppLight ? 'rgba(124,92,255,0.13)' : 'rgba(124,92,255,0.22)')
                    : 'transparent',
                }}
              >
                {item.icon}
              </span>
              <span
                className="text-[10px] tracking-wide leading-tight"
                style={{ fontWeight: active ? 800 : 600 }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** 하단 네비 높이만큼 콘텐츠 여백 확보 — 페이지 레이아웃 맨 아래에 배치 */
export function MobileBottomSpacer() {
  const location = useLocation();
  if (location.pathname === '/community' || location.pathname.startsWith('/community/')) return null;
  return <div className="md:hidden h-[68px]" />;
}
