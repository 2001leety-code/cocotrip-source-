import { useState, useEffect, useRef } from 'react';
import { Menu, X, MessageCircle, Globe, ChevronDown, User } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { Language } from '@/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { LoyaltyBadge } from '@/components/LoyaltyBadge';
import { WishlistPanel } from '@/components/WishlistButton';

interface HeaderProps {
  language: Language;
  t: any;
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
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const location = useLocation();
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close lang menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setIsLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isMobileMenuOpen]);

  const navItems = [
    { label: t.nav.charter  ?? 'Charter',     to: '/charter' },
    { label: t.nav.planner  ?? 'AI Planner',  to: '/planner' },
    { label: t.nav.about    ?? 'About',        to: '/about'   },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <header
      className="sticky top-0 z-[100] transition-all duration-300"
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

            {/* Language Selector */}
            <div className="relative" ref={langRef}>
              <button
                onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 text-white/50 hover:text-white/80 hover:bg-white/[0.06]"
              >
                <Globe className="w-4 h-4" />
                <span className="text-[13px]">
                  {languages.find((l) => l.code === language)?.short ?? 'EN'}
                </span>
                <ChevronDown
                  className="w-3 h-3 transition-transform duration-200"
                  style={{ transform: isLangMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>

              {isLangMenuOpen && (
                <div
                  className="absolute right-0 mt-2 w-36 rounded-xl py-1.5 z-50"
                  style={{
                    background: 'rgba(15,18,32,0.95)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                  }}
                >
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onLanguageChange(lang.code as Language);
                        setIsLangMenuOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-[13px] font-medium transition-all duration-150 flex items-center justify-between"
                      style={{
                        color: language === lang.code ? '#7C5CFC' : 'rgba(255,255,255,0.5)',
                        background: language === lang.code ? 'rgba(124,92,252,0.06)' : 'transparent',
                      }}
                      onMouseEnter={e => {
                        if (language !== lang.code) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={e => {
                        if (language !== lang.code) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span>{lang.label}</span>
                      {language === lang.code && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#7C5CFC]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

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

      {/* ═══ Mobile Full-screen Menu ═══ */}
      {isMobile && isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 pt-[68px] overflow-y-auto"
          style={{
            background: 'rgba(8,11,20,0.98)',
            backdropFilter: 'blur(24px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false);
          }}
        >
          <div className="px-6 py-8">
            {/* Navigation */}
            <nav className="space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between py-4 border-b transition-colors"
                  style={{
                    borderColor: 'rgba(255,255,255,0.06)',
                    color: isActive(item.to) ? '#7C5CFC' : 'rgba(255,255,255,0.6)',
                  }}
                >
                  <span className="text-lg font-semibold tracking-wide">{item.label}</span>
                  {isActive(item.to) && (
                    <span className="w-2 h-2 rounded-full bg-[#7C5CFC]" />
                  )}
                </Link>
              ))}

              {/* MyPage (mobile, logged-in) */}
              {user && (
                <Link
                  to="/mypage"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 py-4 border-b text-lg font-semibold tracking-wide"
                  style={{
                    borderColor: 'rgba(255,255,255,0.06)',
                    color: isActive('/mypage') ? '#7C5CFC' : 'rgba(255,255,255,0.6)',
                  }}
                >
                  <User className="w-5 h-5" />
                  <span>{t.nav.myPage ?? 'My Page'}</span>
                </Link>
              )}
            </nav>

            {/* Mobile CTA */}
            <div className="mt-10 space-y-4">
              <a
                href="https://wa.me/821087140611"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl text-base font-bold transition-all"
                style={{
                  background: 'linear-gradient(135deg, #7C5CFC, #5A3FD4)',
                  color: '#fff',
                  boxShadow: '0 4px 20px rgba(124,92,252,0.3)',
                }}
              >
                <MessageCircle className="w-5 h-5" />
                <span>{t.nav.inquiry ?? '1:1 Inquiry'}</span>
              </a>
            </div>

            {/* Mobile Language Selector */}
            <div className="mt-8">
              <p className="text-[10px] uppercase tracking-[3px] text-white/25 font-semibold mb-3">
                Language
              </p>
              <div className="grid grid-cols-4 gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      onLanguageChange(lang.code as Language);
                    }}
                    className="py-2.5 rounded-xl text-center text-[13px] font-semibold transition-all"
                    style={{
                      background: language === lang.code ? 'rgba(124,92,252,0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${language === lang.code ? 'rgba(124,92,252,0.3)' : 'rgba(255,255,255,0.06)'}`,
                      color: language === lang.code ? '#B9A4FF' : 'rgba(255,255,255,0.35)',
                    }}
                  >
                    {lang.short}
                  </button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <p className="text-center text-[11px] text-white/15 mt-12">
              &copy; 2026 COCOTRIP. All rights reserved.
            </p>
          </div>
        </div>
      )}
    </header>
  );
}
