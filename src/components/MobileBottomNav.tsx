import { Link, useLocation } from 'react-router-dom';
import { Home, Car, Sparkles, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

export function MobileBottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isActive = (path: string) => location.pathname === path;

  const items = [
    { to: '/',        icon: <Home className="w-5 h-5" />,     label: t.nav.home ?? 'Home' },
    { to: '/charter', icon: <Car className="w-5 h-5" />,      label: t.nav.charter ?? 'Charter' },
    { to: '/planner', icon: <Sparkles className="w-5 h-5" />, label: t.nav.planner ?? 'AI Plan' },
    { to: user ? '/mypage' : '/planner', icon: <User className="w-5 h-5" />, label: user ? ((t.nav as any).myPage ?? 'My') : 'Login' },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[200] md:hidden"
      style={{
        background: 'rgba(8,11,20,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.to + item.label}
              to={item.to}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all"
              style={{ color: active ? '#7C5CFC' : 'rgba(255,255,255,0.35)' }}
            >
              <span style={{ color: active ? '#7C5CFC' : 'rgba(255,255,255,0.35)' }}>
                {item.icon}
              </span>
              <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
              {active && (
                <span className="absolute bottom-0 w-8 h-[2px] rounded-full" style={{ background: '#7C5CFC' }} />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
