/**
 * P114 후속 (2026-05-22) — dbMatcher cross-city fallback 의 landmark name skip.
 *
 * Source bug (plan 9845a69e Day 4 부산):
 *   stop name "자갈치" (Busan 자갈치시장 landmark) 가 Seoul 종로구 "자갈치" 식당
 *   entry 와 cross-city fallback 매칭 → admin city-mismatch noise 33%.
 *
 *   foodIndex 에 Busan 자갈치시장 식당 entry 없음 (단일 식당 X, 시장 stall 군집).
 *   기존 cross-city fallback logic 은 fallback 시 다른 도시 식당 정보 reuse —
 *   landmark 의 경우 부적절.
 *
 * Fix:
 *   stopName 이 landmark suffix (시장/거리/광장/역/타운/마을/로/공항/터미널) 또는
 *   알려진 landmark 단어 (자갈치/광장시장/남대문시장 등) 이면 cross-city fallback
 *   SKIP → match 미설정 → 아래 else 분기 → verified=false + dbUnmatched++.
 *
 * Test scenarios:
 *   A. 시장 suffix → skip.
 *   B. 거리 suffix → skip.
 *   C. 광장 suffix → skip.
 *   D. 역 suffix → skip.
 *   E. 자갈치 (exact) → skip.
 *   F. 광장시장 (exact) → skip.
 *   G. 일반 식당명 (예: "오복식당") → skip 안 함.
 *   H. nameEn landmark (예: "Jagalchi") → skip (case-insensitive).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Inline replica of P114-continued landmark detection ─────────────────────
function isLandmarkName(stopName: string): boolean {
  const LANDMARK_SUFFIXES = /(시장|거리|광장|역|타운|마을|로|공항|터미널|광장시장|남대문|동대문|광장)$/;
  const LANDMARK_WORDS = /^(자갈치|광장시장|남대문시장|동대문시장|남포동|해운대|광안리|gwangjang|namdaemun|dongdaemun|jagalchi|nampo|haeundae|gwangalli)$/i;
  return LANDMARK_SUFFIXES.test(stopName) || LANDMARK_WORDS.test(stopName);
}

describe('P114 후속 — landmark name detection (cross-city fallback skip)', () => {
  it('A. "광장시장" (시장 suffix) → landmark', () => {
    expect(isLandmarkName('광장시장')).toBe(true);
  });

  it('B. "남대문시장" (시장 suffix) → landmark', () => {
    expect(isLandmarkName('남대문시장')).toBe(true);
  });

  it('C. "인사동 거리" (거리 suffix) → landmark', () => {
    expect(isLandmarkName('인사동 거리')).toBe(true);
  });

  it('D. "광화문 광장" (광장 suffix) → landmark', () => {
    expect(isLandmarkName('광화문 광장')).toBe(true);
  });

  it('E. "강남역" (역 suffix) → landmark', () => {
    expect(isLandmarkName('강남역')).toBe(true);
  });

  it('F. "자갈치" (exact word) → landmark', () => {
    expect(isLandmarkName('자갈치')).toBe(true);
  });

  it('G. "해운대" (exact word) → landmark', () => {
    expect(isLandmarkName('해운대')).toBe(true);
  });

  it('H. "광안리" (exact word) → landmark', () => {
    expect(isLandmarkName('광안리')).toBe(true);
  });

  it('I. "Jagalchi" (exact word, English, case-insensitive) → landmark', () => {
    expect(isLandmarkName('Jagalchi')).toBe(true);
    expect(isLandmarkName('JAGALCHI')).toBe(true);
    expect(isLandmarkName('jagalchi')).toBe(true);
  });

  it('J. "Gwangjang" (exact word) → landmark', () => {
    expect(isLandmarkName('Gwangjang')).toBe(true);
  });

  it('K. "오복식당" (일반 식당명) → not landmark (regression 안전망)', () => {
    expect(isLandmarkName('오복식당')).toBe(false);
  });

  it('L. "본가 곱창" (일반 식당명) → not landmark', () => {
    expect(isLandmarkName('본가 곱창')).toBe(false);
  });

  it('M. "Brothers Special Cuts" (영문 식당명) → not landmark', () => {
    expect(isLandmarkName('Brothers Special Cuts')).toBe(false);
  });

  it('N. "명동 교자 본점" (명동 prefix 식당) → not landmark', () => {
    // "교자 본점" 은 일반 식당 이름. 명동은 prefix.
    expect(isLandmarkName('명동 교자 본점')).toBe(false);
  });

  it('O. "Myeongdong" (prefix-only landmark) → not landmark (단독 단어 검사 안 함)', () => {
    // 명동/Myeongdong 자체는 landmark words list 에 없음 (명동은 일반 동 이름).
    expect(isLandmarkName('Myeongdong')).toBe(false);
  });
});

describe('P114 후속 — source-level invariant (dbMatcher.js)', () => {
  const DBMATCHER = readFileSync(
    resolve(process.cwd(), 'api/_ai_core/dbMatcher.js'),
    'utf8',
  );

  it('P114 후속 marker 존재', () => {
    expect(DBMATCHER).toMatch(/P114 후속/);
  });

  it('isLandmark 변수 + LANDMARK_SUFFIXES regex 선언', () => {
    expect(DBMATCHER).toMatch(/const isLandmark\s*=/);
    expect(DBMATCHER).toMatch(/LANDMARK_SUFFIXES/);
    expect(DBMATCHER).toMatch(/LANDMARK_WORDS/);
  });

  it('자갈치/시장/광장/역 텍스트 포함 (regex pattern)', () => {
    expect(DBMATCHER).toMatch(/자갈치/);
    expect(DBMATCHER).toMatch(/시장/);
    expect(DBMATCHER).toMatch(/광장/);
    expect(DBMATCHER).toMatch(/역\|/); // suffix 안에 역 들어가있음
  });

  it('cross-city fallback SKIP 분기 존재 (isLandmark 면 match 미설정)', () => {
    expect(DBMATCHER).toMatch(/if \(isLandmark\)/);
    expect(DBMATCHER).toMatch(/landmark name/);
  });
});
