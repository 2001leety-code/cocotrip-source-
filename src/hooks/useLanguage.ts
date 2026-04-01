import { createContext, useContext, useState, useCallback, createElement } from 'react';
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

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');
  const t = translations[language];
  const changeLanguage = useCallback((lang: Language) => setLanguage(lang), []);
  return createElement(LanguageContext.Provider, { value: { language, t, changeLanguage } }, children);
}

export function useLanguage() {
  return useContext(LanguageContext);
}
