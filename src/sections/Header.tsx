import { useState, useEffect } from 'react';
import { Menu, X, MessageCircle, Globe, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Language } from '@/i18n';
import { useIsMobile } from '@/hooks/use-mobile'; // useIsMobile 훅 가져오기

interface HeaderProps {
  language: Language;
  t: any;
  onLanguageChange: (lang: Language) => void;
}

const languages = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

export function Header({ language, t, onLanguageChange }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const isMobile = useIsMobile(); // isMobile 상태 사용

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 모바일 메뉴가 열렸을 때 배경 스크롤 방지
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMobileMenuOpen]);

  const navItems = [
    { label: t.nav.charter   ?? '🚗 전세차량', to: '/charter' },
    { label: t.nav.planner   ?? '🗺 AI 플래너', to: '/planner' },
    { label: t.nav.about     ?? '소개',          to: '/about'   },
  ];

  const renderNavLinks = (isMobile = false) =>
    navItems.map((item) => (
      <Link
        key={item.to}
        to={item.to}
        onClick={() => setIsMobileMenuOpen(false)}
        className={isMobile
            ? 'block text-2xl font-bold text-gray-800 py-4 text-center hover:bg-gray-50 transition-colors'
            : `text-sm font-medium transition-colors hover:text-[#c0b283] ${isScrolled ? 'text-gray-700' : 'text-white'}`
        }>
        {item.label}
      </Link>
    ));

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled || isMobileMenuOpen
          ? 'bg-white shadow-sm'
          : 'bg-transparent'
      }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 z-50">
            <div className="w-10 h-10 rounded-full bg-[#0f3460] flex items-center justify-center">
              <span className="text-white font-bold text-sm">COCO</span>
            </div>
            <div className="flex flex-col">
              <span className={`font-bold text-lg leading-tight ${
                  isScrolled || (isMobile && !isMobileMenuOpen) ? 'text-[#0f3460]' : isMobileMenuOpen ? 'text-[#0f3460]' : 'text-white'}`}>
                COCOTRIP
              </span>
              <span className={`text-[10px] tracking-wider ${isScrolled || (isMobile && !isMobileMenuOpen) ? 'text-[#c0b283]' : isMobileMenuOpen ? 'text-[#c0b283]' : 'text-white/80'}`}>
                KOREA PRIVATE TOUR
              </span>
            </div>
          </a>

          {/* Desktop Navigation */}
          {!isMobile && (
            <nav className="hidden lg:flex items-center gap-8">
              {renderNavLinks()}
            </nav>
          )}

          {/* Right Side */}
          <div className="flex items-center gap-2 sm:gap-4 z-50">
            {/* Language Selector */}
            <div className="relative">
                <button
                    onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    isScrolled || isMobile
                        ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-white hover:bg-white/10'
                    }`}>
                    <Globe className="w-4 h-4" />
                    <span className="hidden sm:inline">
                    {languages.find((l) => l.code === language)?.label}
                    </span>
                    <ChevronDown className="w-3 h-3" />
                </button>

                {isLangMenuOpen && (
                    <div className="absolute right-0 mt-2 w-32 bg-white rounded-lg shadow-lg py-1 z-50">
                    {languages.map((lang) => (
                        <button
                        key={lang.code}
                        onClick={() => {
                            onLanguageChange(lang.code as Language);
                            setIsLangMenuOpen(false);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors ${
                            language === lang.code
                            ? 'text-[#0f3460] font-medium'
                            : 'text-gray-600'
                        }`}>
                        {lang.label}
                        </button>
                    ))}
                    </div>
                )}
            </div>

            {/* WhatsApp Inquiry - 데스크톱에서만 보이도록 */}
            {!isMobile && (
                 <a
                 href="https://wa.me/821087140611"
                 target="_blank"
                 rel="noopener noreferrer"
                 className="hidden md:flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white rounded-full text-sm font-medium hover:bg-[#128C7E] transition-colors"
               >
                 <MessageCircle className="w-4 h-4" />
                 <span>{t.nav.inquiry}</span>
               </a>
            )}

            {/* Mobile Menu Button */}
            {isMobile && (
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className={`p-2 rounded-lg transition-colors ${
                  isScrolled || isMobileMenuOpen
                    ? 'text-[#1a1a2e] hover:bg-gray-100'
                    : 'text-white hover:bg-white/10'
                }`}>
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu (Full Screen Overlay) */}
      {isMobile && isMobileMenuOpen && (
        <div className="fixed inset-0 top-0 bg-white pt-20 px-4 z-40 flex flex-col shadow-xl">
            <nav className="flex flex-col divide-y divide-gray-100">
                {renderNavLinks(true)}
            </nav>
            <div className="mt-auto pb-8">
                <a
                    href="https://wa.me/821087140611"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-3 w-full px-4 py-4 bg-[#25D366] text-white rounded-full text-lg font-bold hover:bg-[#128C7E] transition-colors"
                    >
                    <MessageCircle className="w-6 h-6" />
                    <span>{t.nav.inquiry}</span>
                </a>
                <p className="text-center text-xs text-gray-400 mt-4">© 2024 COCOTRIP. All rights reserved.</p>
            </div>
        </div>
      )}
    </header>
  );
}
