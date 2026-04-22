import { useState, useEffect, useRef } from 'react';
import { Menu, X, MessageCircle, Globe, ChevronDown, ChevronRight, User, FileText, Ticket, Headphones, Map, Package, Heart, History, LogOut, LogIn, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Link, useLocation } from 'react-router-dom';
import type { Language, Translations } from '@/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { LoyaltyBadge } from '@/components/LoyaltyBadge';
import { WishlistPanel } from '@/components/WishlistButton';
import { PwaInstallButton } from '@/components/PwaInstallButton';

interface HeaderProps {
  language: Language;
  t: Translations;
  onLanguageChange: (lang: Language) => void;
}

const languages = [
  { code: 'ko', label: '한국어', short: 'KO' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ja', label: '日本語', short: 'JA' },
  { code: 'zh', label: '中文', short: 'ZH' },
];

export function Header({ language, t, onLanguageChange }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const location = useLocation();
  const [langToast, setLangToast] = useState<string | null>(null);
  const langToastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleLangChange = (code: Language) => {
    onLanguageChange(code);
    const label = languages.find(l => l.code === code)?.label || code;
    setLangToast(label);
    if (langToastTimer.current) clearTimeout(langToastTimer.current);
    langToastTimer.current = setTimeout(() => setLangToast(null), 2000);
  };

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);



  // Lock body scroll when mobile menu open (iOS 호환) + signal other components
  useEffect(() => {
    if (isMobileMenuOpen) {
      const scrollY = window.scrollY;
      document.documentElement.dataset.menuOpen = 'true';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    } else {
      const scrollY = document.body.style.top;
      delete document.documentElement.dataset.menuOpen;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY) window.scrollTo(0, parseInt(scrollY || '0') * -1);
    }
    return () => {
      delete document.documentElement.dataset.menuOpen;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
    };
  }, [isMobileMenuOpen]);

  const navItems = [
    { label: t.nav.charter  ?? 'Charter',     to: '/charter' },
    { label: t.nav.tours   ?? 'Tours',          to: '/tours'   },
    { label: t.nav.planner  ?? 'AI Planner',  to: '/planner' },
    { label: t.nav.about    ?? 'About',        to: '/about'   },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
    <header
      className={`sticky top-0 transition-all duration-300 ${isMobileMenuOpen ? 'z-[9999]' : 'z-[100]'}`}
      style={{
        background: isScrolled
          ? 'rgba(8,11,20,0.92)'
          : 'rgba(8,11,20,0.65)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 lg:h-[68px]">

          {/* ═══ Left: Logo ═══ */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
                boxShadow: '0 2px 12px rgba(124,92,252,0.3)',
              }}
            >
              <span className="text-white font-black text-[10px] tracking-wider">COCO</span>
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-[17px] leading-none tracking-tight text-white">
                COCOTRIP
              </span>
              <span className="text-[9px] font-semibold tracking-[0.2em] text-[#7C5CFC]/80 leading-none mt-0.5">
                KOREA PRIVATE TOUR
              </span>
            </div>
          </Link>

          {/* ═══ PWA Install (mobile only) ═══ */}
          {isMobile && <PwaInstallButton t={t} />}

          {/* ═══ Center: Desktop Navigation ═══ */}
          {!isMobile && (
            <nav className="hidden lg:flex items-center gap-1 mx-auto">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="relative px-5 py-2 rounded-lg text-[15px] font-medium tracking-wide transition-all duration-200 group"
                  style={{
                    color: isActive(item.to) ? '#fff' : 'rgba(255,255,255,0.5)',
                  }}
                  onMouseEnter={e => {
                    if (!isActive(item.to)) e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                  }}
                  onMouseLeave={e => {
                    if (!isActive(item.to)) e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
                  }}
                >
                  {item.label}
                  {/* Active indicator */}
                  {isActive(item.to) && (
                    <span
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-[2px] rounded-full"
                      style={{ background: '#7C5CFC' }}
                    />
                  )}
                </Link>
              ))}
            </nav>
          )}

          {/* ═══ Right: Utilities ═══ */}
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto lg:ml-0 shrink-0">

            {/* Loyalty Badge (desktop, logged-in) */}
            {user && !isMobile && <LoyaltyBadge />}

            {/* Wishlist (desktop) */}
            {!isMobile && <WishlistPanel />}

            {/* MyPage (desktop, logged-in) */}
            {user && !isMobile && (
              <Link
                to="/mypage"
                className="p-2 rounded-lg transition-all duration-200 text-white/40 hover:text-white hover:bg-white/[0.06]"
                title="My Page"
              >
                <User className="w-[18px] h-[18px]" />
              </Link>
            )}

            {/* Divider */}
            {!isMobile && (
              <div className="w-px h-5 mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
            )}

            {/* Language Selector — Radix DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 text-white/50 hover:text-white/80 hover:bg-white/[0.06] outline-none"
                >
                  <Globe className="w-4 h-4" />
                  <span className="text-[13px]">
                    {languages.find((l) => l.code === language)?.short ?? 'EN'}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="w-36 rounded-xl border-white/[0.08] bg-[#0f1220]/95 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-1.5"
              >
                {languages.map((lang) => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={() => handleLangChange(lang.code as Language)}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all focus:bg-white/[0.04]"
                    style={{ color: language === lang.code ? '#7C5CFC' : 'rgba(255,255,255,0.5)' }}
                  >
                    <span>{lang.label}</span>
                    {language === lang.code && (
                      <Check className="w-3.5 h-3.5 text-[#7C5CFC]" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* CTA: 1:1 Inquiry (desktop) */}
            {!isMobile && (
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300 hover:scale-[1.02]"
                style={{
                  background: 'rgba(124,92,252,0.12)',
                  border: '1px solid rgba(124,92,252,0.25)',
                  color: '#B9A4FF',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(124,92,252,0.2)';
                  e.currentTarget.style.borderColor = 'rgba(124,92,252,0.4)';
                  e.currentTarget.style.boxShadow = '0 4px 20px rgba(124,92,252,0.15)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(124,92,252,0.12)';
                  e.currentTarget.style.borderColor = 'rgba(124,92,252,0.25)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <MessageCircle className="w-4 h-4" />
                <span>{t.nav.inquiry ?? '1:1 Inquiry'}</span>
              </a>
            )}

            {/* Mobile hamburger */}
            {isMobile && (
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-lg transition-all duration-200 text-white/60 hover:text-white hover:bg-white/[0.06]"
              >
                {isMobileMenuOpen
                  ? <X className="w-5 h-5" />
                  : <Menu className="w-5 h-5" />
                }
              </button>
            )}
          </div>
        </div>
      </div>
    </header>

      {/* ═══ Mobile Full-screen Menu ═══ */}
      {isMobile && isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-[9998] pt-[68px] overflow-y-auto"
          style={{
            background: 'rgba(8,11,20,0.98)',
            backdropFilter: 'blur(24px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <div className="px-6 py-6 pb-32">

            {/* ── User Profile Card ── */}
            {user ? (
              <div className="rounded-2xl p-4 mb-6" style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.12), rgba(234,83,126,0.08))', border: '1px solid rgba(124,92,252,0.15)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{user.displayName || 'Traveler'}</p>
                    <p className="text-[11px] text-white/40 truncate">{user.email}</p>
                  </div>
                  <LoyaltyBadge />
                </div>
              </div>
            ) : (
              <Link
                to="/planner"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-2xl p-4 mb-6 transition-all"
                style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.15), rgba(234,83,126,0.1))', border: '1px solid rgba(124,92,252,0.2)' }}
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-white/[0.06]">
                  <LogIn className="w-5 h-5 text-[#7C5CFC]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{t.nav.signIn ?? 'Sign In'}</p>
                  <p className="text-[11px] text-white/40">{t.nav.signInSub ?? 'Login to manage your trips'}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20 ml-auto" />
              </Link>
            )}

            {/* ── Main Navigation ── */}
            <p className="text-[10px] uppercase tracking-[3px] text-white/25 font-semibold mb-3">
              {t.nav.navigation ?? 'Navigation'}
            </p>
            <nav className="space-y-0.5">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3.5 px-3 rounded-xl transition-all"
                  style={{
                    color: isActive(item.to) ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: isActive(item.to) ? 'rgba(124,92,252,0.1)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    {item.to === '/charter' && <Map className="w-5 h-5" />}
                    {item.to === '/tours' && <Package className="w-5 h-5" />}
                    {item.to === '/planner' && <FileText className="w-5 h-5" />}
                    {item.to === '/about' && <Globe className="w-5 h-5" />}
                    <span className="text-[16px] font-semibold">{item.label}</span>
                  </div>
                  {isActive(item.to) && (
                    <span className="w-2 h-2 rounded-full bg-[#7C5CFC]" />
                  )}
                </Link>
              ))}
            </nav>

            {/* ── My Account ── */}
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[3px] text-white/25 font-semibold mb-3">
                {t.nav.myAccount ?? 'My Account'}
              </p>
              <div className="space-y-0.5">
                <Link
                  to="/mypage"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3.5 px-3 rounded-xl transition-all"
                  style={{
                    color: isActive('/mypage') ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: isActive('/mypage') ? 'rgba(124,92,252,0.1)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5" />
                    <span className="text-[16px] font-semibold">{t.nav.myPage ?? 'My Page'}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/15" />
                </Link>
                <Link
                  to="/my-plans"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3.5 px-3 rounded-xl transition-all"
                  style={{
                    color: isActive('/my-plans') ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: isActive('/my-plans') ? 'rgba(124,92,252,0.1)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5" />
                    <span className="text-[16px] font-semibold">{t.nav.myPlans ?? 'My Plans'}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/15" />
                </Link>
                <div
                  className="flex items-center justify-between py-3.5 px-3 rounded-xl"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  <div className="flex items-center gap-3">
                    <Heart className="w-5 h-5" />
                    <span className="text-[16px] font-semibold">{t.nav.wishlist ?? 'Wishlist'}</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300 font-bold">{t.nav.comingSoon ?? 'Coming Soon'}</span>
                </div>
                <div
                  className="flex items-center justify-between py-3.5 px-3 rounded-xl"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  <div className="flex items-center gap-3">
                    <History className="w-5 h-5" />
                    <span className="text-[16px] font-semibold">{t.nav.bookingHistory ?? 'Booking History'}</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#7C5CFC]/15 text-[#B9A4FF] font-bold">{t.nav.comingSoon ?? 'Coming Soon'}</span>
                </div>
                <div
                  className="flex items-center justify-between py-3.5 px-3 rounded-xl"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  <div className="flex items-center gap-3">
                    <Ticket className="w-5 h-5" />
                    <span className="text-[16px] font-semibold">{t.nav.coupons ?? 'Coupons'}</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#7C5CFC]/15 text-[#B9A4FF] font-bold">{t.nav.comingSoon ?? 'Coming Soon'}</span>
                </div>
              </div>
            </div>

            {/* ── Settings ── */}
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[3px] text-white/25 font-semibold mb-3">
                {t.nav.settings ?? 'Settings'}
              </p>
              <div className="space-y-0.5">
                {/* Language Selector inline */}
                <div className="py-3.5 px-3 rounded-xl">
                  <div className="flex items-center gap-3 mb-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    <Globe className="w-5 h-5" />
                    <span className="text-[16px] font-semibold">{t.nav.language ?? 'Language'}</span>
                  </div>
                  <div className="flex gap-2 ml-8">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => { handleLangChange(lang.code as Language); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                        style={{
                          background: language === lang.code ? 'rgba(124,92,252,0.2)' : 'rgba(255,255,255,0.04)',
                          color: language === lang.code ? '#7C5CFC' : 'rgba(255,255,255,0.4)',
                          border: language === lang.code ? '1px solid rgba(124,92,252,0.3)' : '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        {lang.short}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Support ── */}
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[3px] text-white/25 font-semibold mb-3">
                {t.nav.support ?? 'Support'}
              </p>
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 py-3.5 px-3 rounded-xl transition-all"
                style={{ color: 'rgba(255,255,255,0.55)' }}
              >
                <Headphones className="w-5 h-5" />
                <span className="text-[16px] font-semibold">{t.nav.liveSupport ?? '1:1 Support'}</span>
                <span className="ml-auto text-[11px] text-emerald-400 font-bold">24/7</span>
              </a>
              <a
                href="mailto:help@cocotripkr.com"
                className="flex items-center gap-3 py-3.5 px-3 rounded-xl transition-all"
                style={{ color: 'rgba(255,255,255,0.55)' }}
              >
                <MessageCircle className="w-5 h-5" />
                <span className="text-[16px] font-semibold">{t.nav.emailSupport ?? 'Email Support'}</span>
              </a>
            </div>

            {/* ── Logout ── */}
            {user && (
              <div className="mt-6">
                <button
                  onClick={async () => {
                    await signOut(auth);
                    setIsMobileMenuOpen(false);
                    window.location.href = '/';
                  }}
                  className="w-full flex items-center gap-3 py-3.5 px-3 rounded-xl transition-all hover:bg-red-500/10"
                  style={{ color: 'rgba(255,100,100,0.7)' }}
                >
                  <LogOut className="w-5 h-5" />
                  <span className="text-[16px] font-semibold">{t.nav.signOut ?? 'Sign Out'}</span>
                </button>
              </div>
            )}

            {/* ── Footer ── */}
            <div className="mt-8 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-center text-[11px] text-white/15">
                &copy; 2026 COCOTRIP. All rights reserved.
              </p>
              <div className="flex justify-center gap-4 mt-2">
                <Link to="/terms" onClick={() => setIsMobileMenuOpen(false)} className="text-[10px] text-white/20 hover:text-white/40">{t.nav.terms ?? 'Terms'}</Link>
                <Link to="/privacy" onClick={() => setIsMobileMenuOpen(false)} className="text-[10px] text-white/20 hover:text-white/40">{t.nav.privacy ?? 'Privacy'}</Link>
                <Link to="/travel-terms" onClick={() => setIsMobileMenuOpen(false)} className="text-[10px] text-white/20 hover:text-white/40">{t.nav.travelTerms ?? 'Travel Terms'}</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Language Toast */}
      {langToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] animate-[fadeInDown_0.3s_ease-out]"
          style={{ animation: 'fadeInDown 0.3s ease-out' }}>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg"
            style={{ background: 'rgba(124,92,252,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <Globe className="w-4 h-4" />
            {langToast}
          </div>
        </div>
      )}
    </>
  );
}
