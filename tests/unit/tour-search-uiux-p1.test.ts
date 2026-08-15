// UIUX 가이드 P1 홈 검색바 → /tours?q= 라우팅 회귀 방지.
// ① matchesTourQuery 순수 로직 (실 TOURS 데이터로 언어 혼용 검색 검증)
// ② 배선: MobileHomeV2 검색폼 → /tours?q= / ToursPage ?q= 시딩 + 필터 적용
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { matchesTourQuery } from '../../src/lib/tourSearch';
import { TOURS } from '../../src/data/tours';

const read = (rel: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

describe('matchesTourQuery — 순수 매칭 로직', () => {
  it('빈/공백 검색어 = 전체 통과', () => {
    expect(matchesTourQuery(TOURS[0], '')).toBe(true);
    expect(matchesTourQuery(TOURS[0], '   ')).toBe(true);
  });

  it('영문 제목 부분일치 (대소문자 무시)', () => {
    const matched = TOURS.filter(t => matchesTourQuery(t, 'seoul'));
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every(t =>
      [
        ...Object.values(t.title || {}),
        ...Object.values(t.summary || {}),
        t.region,
        ...(t.tags || []),
      ].join(' ').toLowerCase().includes('seoul'),
    )).toBe(true);
  });

  it('언어 혼용: 영어 UI에서 한국어 검색어도 매칭 (전 언어 필드 검사)', () => {
    // 실데이터에 한국어 제목이 존재하는 투어가 최소 1개 있다는 전제 자체를 검증
    const koTitled = TOURS.filter(t => t.title?.ko);
    expect(koTitled.length).toBeGreaterThan(0);
    const sample = koTitled[0];
    const koWord = (sample.title.ko || '').slice(0, 2);
    expect(koWord.length).toBe(2);
    expect(matchesTourQuery(sample, koWord)).toBe(true);
  });

  it('태그 검색 (Night Tour 등)', () => {
    const nightTours = TOURS.filter(t => (t.tags || []).includes('Night Tour'));
    if (nightTours.length > 0) {
      expect(matchesTourQuery(nightTours[0], 'night')).toBe(true);
    }
  });

  it('무의미 검색어 = 0건 (전부 false)', () => {
    expect(TOURS.some(t => matchesTourQuery(t, 'zzqqxx-nonexistent'))).toBe(false);
  });
});

describe('배선 회귀 — 홈 검색바 / ToursPage ?q= 시딩', () => {
  const HOME = read('../../src/pages/MobileHomeV2.tsx');
  const TP = read('../../src/pages/ToursPage.tsx');

  it('MobileHomeV2: 검색폼 제출 시 /tours?q= 로 이동 + i18n placeholder', () => {
    expect(HOME).toMatch(/\/tours\?q=\$\{encodeURIComponent\(/);
    expect(HOME).toMatch(/m\.searchPlaceholder/);
    expect(HOME).toMatch(/role="search"/);
  });

  it('ToursPage: ?q= 초기값 시딩 + matchesTourQuery 필터 적용', () => {
    expect(TP).toMatch(/searchParams\.get\('q'\)/);
    expect(TP).toMatch(/matchesTourQuery\(\w+,\s*searchQuery\)/);
  });

  it('i18n 4언어: mobileHomeV2.searchPlaceholder 전 로케일 존재', () => {
    for (const lang of ['en', 'ko', 'ja', 'zh']) {
      const locale = JSON.parse(read(`../../src/i18n/locales/${lang}.json`));
      expect(locale.mobileHomeV2?.searchPlaceholder, `${lang}.json 누락`).toBeTruthy();
    }
  });
});
