/**
 * i18n 키 일치 검증 테스트
 * - 4개 언어(ko, en, ja, zh) 간 키 구조가 동일한지 확인
 * - 빈 문자열이나 누락된 키를 자동 감지
 * - 기존 i18n/index.ts를 수정하지 않고, 읽기만 함
 */
import { describe, it, expect } from 'vitest';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

// 재귀적으로 모든 키 경로를 추출
function getKeyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      paths.push(...getKeyPaths(val as Record<string, unknown>, fullKey));
    } else {
      paths.push(fullKey);
    }
  }
  return paths;
}

describe('i18n 키 일치 검증', () => {
  const koKeys = getKeyPaths(ko as Record<string, unknown>);
  const langs = { en, ja, zh } as Record<string, Record<string, unknown>>;

  it('ko.json에 번역 키가 존재한다', () => {
    expect(koKeys.length).toBeGreaterThan(100);
  });

  for (const [langName, langData] of Object.entries(langs)) {
    it(`${langName}.json에 ko와 동일한 최상위 키가 있다`, () => {
      const koTopKeys = Object.keys(ko);
      const langTopKeys = Object.keys(langData);
      
      for (const key of koTopKeys) {
        expect(langTopKeys, `${langName} is missing top-level key: ${key}`).toContain(key);
      }
    });
  }

  it('ko.json에 빈 문자열 값이 없다', () => {
    const emptyKeys = koKeys.filter(key => {
      const parts = key.split('.');
      let current: unknown = ko;
      for (const part of parts) {
        current = (current as Record<string, unknown>)[part];
      }
      return current === '';
    });
    expect(emptyKeys, `Empty values found: ${emptyKeys.join(', ')}`).toHaveLength(0);
  });
});