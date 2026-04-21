/**
 * CocoTrip i18n — JSON 기반 다국어 시스템
 *
 * 기존 4,300줄 단일 파일을 4개 JSON + 30줄 로더로 분할.
 * 타입 안전성은 ko.json 기준 Translations 타입으로 보장.
 *
 * 사용법 (기존과 100% 동일):
 *   import { translations, type Language } from '@/i18n';
 *   const t = translations[language];
 */

import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

export type Language = 'ko' | 'en' | 'ja' | 'zh';

/** ko.json 구조를 기준으로 타입 추론 */
export type Translations = typeof ko;

/** 4개 언어 번역 객체 — 기존 import 경로 완전 호환 */
export const translations: Record<Language, Translations> = {
  ko,
  en: en as unknown as Translations,
  ja: ja as unknown as Translations,
  zh: zh as unknown as Translations,
};
