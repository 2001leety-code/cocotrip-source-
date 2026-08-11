import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Menu, X, MessageCircle, Globe, ChevronDown, ChevronRight, User, FileText, Headphones, Map, Package, LogOut, LogIn, Check, Search, ShieldCheck, Gift, Heart, Clock } from 'lucide-react';
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
import { CartPanel } from '@/components/CartButton';
import { PwaInstallButton } from '@/components/PwaInstallButton';
import { useCommandPalette } from '@/components/CommandPalette';

/**
 * Common shell header — Korea Editorial Concierge (2026-08-10).
 *
 * Visual system only; every route, handler and permission below is unchanged.
 *
 * What went away and why: the header used to render a dark glass bar and then
 * `index.css` repainted it light on mobile through `.mobile-app-light-header`
 * with `!important` on every colour. One paper surface removes both the fork
 * and the corrective cascade — there is now a single source for the shell's
 * colour (`--ec-shell-*` in src/styles/editorial.css).
 */

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

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase();

/** Paper popover shared by the language and account dropdowns. */
const POPOVER_CLS =
  'rounded-ec-md border border-ec-line bg-ec-raised shadow-ec-overlay p-1.5 text-ec-ink';
const POPOVER_ITEM_CLS =
  'flex items-center gap-2.5 px-3 py-2.5 rounded-ec-sm text-[13px] font-medium cursor-pointer text-ec-ink-2 focus:bg-ec-page focus:text-ec-ink';
/** Quiet icon button in the utility rail — 44px touch target, ink on hover. */
const ICON_BTN_CLS =
  'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-ec-sm text-ec-ink-2 transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink hover:bg-ec-page';

export function Header({ language, t, onLanguageChange }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const isAdmin = !!(user?.email && ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL);
  const location = useLocation();
  const navigate = useNavigate();
  const isPlannerLike = isMobile && (
    location.pathname === '/planner'
    || location.pathname.startsWith('/planner/')
    || location.pathname.startsWith('/my-plans/')
  );
  // Internal surfaces (admin, MOOD portal). The old code reached the same set
  // through `!isMobileAppLight`, which coupled "which shell colour" to "which
  // controls appear". The colour fork is gone; this keeps the control set
  // exactly as it shipped — search and the PWA prompt stay off the public
  // mobile chrome. Changing that is a product decision, not a design one.
  const isInternalPath = location.pathname.startsWith('/admin') || location.pathname.startsWith('/mood');
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

  // Esc closes the mobile menu — a full-screen overlay with no keyboard exit is a trap.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMobileMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileMenuOpen]);

  const navItems = [
    { label: t.nav.charter || 'Charter',     to: '/charter' },
    { label: t.nav.tours   || 'Tours',          to: '/tours'   },
    // 2026-08-10: the nav label is the neutral capability ("Trip Planner"), not
    // the implementation ("AI Planner"). The route, the product and the paid
    // gate are unchanged — this is naming only. See homeCopy.ts header comment.
    { label: t.nav.planner || 'Trip Planner',  to: '/planner' },
    { label: ({ en: 'Community', ko: '커뮤니티', ja: 'コミュニティ', zh: '社区' } as Record<Language, string>)[language], to: '/community' },
    { label: t.nav.about    || 'About',        to: '/about'   },
  ];

  const isActive = (path: string) => location.pathname === path;
  // 공유 플랜(고객 제안서, /my-plans/{id}?shared=1)에서는 앱 chrome(BETA·검색·Wishlist·Cart) 숨김 —
  //   외국인 고객에겐 의미 없는 내부 요소. 다른 페이지는 영향 0(이 경로+shared=1 일 때만 true).
  const isPublicView = location.pathname.startsWith('/my-plans/') &&
    new URLSearchParams(location.search).get('shared') === '1';

  return (
    <>
    <header
      className={`ec-root ec-no-print sticky top-0 border-b border-ec-line ${isMobileMenuOpen ? 'z-[9999]' : 'z-[100]'}`}
      style={{
        // Scrolled = opaque so body copy never bleeds through the rail.
        background: isScrolled ? 'var(--ec-surface-shell-solid)' : 'var(--ec-shell-bg)',
        backdropFilter: 'blur(var(--ec-shell-blur))',
        WebkitBackdropFilter: 'blur(var(--ec-shell-blur))',
        transition: 'background-color var(--ec-duration-base) var(--ec-ease-standard)',
      }}
    >
      <div className="ec-container-wide">
        <div className="flex items-center h-14 md:h-16 gap-2">

          {/* ═══ Left: Logo ═══ */}
          {/* The mark carries the brand gradient (logo identity). The wordmark is
              set in ink — gradient text is out of the system everywhere else. */}
          <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="CocoTrip">
            <img src="/icons/icon-192.png" alt="" aria-hidden width={32} height={32} className="h-8 w-8 rounded-ec-md" />
            <span className="text-[19px] md:text-[20px] font-bold tracking-[-0.025em] text-ec-ink">
              CocoTrip
            </span>
            {/* Beta badge — 상용화 전 기대치 조절. 공유 제안서(isPublicView)에선 숨김. */}
            {!isPublicView && (
              <span
                className="ec-eyebrow border border-ec-line-2 rounded-ec-xs px-1.5 py-1 text-ec-ink-3"
                title="Beta — feedback welcome"
              >
                BETA
              </span>
            )}
          </Link>

          {/* ═══ PWA Install (mobile, internal surfaces only — unchanged) ═══ */}
          {isMobile && isInternalPath && <PwaInstallButton t={t} />}

          {/* ═══ Center: Desktop Navigation ═══ */}
          {!isMobile && (
            <nav className="hidden lg:flex items-center gap-1 mx-auto">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isActive(item.to) ? 'page' : undefined}
                  className={`relative px-4 py-2 rounded-ec-sm text-[15px] transition-colors duration-ec-base ease-ec-standard ${
                    isActive(item.to)
                      ? 'text-ec-ink font-semibold'
                      : 'text-ec-ink-2 font-medium hover:text-ec-ink'
                  }`}
                >
                  {item.label}
                  {/* Active indicator — a rule, not a pill. */}
                  {isActive(item.to) && (
                    <span aria-hidden className="absolute left-4 right-4 -bottom-px h-[2px] bg-ec-brand" />
                  )}
                </Link>
              ))}
            </nav>
          )}

          {/* ═══ Right: Utilities ═══ */}
          <div className="flex items-center gap-0.5 sm:gap-1 ml-auto lg:ml-0 shrink-0">

            {/* Global Search (Cmd/Ctrl+K) — 공유 제안서에선 숨김 */}
            {!isPublicView && !isPlannerLike && (!isMobile || isInternalPath) && (
            <button
              onClick={toggleCommandPalette}
              className={ICON_BTN_CLS}
              title={`${t.commandPalette?.triggerLabel || 'Search'}  ⌘K`}
              aria-label={t.commandPalette?.triggerLabel || 'Search'}
            >
              <Search className="w-[18px] h-[18px]" />
            </button>
            )}

            {/* Loyalty Badge (desktop, logged-in) */}
            {user && !isMobile && <LoyaltyBadge />}

            {/* Wishlist + Cart — 공유 제안서(고객)에선 숨김 (앱 내부 요소). */}
            {!isPublicView && <WishlistPanel />}
            {!isPublicView && <CartPanel />}

            {/* Admin Home (desktop, admin only) */}
            {isAdmin && !isMobile && (
              <Link
                to="/admin"
                className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-ec-sm text-ec-notice transition-colors duration-ec-base ease-ec-standard hover:bg-ec-page"
                title={t.nav.adminHome || 'Admin Home'}
              >
                <ShieldCheck className="w-[16px] h-[16px]" />
                <span className="text-[12px] font-semibold hidden xl:inline">{t.nav.adminHome || 'Admin Home'}</span>
              </Link>
            )}

            {/* MyPage + Logout (desktop, logged-in) — 드롭다운 (2026-06-05: 데스크탑 로그아웃 추가.
                기존엔 로그아웃이 모바일 햄버거 메뉴에만 있어 데스크탑 웹 사용자는 로그아웃 불가였음) */}
            {user && !isMobile && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`${ICON_BTN_CLS} outline-none`} title={t.nav.myPage || 'My Page'}>
                    <User className="w-[18px] h-[18px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className={`w-44 ${POPOVER_CLS}`}>
                  {/* 2026-07-05: 데스크탑 드롭다운 보강 — 마이페이지 외 예약내역·내여행·쿠폰 딥링크 */}
                  {[
                    { to: '/mypage', icon: User, label: t.nav.myPage || 'My Page' },
                    { to: '/mypage?tab=bookings', icon: Package, label: t.nav.myBookings || 'My Bookings' },
                    { to: '/my-plans', icon: FileText, label: t.nav.myPlans || 'My Plans' },
                    { to: '/mypage?tab=coupons', icon: Gift, label: t.nav.myCoupons || 'Coupons' },
                  ].map(({ to, icon: Icon, label }) => (
                    <DropdownMenuItem key={to} onClick={() => navigate(to)} className={POPOVER_ITEM_CLS}>
                      <Icon className="w-4 h-4" />
                      <span>{label}</span>
                    </DropdownMenuItem>
                  ))}
                  <div className="my-1 h-px bg-ec-line" />
                  <DropdownMenuItem
                    onClick={async () => {
                      await signOut(auth);
                      navigate('/');
                    }}
                    className={`${POPOVER_ITEM_CLS} text-ec-critical focus:text-ec-critical`}
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t.nav.signOut || 'Sign Out'}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Divider */}
            {!isMobile && <div className="w-px h-5 mx-1 bg-ec-line" />}

            {/* Language Selector — Radix DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center gap-1 min-h-[44px] px-2 rounded-ec-sm text-[13px] font-medium text-ec-ink-2 transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink hover:bg-ec-page outline-none"
                  aria-label={t.nav.language || 'Language'}
                >
                  <Globe className="w-4 h-4" />
                  <span>{languages.find((l) => l.code === language)?.short || 'EN'}</span>
                  <ChevronDown className="w-3 h-3" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className={`w-36 ${POPOVER_CLS}`}>
                {languages.map((lang) => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={() => handleLangChange(lang.code as Language)}
                    className={`${POPOVER_ITEM_CLS} justify-between ${language === lang.code ? 'text-ec-brand font-semibold' : ''}`}
                  >
                    <span>{lang.label}</span>
                    {language === lang.code && <Check className="w-3.5 h-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* P315: Desktop Sign In (logged-out only — logged-in users see the
                MyPage avatar above). The hamburger menu is mobile-only, so before
                this fix desktop guests had no visible login entry and could reach
                the paid planner unauthenticated → verifyUserToken 401 after paying. */}
            {!isMobile && !user && (
              <div className="hidden lg:flex items-center gap-1">
                <button
                  onClick={handleSignIn}
                  disabled={signingIn}
                  className="ec-btn ec-btn-primary ec-btn-sm"
                  title={t.nav.signIn || 'Sign In'}
                >
                  {signingIn ? (
                    <span aria-hidden className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" aria-hidden />
                  )}
                  <span>{t.nav.signIn || 'Sign In'}</span>
                </button>
                {/* Phone sign-in fallback (no Google account) — mirrors AuthRequired options. */}
                <button
                  onClick={() => setPhoneModalOpen(true)}
                  className={ICON_BTN_CLS}
                  title={t.nav.phoneSignIn || 'Sign in with phone'}
                  aria-label={t.nav.phoneSignIn || 'Sign in with phone'}
                >
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
                className="ec-btn ec-btn-secondary ec-btn-sm hidden md:inline-flex"
              >
                <MessageCircle className="w-4 h-4" aria-hidden />
                <span>{t.nav.inquiry || '1:1 Inquiry'}</span>
              </a>
            )}

            {/* Mobile hamburger */}
            {isMobile && (
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className={ICON_BTN_CLS}
                aria-expanded={isMobileMenuOpen}
                aria-label={isMobileMenuOpen ? (t.a11y?.close || 'Close menu') : (t.nav.navigation || 'Navigation')}
              >
                {isMobileMenuOpen
                  ? <X className="w-[20px] h-[20px]" />
                  : <Menu className="w-[20px] h-[20px]" />
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
          className="ec-root fixed inset-0 z-[9998] pt-14 overflow-y-auto bg-ec-page"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <div className="px-5 py-5 pb-28">

            {/* ── User Profile Card ── */}
            {user ? (
              <div className="ec-card mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-ec-md flex items-center justify-center text-base font-bold text-ec-on-brand shrink-0 bg-ec-brand">
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-ec-ink truncate">{user.displayName || 'Traveler'}</p>
                    <p className="text-[12px] text-ec-ink-3 truncate">{user.email}</p>
                  </div>
                  <LoyaltyBadge />
                </div>
              </div>
            ) : (
              <Link
                to="/mypage"
                onClick={() => setIsMobileMenuOpen(false)}
                className="ec-card ec-card-link mb-6 flex items-center gap-3"
              >
                {/* 2026-05-05: 기존 to="/planner" 가 wizard 시작 페이지로 이동시켜
                    사용자가 sign-in 의도로 클릭해도 결제 step 에서 401 까지 가야
                    sign-in modal 봄. /mypage 는 AuthRequired 로 보호된 라우트 →
                    sign-in 안 된 사용자에게 즉시 Google/Apple sign-in modal 노출.
                    회원가입 (첫 sign-in) 시 PR #253 onboarding-coupons 5% × 2 자동 발급. */}
                <div className="w-10 h-10 rounded-ec-md flex items-center justify-center shrink-0 bg-ec-brand-wash">
                  <LogIn className="w-[18px] h-[18px] text-ec-brand" aria-hidden />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-ec-ink">{t.nav.signIn || 'Sign In'}</p>
                  <p className="text-[12px] text-ec-ink-3">{t.nav.signInSub || 'Login to manage your trips'}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-ec-ink-3 ml-auto" aria-hidden />
              </Link>
            )}

            {/* ── Main Navigation ── */}
            <p className="ec-eyebrow mb-3">{t.nav.navigation || 'Navigation'}</p>
            <hr className="ec-rule mb-1" />
            <nav>
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsMobileMenuOpen(false)}
                  aria-current={isActive(item.to) ? 'page' : undefined}
                  className={`flex items-center justify-between min-h-[52px] py-3 border-b border-ec-line ${
                    isActive(item.to) ? 'text-ec-brand' : 'text-ec-ink'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    {item.to === '/charter' && <Map className="w-[18px] h-[18px]" aria-hidden />}
                    {item.to === '/tours' && <Package className="w-[18px] h-[18px]" aria-hidden />}
                    {item.to === '/planner' && <FileText className="w-[18px] h-[18px]" aria-hidden />}
                    {item.to === '/about' && <Globe className="w-[18px] h-[18px]" aria-hidden />}
                    <span className="text-[16px] font-semibold">{item.label}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-ec-ink-3" aria-hidden />
                </Link>
              ))}
            </nav>

            {/* ── 내 여행 관리 + 혜택·저장 (2026-07-05: 실제 마이페이지 기능 바로가기.
                각 링크는 /mypage?tab= 딥링크 — 미로그인 시 AuthRequired 로 로그인 유도) ── */}
            {[
              {
                heading: t.nav.groupTrips || '내 여행 관리',
                links: [
                  { to: '/mypage', icon: User, label: t.nav.myPage || 'My Page' },
                  { to: '/my-plans', icon: FileText, label: t.nav.myPlans || 'My Plans' },
                  { to: '/mypage?tab=bookings', icon: Package, label: t.nav.myBookings || 'My Bookings' },
                  { to: '/mypage?tab=courses', icon: Map, label: t.nav.myCourses || 'My Courses' },
                ],
              },
              {
                heading: t.nav.groupRewards || '혜택·저장',
                links: [
                  { to: '/mypage?tab=coupons', icon: Gift, label: t.nav.myCoupons || 'Coupons' },
                  { to: '/mypage?tab=wishlist', icon: Heart, label: t.nav.savedTours || 'Saved Tours' },
                  { to: '/mypage?tab=history', icon: Clock, label: t.nav.myPoints || 'Points' },
                ],
              },
            ].map((group) => (
              <div className="mt-8" key={group.heading}>
                <p className="ec-eyebrow mb-3">{group.heading}</p>
                <hr className="ec-rule mb-1" />
                {group.links.map(({ to, icon: Icon, label }) => (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center justify-between min-h-[52px] py-3 border-b border-ec-line ${
                      isActive(to.split('?')[0]) ? 'text-ec-brand' : 'text-ec-ink-2'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-[18px] h-[18px]" aria-hidden />
                      <span className="text-[15px] font-medium">{label}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-ec-ink-3" aria-hidden />
                  </Link>
                ))}
              </div>
            ))}

            {/* ── 계정 (admin 진입 — 운영자만) ── */}
            {isAdmin && (
              <div className="mt-8">
                <p className="ec-eyebrow mb-3">{t.nav.groupAccount || '계정'}</p>
                <hr className="ec-rule mb-1" />
                <Link
                  to="/admin"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between min-h-[52px] py-3 border-b border-ec-line text-ec-notice"
                >
                  <span className="flex items-center gap-3">
                    <ShieldCheck className="w-[18px] h-[18px]" aria-hidden />
                    <span className="text-[15px] font-semibold">{t.nav.adminHome || 'Admin Home'}</span>
                  </span>
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
              </div>
            )}

            {/* ── Settings ── */}
            <div className="mt-8">
              <p className="ec-eyebrow mb-3">{t.nav.settings || 'Settings'}</p>
              <hr className="ec-rule mb-4" />
              <div className="flex items-center gap-3 mb-3 text-ec-ink-2">
                <Globe className="w-[18px] h-[18px]" aria-hidden />
                <span className="text-[15px] font-medium">{t.nav.language || 'Language'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { handleLangChange(lang.code as Language); }}
                    aria-pressed={language === lang.code}
                    className={`min-h-[44px] px-4 rounded-ec-sm text-[13px] font-semibold border transition-colors duration-ec-base ease-ec-standard ${
                      language === lang.code
                        ? 'bg-ec-brand text-ec-on-brand border-transparent'
                        : 'bg-ec-raised text-ec-ink-2 border-ec-line-2 hover:text-ec-ink'
                    }`}
                  >
                    {lang.short}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Support ── */}
            <div className="mt-8">
              <p className="ec-eyebrow mb-3">{t.nav.support || 'Support'}</p>
              <hr className="ec-rule mb-1" />
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 min-h-[52px] py-3 border-b border-ec-line text-ec-ink-2"
              >
                <Headphones className="w-[18px] h-[18px]" aria-hidden />
                <span className="text-[15px] font-medium">{t.nav.liveSupport || '1:1 Support'}</span>
                <span className="ml-auto text-[12px] font-semibold text-ec-success">
                  {({ en: 'Weekdays 10am–6pm', ko: '평일 10~18시', ja: '平日10~18時', zh: '工作日10-18点' } as Record<Language, string>)[language]}
                </span>
              </a>
              <a
                href="mailto:help@cocotripkr.com"
                className="flex items-center gap-3 min-h-[52px] py-3 border-b border-ec-line text-ec-ink-2"
              >
                <MessageCircle className="w-[18px] h-[18px]" aria-hidden />
                <span className="text-[15px] font-medium">{t.nav.emailSupport || 'Email Support'}</span>
              </a>
            </div>

            {/* ── Logout ── */}
            {user && (
              <div className="mt-8">
                <button
                  onClick={async () => {
                    await signOut(auth);
                    setIsMobileMenuOpen(false);
                    // PR-E: SPA 라우팅 — full-page reload 회피 (이전: window.location.href = '/')
                    navigate('/');
                  }}
                  className="w-full flex items-center gap-3 min-h-[52px] py-3 text-ec-critical"
                >
                  <LogOut className="w-[18px] h-[18px]" aria-hidden />
                  <span className="text-[15px] font-semibold">{t.nav.signOut || 'Sign Out'}</span>
                </button>
              </div>
            )}

            {/* ── Footer ── */}
            <div className="mt-10 pt-6 border-t border-ec-line">
              <p className="text-center text-[12px] text-ec-ink-3">
                &copy; 2026 COCOTRIP. All rights reserved.
              </p>
              <div className="flex justify-center gap-5 mt-3">
                <Link to="/terms" onClick={() => setIsMobileMenuOpen(false)} className="text-[12px] text-ec-ink-3 underline underline-offset-4">{t.nav.terms || 'Terms'}</Link>
                <Link to="/privacy" onClick={() => setIsMobileMenuOpen(false)} className="text-[12px] text-ec-ink-3 underline underline-offset-4">{t.nav.privacy || 'Privacy'}</Link>
                <Link to="/travel-terms" onClick={() => setIsMobileMenuOpen(false)} className="text-[12px] text-ec-ink-3 underline underline-offset-4">{t.nav.travelTerms || 'Travel Terms'}</Link>
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
        <div className="ec-root fixed top-20 left-1/2 -translate-x-1/2 z-[200]" role="status" aria-live="polite">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-ec-sm text-sm font-semibold bg-ec-inverse text-ec-page shadow-ec-overlay">
            <Globe className="w-4 h-4" aria-hidden />
            {langToast}
          </div>
        </div>
      )}
    </>
  );
}
