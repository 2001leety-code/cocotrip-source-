/**
 * P180 (2026-05-24): 다도시 plan 의 food stop city 강제 룰 — buildPrompt 의
 * section 9-bis. 사용자 신고: "마초스테이크 본점" (서울 강남구 식당) 이 jeju day
 * stop 으로 등장 → dbMatcher cross-city 감지 + verified=false 처리 + 사용자가 받은
 * plan address (Gemini hallucination) = jeju 어딘가 가짜 위치. **돈 받는 plan 의
 * 신뢰 손상**.
 *
 * 회귀 시: section 9-bis 가 prompt 에서 빠지면 Gemini wrong-city food 출력 회귀.
 * dbMatcher threshold 30%→20% (P180) 도 같이 회귀 (조기 발견 약화).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P180 buildPrompt food stop city + dbMatcher threshold', () => {
  const promptPath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');
  const matcherPath = resolve(__dirname, '../../api/_ai_core/dbMatcher.js');
  const promptSrc = readFileSync(promptPath, 'utf8');
  const matcherSrc = readFileSync(matcherPath, 'utf8');

  it('buildPrompt — section 9-bis (FOOD STOP city 매칭) 존재', () => {
    // section header
    expect(promptSrc).toMatch(/9-bis[^\n]*FOOD STOP city/);
    // P180 reference
    expect(promptSrc).toMatch(/P180/);
  });

  it('buildPrompt — day.city == food stop city 강제 명시', () => {
    // food stop 의 day.city 일치 룰 (다도시 plan 분기)
    expect(promptSrc).toMatch(/category[^\n]{0,30}food[\s\S]{0,500}day\.city/);
    // 도시별 예시 (Seoul / Busan / Jeju) — backtick / quote variants
    expect(promptSrc).toMatch(/day\.city\s*=\s*["'`]?Seoul["'`]?\s*\\?["'`]?\s*→\s*food/);
    expect(promptSrc).toMatch(/day\.city\s*=\s*["'`]?Busan["'`]?\s*\\?["'`]?\s*→\s*[^\n]*부산/);
    expect(promptSrc).toMatch(/day\.city\s*=\s*["'`]?Jeju["'`]?\s*\\?["'`]?\s*→\s*[^\n]*제주/);
  });

  it('buildPrompt — 마초스테이크 본점 BAD 예시 + 회귀 references P180', () => {
    expect(promptSrc).toMatch(/마초스테이크\s*본점/);
    expect(promptSrc).toMatch(/돈 받는 plan 의 신뢰 손상|verified=false/);
  });

  it('dbMatcher — CITY_MISMATCH_RATIO_THRESHOLD 0.2 (P180, 30→20% 강화)', () => {
    expect(matcherSrc).toMatch(/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.2\b/);
    // 30% 직접 회귀 차단
    expect(matcherSrc).not.toMatch(/CITY_MISMATCH_RATIO_THRESHOLD\s*=\s*0\.3\b/);
  });
});
