import { createContext, useContext, useState, useCallback, createElement, useEffect } from 'react';
import type { ReactNode } from 'react';
import { translations, type Language } from '@/i18n';

type LanguageContextValue = {
  language: Language;
  t: (typeof translations)[Language];
  changeLanguage: (lang: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  t: translations.en,
  changeLanguage: () => {},
});

const STORAGE_KEY = 'cocotrip_lang';
const SUPPORTED: Language[] = ['en', 'ko', 'ja', 'zh'];

function detectInitialLanguage(): Language {
  // 1. Respect saved user choice
  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Language | null;
      if (saved && SUPPORTED.includes(saved)) return saved;
    }
  } catch { /* localStorage unavailable */ }

  // 2. Auto-detect from browser — English is the true default if nothing matches
  try {
    if (typeof navigator !== 'undefined') {
      const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
      for (const raw of langs) {
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (lower.startsWith('ko')) return 'ko';
        if (lower.startsWith('ja')) return 'ja';
        if (lower.startsWith('zh')) return 'zh';
        if (lower.startsWith('en')) return 'en';
      }
    }
  } catch { /* navigator unavailable */ }

  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());
  const t = translations[language];

  const changeLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, lang);
      }
    } catch { /* ignore */ }
  }, []);

  // Keep <html lang> in sync for SEO / accessibility / system font fallbacks
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = language;
    }
  }, [language]);

  return createElement(LanguageContext.Provider, { value: { language, t, changeLanguage } }, children);
}

export function useLanguage() {
  return useContext(LanguageContext);
}
