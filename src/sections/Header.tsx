import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Menu, X, MessageCircle, Globe, ChevronDown, ChevronRight, User, FileText, Headphones, Map, Package, LogOut, LogIn, Check, Search, ShieldCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Language, Translations } from '@/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { auth, signInWithGoogle } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { LoyaltyBadge } from '@/components/LoyaltyBadge';
import { WishlistPanel } from '@/components/WishlistButton';
import { PwaInstallButton } from '@/components/PwaInstallButton';
import { useCommandPalette } from '@/components/CommandPalette';

// P317 (2026-05-30): lazy-load phone sign-in modal. Header is in the eager main
// bundle; deferring the firebase phone-auth modal until the user opens it keeps
// that code out of the main chunk (size-limit 환원). Rendered behind a guard so
// the chunk only loads on demand.
const PhoneSignInModal = lazy(() =>
  import('@/components/PhoneSignInModal').then((m) => ({ default: m.PhoneSignInModal })),
);

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

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL ?? '').trim().toLowerCase();

export function Header({ language, t, onLanguageChange }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const isAdmin = !!(user?.email && ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL);
  const location = useLocation();
  const navigate = useNavigate();
  const { toggle: toggleCommandPalette } = useCommandPalette();
  const [langToast, setLangToast] = useState<string | null>(null);
  const langToastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // P315: desktop login entry. signInWithGoogle (firebase.js) handles the popup +
  // in-app-browser redirect fallback internally — same flow the mobile /mypage
  // (AuthRequired) login uses. Phone modal is the secondary option for parity.
  const [signingIn, setSigningIn] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      console.warn('[Header] Google sign-in failed:', e instanceof Error ? e.message : e);
    } finally {
      setSigningIn(false);
    }
  };

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
        <div className="flex items-center h-14 md:h-16 lg:h-[68px]">

          {/* ═══ Left: Logo ═══ */}
          <Link to="/" className="flex items-center gap-2 md:gap-2.5 shrink-0">
            <div
              className="w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
                boxShadow: '0 2px 12px rgba(124,92,252,0.3)',
              }}
            >
              <span className="text-white font-black text-[9px] md:text-[10px] tracking-wider">COCO</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-[15px] md:text-[17px] leading-none tracking-tight text-white">
                  COCOTRIP
                </span>
                {/* Beta badge — 상용화 전 사용자 기대치 조절 (PMF 검증 단계 포지셔닝).
                    런칭 후 안정화 + 매출 검증되면 제거. */}
                <span
                  className="text-[8px] md:text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded text-white"
                  style={{
                    background: 'linear-gradient(135deg, #B668FC, #FF6B9D)',
                    boxShadow: '0 1px 4px rgba(182,104,252,0.4)',
                    lineHeight: '1',
                  }}
                  title="베타 서비스 — 환영 의견 + 개선 진행 중"
                >
                  BETA
                </span>
              </div>
              {/* Subtitle decorative — hide on mobile for vertical density */}
              <span className="hidden md:block text-[9px] font-semibold tracking-[0.2em] text-[#7C5CFC]/80 leading-none mt-0.5">
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

            {/* Global Search (Cmd/Ctrl+K) */}
            <button
              onClick={toggleCommandPalette}
              className="flex items-center gap-2 px-2 py-1.5 md:px-2.5 rounded-lg transition-all duration-200 text-white/50 hover:text-white hover:bg-white/[0.06]"
              title={`${t.commandPalette?.triggerLabel ?? 'Search'}  ⌘K`}
              aria-label={t.commandPalette?.triggerLabel ?? 'Search'}
            >
              <Search className="w-4 h-4 md:w-[18px] md:h-[18px]" />
              {!isMobile && (
                <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-white/55">
                  ⌘K
                </kbd>
              )}
            </button>

            {/* Loyalty Badge (desktop, logged-in) */}
            {user && !isMobile && <LoyaltyBadge />}

            {/* Wishlist (desktop + mobile) — both surfaces now exposed
                so mobile users have a parity entry point. The panel itself
                handles its own slide-in animation + outside-click dismiss. */}
            <WishlistPanel />

            {/* Admin Home (desktop, admin only) */}
            {isAdmin && !isMobile && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 text-amber-400/80 hover:text-amber-300 hover:bg-amber-400/[0.08]"
                title={t.nav.adminHome ?? 'Admin Home'}
              >
                <ShieldCheck className="w-[16px] h-[16px]" />
                <span className="text-[12px] font-semibold hidden xl:inline">{t.nav.adminHome ?? 'Admin Home'}</span>
              </Link>
            )}

            {/* MyPage + Logout (desktop, logged-in) — 드롭다운 (2026-06-05: 데스크탑 로그아웃 추가.
                기존엔 로그아웃이 모바일 햄버거 메뉴에만 있어 데스크탑 웹 사용자는 로그아웃 불가였음) */}
            {user && !isMobile && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-2 rounded-lg transition-all duration-200 text-white/55 hover:text-white hover:bg-white/[0.06] outline-none"
                    title={t.nav.myPage ?? 'My Page'}
                  >
                    <User className="w-[18px] h-[18px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="w-40 rounded-xl border-white/[0.08] bg-[#0f1220]/95 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] p-1.5"
                >
                  <DropdownMenuItem
                    onClick={() => navigate('/mypage')}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all focus:bg-white/[0.04] text-white/70"
                  >
                    <User className="w-4 h-4" />
                    <span>{t.nav.myPage ?? 'My Page'}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      await signOut(auth);
                      navigate('/');
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all focus:bg-red-500/10"
                    style={{ color: 'rgba(255,100,100,0.85)' }}
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t.nav.signOut ?? 'Sign Out'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Divider */}
            {!isMobile && (
              <div className="w-px h-5 mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
            )}

            {/* Language Selector — Radix DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 md:gap-1.5 px-2 py-1.5 md:px-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-white/50 hover:text-white/80 hover:bg-white/[0.06] outline-none"
                >
                  <Globe className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="text-[12px] md:text-[13px]">
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

            {/* P315: Desktop Sign In (logged-out only — logged-in users see the
                MyPage avatar above). The hamburger menu is mobile-only, so before
                this fix desktop guests had no visible login entry and could reach
                the paid planner unauthenticated → verifyUserToken 401 after paying. */}
            {!isMobile && !user && (
              <div className="hidden lg:flex items-center gap-1.5">
                <button
                  onClick={handleSignIn}
                  disabled={signingIn}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 2px 12px rgba(124,92,252,0.3)' }}
                  title={t.nav.signIn ?? 'Sign In'}
                >
                  {signingIn ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  <span>{t.nav.signIn ?? 'Sign In'}</span>
                </button>
                {/* Phone sign-in fallback (no Google account) — mirrors AuthRequired options. */}
                <button
                  onClick={() => setPhoneModalOpen(true)}
                  className="p-2 rounded-lg transition-all duration-200 text-white/55 hover:text-white hover:bg-white/[0.06]"
                  title={t.nav.phoneSignIn ?? 'Sign in with phone'}
                  aria-label={t.nav.phoneSignIn ?? 'Sign in with phone'}
                >
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z" />
                  </svg>
                </button>
              </div>
            )}

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
                className="p-1.5 rounded-lg transition-all duration-200 text-white/60 hover:text-white hover:bg-white/[0.06]"
              >
                {isMobileMenuOpen
                  ? <X className="w-[18px] h-[18px]" />
                  : <Menu className="w-[18px] h-[18px]" />
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
          className="fixed inset-0 z-[9998] pt-14 md:pt-[68px] overflow-y-auto"
          style={{
            background: 'rgba(8,11,20,0.98)',
            backdropFilter: 'blur(24px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <div className="px-5 py-5 pb-28">

            {/* ── User Profile Card ── */}
            {user ? (
              <div className="rounded-2xl p-3.5 mb-5" style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.12), rgba(234,83,126,0.08))', border: '1px solid rgba(124,92,252,0.15)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg,#7C5CFC,#EA537E)' }}>
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-white truncate">{user.displayName || 'Traveler'}</p>
                    <p className="text-[11px] text-white/55 truncate">{user.email}</p>
                  </div>
                  <LoyaltyBadge />
                </div>
              </div>
            ) : (
              <Link
                to="/mypage"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-2xl p-3.5 mb-5 transition-all"
                style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.15), rgba(234,83,126,0.1))', border: '1px solid rgba(124,92,252,0.2)' }}
              >
                {/* 2026-05-05: 기존 to="/planner" 가 wizard 시작 페이지로 이동시켜
                    사용자가 sign-in 의도로 클릭해도 결제 step 에서 401 까지 가야
                    sign-in modal 봄. /mypage 는 AuthRequired 로 보호된 라우트 →
                    sign-in 안 된 사용자에게 즉시 Google/Apple sign-in modal 노출.
                    회원가입 (첫 sign-in) 시 PR #253 onboarding-coupons 5% × 2 자동 발급. */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-white/[0.06]">
                  <LogIn className="w-[18px] h-[18px] text-[#7C5CFC]" />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-white">{t.nav.signIn ?? 'Sign In'}</p>
                  <p className="text-[11px] text-white/55">{t.nav.signInSub ?? 'Login to manage your trips'}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/55 ml-auto" />
              </Link>
            )}

            {/* ── Main Navigation ── */}
            <p className="text-[10px] uppercase tracking-[3px] text-white/55 font-semibold mb-2.5">
              {t.nav.navigation ?? 'Navigation'}
            </p>
            <nav className="space-y-0.5">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3 px-3 rounded-xl transition-all"
                  style={{
                    color: isActive(item.to) ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: isActive(item.to) ? 'rgba(124,92,252,0.1)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    {item.to === '/charter' && <Map className="w-[18px] h-[18px]" />}
                    {item.to === '/tours' && <Package className="w-[18px] h-[18px]" />}
                    {item.to === '/planner' && <FileText className="w-[18px] h-[18px]" />}
                    {item.to === '/about' && <Globe className="w-[18px] h-[18px]" />}
                    <span className="text-[15px] font-semibold">{item.label}</span>
                  </div>
                  {isActive(item.to) && (
                    <span className="w-2 h-2 rounded-full bg-[#7C5CFC]" />
                  )}
                </Link>
              ))}
            </nav>

            {/* ── My Account ── */}
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[3px] text-white/55 font-semibold mb-3">
                {t.nav.myAccount ?? 'My Account'}
              </p>
              <div className="space-y-0.5">
                <Link
                  to="/mypage"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3 px-3 rounded-xl transition-all"
                  style={{
                    color: isActive('/mypage') ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: isActive('/mypage') ? 'rgba(124,92,252,0.1)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <User className="w-[18px] h-[18px]" />
                    <span className="text-[15px] font-semibold">{t.nav.myPage ?? 'My Page'}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/15" />
                </Link>
                <Link
                  to="/my-plans"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3 px-3 rounded-xl transition-all"
                  style={{
                    color: isActive('/my-plans') ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: isActive('/my-plans') ? 'rgba(124,92,252,0.1)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-[18px] h-[18px]" />
                    <span className="text-[15px] font-semibold">{t.nav.myPlans ?? 'My Plans'}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/15" />
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center justify-between py-3 px-3 rounded-xl transition-all"
                    style={{
                      color: isActive('/admin') ? '#fbbf24' : 'rgba(251,191,36,0.85)',
                      background: isActive('/admin') ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.05)',
                      border: '1px solid rgba(251,191,36,0.18)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="w-[18px] h-[18px]" />
                      <span className="text-[15px] font-semibold">{t.nav.adminHome ?? 'Admin Home'}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-amber-400/40" />
                  </Link>
                )}
                {/* 위시리스트/예약내역/쿠폰/리뷰/포인트 deep link는 마이페이지 본체의
                    카테고리 nav에서 처리. 역할 분리: 햄버거 = 사이트 nav, 마이페이지 = 개인 영역. */}
              </div>
            </div>

            {/* ── Settings ── */}
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[3px] text-white/55 font-semibold mb-3">
                {t.nav.settings ?? 'Settings'}
              </p>
              <div className="space-y-0.5">
                {/* Language Selector inline */}
                <div className="py-3 px-3 rounded-xl">
                  <div className="flex items-center gap-3 mb-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    <Globe className="w-[18px] h-[18px]" />
                    <span className="text-[15px] font-semibold">{t.nav.language ?? 'Language'}</span>
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
              <p className="text-[10px] uppercase tracking-[3px] text-white/55 font-semibold mb-3">
                {t.nav.support ?? 'Support'}
              </p>
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 py-3 px-3 rounded-xl transition-all"
                style={{ color: 'rgba(255,255,255,0.55)' }}
              >
                <Headphones className="w-[18px] h-[18px]" />
                <span className="text-[15px] font-semibold">{t.nav.liveSupport ?? '1:1 Support'}</span>
                <span className="ml-auto text-[11px] text-emerald-400 font-bold">24/7</span>
              </a>
              <a
                href="mailto:help@cocotripkr.com"
                className="flex items-center gap-3 py-3 px-3 rounded-xl transition-all"
                style={{ color: 'rgba(255,255,255,0.55)' }}
              >
                <MessageCircle className="w-[18px] h-[18px]" />
                <span className="text-[15px] font-semibold">{t.nav.emailSupport ?? 'Email Support'}</span>
              </a>
            </div>

            {/* ── Logout ── */}
            {user && (
              <div className="mt-6">
                <button
                  onClick={async () => {
                    await signOut(auth);
                    setIsMobileMenuOpen(false);
                    // PR-E: SPA 라우팅 — full-page reload 회피 (이전: window.location.href = '/')
                    navigate('/');
                  }}
                  className="w-full flex items-center gap-3 py-3 px-3 rounded-xl transition-all hover:bg-red-500/10"
                  style={{ color: 'rgba(255,100,100,0.7)' }}
                >
                  <LogOut className="w-[18px] h-[18px]" />
                  <span className="text-[15px] font-semibold">{t.nav.signOut ?? 'Sign Out'}</span>
                </button>
              </div>
            )}

            {/* ── Footer ── */}
            <div className="mt-8 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-center text-[11px] text-white/15">
                &copy; 2026 COCOTRIP. All rights reserved.
              </p>
              <div className="flex justify-center gap-4 mt-2">
                <Link to="/terms" onClick={() => setIsMobileMenuOpen(false)} className="text-[10px] text-white/55 hover:text-white/55">{t.nav.terms ?? 'Terms'}</Link>
                <Link to="/privacy" onClick={() => setIsMobileMenuOpen(false)} className="text-[10px] text-white/55 hover:text-white/55">{t.nav.privacy ?? 'Privacy'}</Link>
                <Link to="/travel-terms" onClick={() => setIsMobileMenuOpen(false)} className="text-[10px] text-white/55 hover:text-white/55">{t.nav.travelTerms ?? 'Travel Terms'}</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* P315: Phone sign-in modal (desktop login fallback). signInWithGoogle
          handles Google; this covers users without a Google account. */}
      {phoneModalOpen && (
        <Suspense fallback={null}>
          <PhoneSignInModal
            language={(['ko', 'en', 'ja', 'zh'] as const).includes(language as 'ko' | 'en' | 'ja' | 'zh') ? (language as 'ko' | 'en' | 'ja' | 'zh') : 'en'}
            onClose={() => setPhoneModalOpen(false)}
            onSuccess={() => setPhoneModalOpen(false)}
          />
        </Suspense>
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
