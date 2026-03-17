import { useState, useCallback } from 'react';
import { translations, type Language } from '@/i18n';

export function useLanguage() {
  const [language, setLanguage] = useState<Language>('en');

  const t = translations[language];

  const changeLanguage = useCallback((lang: Language) => {
    setLanguage(lang);
  }, []);

  return { language, t, changeLanguage };
}
