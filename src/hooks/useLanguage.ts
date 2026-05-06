import { createContext, useContext, useState, useCallback, createElement, useEffect } from 'react';
import type { ReactNode } from 'react';
import { translations, loadLocale, getLocaleSync, type Language, type Translations } from '@/i18n';
import { track } from '@/lib/posthog';

type LanguageContextValue = {
  language: Language;
  t: Translations;
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
  // 2026-05-06 번들 다이어트: locale 비동기 로드. 첫 paint 시엔 캐시 또는 EN fallback,
  // 비-EN 사용자는 ~100ms 후 chunk 도착하면 setT 로 정확한 locale 적용.
  const [t, setT] = useState<Translations>(() => getLocaleSync(language));

  // language 변경 / 첫 진입 시 chunk 로드 → 캐시에 저장 + state 갱신
  useEffect(() => {
    let cancelled = false;
    loadLocale(language).then((loaded) => {
      if (!cancelled) setT(loaded);
    });
    return () => { cancelled = true; };
  }, [language]);

  const changeLanguage = useCallback((lang: Language) => {
    setLanguage((prev) => {
      // Sprint 2 #7: language_switched event — fire only on actual change.
      // Reading prev inside the setter avoids a stale-closure dep on `language`.
      if (prev !== lang) {
        void track('language_switched', { from: prev, to: lang });
      }
      return lang;
    });
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

  // Cross-tab language synchronization via storage event
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && SUPPORTED.includes(e.newValue as Language)) {
        setLanguage(e.newValue as Language);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return createElement(LanguageContext.Provider, { value: { language, t, changeLanguage } }, children);
}

export function useLanguage() {
  return useContext(LanguageContext);
}
