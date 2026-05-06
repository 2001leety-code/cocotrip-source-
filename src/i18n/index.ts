/**
 * CocoTrip i18n — JSON 기반 다국어 시스템
 *
 * 2026-05-06 번들 다이어트: 이전엔 4개 locale (ko/en/ja/zh, 각 ~25KB gzipped)
 * 모두 main bundle 에 inline → first paint 가 ~100KB 의 i18n 데이터 로드 후에야 시작.
 * 변경: EN 만 eager (영어 default + 비 EN 사용자도 첫 paint 시 잠깐 EN 깜빡일 수
 * 있음 — 약 100ms 후 현재 언어로 swap), KO/JA/ZH 는 dynamic import → 별도 chunk.
 *
 * 사용법 (기존과 호환):
 *   import { translations, type Language } from '@/i18n';
 *   const t = translations[language];  // Proxy 가 cache 또는 EN fallback 반환
 *
 * 새 추천 사용법 (await):
 *   import { loadLocale, type Translations } from '@/i18n';
 *   const t = await loadLocale(language);  // 정확한 언어 보장
 *
 * useLanguage hook 은 자동으로 loadLocale 호출 + 결과를 t 에 반영. 기존 컴포넌트
 * 가 useLanguage().t 만 사용하면 자동 lazy-load + re-render.
 */

import en from './locales/en.json';

export type Language = 'ko' | 'en' | 'ja' | 'zh';

/** ko.json 구조를 기준으로 타입 추론 — EN 도 동일 schema */
export type Translations = typeof en;

/** Locale 캐시 — EN 은 즉시 로드, 나머지는 비어있다가 loadLocale 호출 시 채워짐. */
const cache: Record<Language, Translations | null> = {
  en,
  ko: null,
  ja: null,
  zh: null,
};

/** Dynamic import 로 분리된 chunk 로 split — Vite 가 i18n-{lang}.js 별도 chunk 생성. */
const loaders: Record<Language, () => Promise<Translations>> = {
  en: () => Promise.resolve(en),
  ko: () => import('./locales/ko.json').then((m) => m.default as unknown as Translations),
  ja: () => import('./locales/ja.json').then((m) => m.default as unknown as Translations),
  zh: () => import('./locales/zh.json').then((m) => m.default as unknown as Translations),
};

/**
 * 비동기 로드 — 캐시 hit 시 즉시 반환, miss 시 chunk 다운로드 후 캐시에 저장.
 * useLanguage hook 이 이 함수를 호출해서 t state 갱신.
 */
export async function loadLocale(lang: Language): Promise<Translations> {
  if (cache[lang]) return cache[lang]!;
  const loaded = await loaders[lang]();
  cache[lang] = loaded;
  return loaded;
}

/** 동기 best-effort — 캐시된 locale 또는 EN fallback. */
export function getLocaleSync(lang: Language): Translations {
  return cache[lang] ?? en;
}

/**
 * Legacy API — `translations[lang]` 패턴 유지용 Proxy.
 * 캐시 hit 시 해당 locale, miss 시 EN fallback (사용자에게 잠깐 EN 보일 수 있음 —
 * useLanguage hook 사용하면 자동 로드 + re-render 트리거되어 이 fallback 거의 안 보임).
 *
 * 신규 코드는 가능하면 `useLanguage().t` 사용 권장 — Proxy 우회 + 정확한 언어 보장.
 */
export const translations: Record<Language, Translations> = new Proxy(
  cache as unknown as Record<Language, Translations>,
  {
    get(target, prop) {
      const lang = prop as Language;
      const cached = (target as unknown as Record<Language, Translations | null>)[lang];
      return cached ?? en;
    },
  },
);
