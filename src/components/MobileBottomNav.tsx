import { Link, useLocation } from 'react-router-dom';
import { Home, Package, CalendarCheck, Sparkles, User, Map as MapIcon, Bot } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

// 2026-07-19 리디자인: 탭 배열 프리셋 — 'six'(홈·투어·AI Plan·Map·예약·마이, 운영자
// 결정 2026-07-19) / 'standard'(구 5탭) / 'guide'(가이드 p.10: Plan·Map·Assistant·
// Bookings·Profile). /map·/assistant 실화면 존재(죽은 탭 아님). 6탭은 라벨 짧은
// nav.*Short 세트 사용(390px 폭에서 잘림 방지 — 실측 검증됨).
const NAV_PRESET = 'six' as 'six' | 'standard' | 'guide';

export function MobileBottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const nav = t.nav as Record<string, string | undefined>;
  const six = NAV_PRESET === 'six';
  // Icon size: 17px is one notch tighter than 18px while staying glanceable.
  // Label was 9px (too small per WCAG); bumped to 10px and trimmed gap to keep total height ~52px.
  // 2026-07-12 운영자 승인: UI/UX 가이드 내비로 교체 — 차터 탭 제거(홈 카테고리/투어에서 접근),
  // 예약(Bookings) 탭 신설. 매출 모니터링: 차터 유입 감소 시 운영자 지시로 즉시 롤백.
  const items = NAV_PRESET === 'guide'
    ? [
        { to: '/planner', icon: <Sparkles className="w-[17px] h-[17px]" />, label: nav.planner || 'Plan' },
        { to: '/map', icon: <MapIcon className="w-[17px] h-[17px]" />, label: nav.mapShort || 'Map' },
        { to: '/assistant', icon: <Bot className="w-[17px] h-[17px]" />, label: nav.assistantShort || 'Assistant' },
        { to: '/my-plans', icon: <CalendarCheck className="w-[17px] h-[17px]" />, label: nav.myBookings || '예약 내역' },
        { to: '/mypage', icon: <User className="w-[17px] h-[17px]" />, label: user ? (nav.myPage || '마이페이지') : (nav.login || '로그인') },
      ]
    : six
    ? [
        // 6탭 — 라벨은 짧은 세트(65px 폭). AI Plan·예약·마이 축약.
        { to: '/',        icon: <Home className="w-[17px] h-[17px]" />,        label: nav.home || '홈' },
        { to: '/tours',   icon: <Package className="w-[17px] h-[17px]" />,     label: nav.tours || '투어' },
        { to: '/planner', icon: <Sparkles className="w-[17px] h-[17px]" />,    label: nav.planShort || 'Plan' },
        { to: '/map',     icon: <MapIcon className="w-[17px] h-[17px]" />,     label: nav.mapShort || 'Map' },
        { to: '/my-plans', icon: <CalendarCheck className="w-[17px] h-[17px]" />, label: nav.bookShort || '예약' },
        { to: '/mypage',  icon: <User className="w-[17px] h-[17px]" />,        label: user ? (nav.meShort || '마이') : (nav.login || '로그인') },
      ]
    : [
        { to: '/',        icon: <Home className="w-[17px] h-[17px]" />,     label: nav.home || '홈' },
        { to: '/tours',   icon: <Package className="w-[17px] h-[17px]" />,  label: nav.tours || '투어' },
        { to: '/planner', icon: <Sparkles className="w-[17px] h-[17px]" />, label: nav.planner || '여행 플래너' },
        { to: '/my-plans', icon: <CalendarCheck className="w-[17px] h-[17px]" />, label: nav.myBookings || '예약 내역' },
        // '로그인' 탭은 /mypage 로 (AuthRequired 가 비로그인 시 로그인 유도).
        { to: '/mypage', icon: <User className="w-[17px] h-[17px]" />, label: user ? (nav.myPage || '마이페이지') : (nav.login || '로그인') },
      ];

  // Korea Editorial Concierge (2026-08-10): one paper surface, no dark/light
  // fork. Active state = a 2px rule at the top of the tab plus ink weight —
  // the same "rule, not pill" language the desktop nav uses.
  return (
    <nav
      className="ec-root ec-no-print mobile-bottom-nav fixed bottom-0 left-0 right-0 z-[200] md:hidden border-t border-ec-line"
      style={{
        background: 'var(--ec-surface-shell-solid)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
      aria-label={nav.navigation || 'Navigation'}
    >
      <div className="flex items-stretch justify-around h-[56px]">
        {items.map((item) => {
          const active = item.to === '/' ? location.pathname === '/' : isActive(item.to);
          return (
            <Link
              key={item.to + item.label}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 flex-1 min-w-0 transition-colors duration-ec-base ease-ec-standard ${
                active ? 'text-ec-brand' : 'text-ec-ink-3'
              }`}
            >
              {active && <span aria-hidden className="absolute top-0 left-3 right-3 h-[2px] bg-ec-brand" />}
              {item.icon}
              <span className={`text-[10px] leading-tight truncate max-w-full px-0.5 ${active ? 'font-bold' : 'font-medium'}`}>
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
  if (location.pathname.startsWith('/admin') || location.pathname === '/community' || location.pathname.startsWith('/community/')) return null;
  return <div className="md:hidden h-[72px]" />;
}
