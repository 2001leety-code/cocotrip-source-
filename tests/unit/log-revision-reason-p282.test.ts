/**
 * PR #282 재작성 (2026-05-22) — log-revision-reason endpoint + dietary queries.
 *
 * 원본 PR #282 (5/6, 16일 stale) 가 PurchaseSection 충돌 매우 큼 → 재작성.
 * 핵심 변경:
 *   1. api/log-revision-reason.js — 메타 로깅 endpoint (main 의 W4 와 별도)
 *   2. scripts/collect-restaurants.mjs — 제주/경주/전주 dietary queries 추가
 *
 * PurchaseSection UI 변경은 main 의 W4 (URL query param + Gemini prompt inject)
 * 가 이미 더 deep 한 통합 — PR #282 의 inline chip UI 는 SKIP.
 *
 * Test scenarios:
 *   A. log-revision-reason source-level invariant
 *   B. VALID_REASON_KEYS 의 원본 5 chip + W4 확장 chip 포함
 *   C. collect-restaurants 제주 dietary (vegetarian/halal 9 query)
 *   D. collect-restaurants 경주 dietary (10 query)
 *   E. collect-restaurants 전주 dietary (10 query)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_ENDPOINT = readFileSync(
  resolve(process.cwd(), 'api/log-revision-reason.js'),
  'utf8',
);
const COLLECT_SCRIPT = readFileSync(
  resolve(process.cwd(), 'scripts/collect-restaurants.mjs'),
  'utf8',
);

describe('PR #282 재작성 — log-revision-reason endpoint', () => {
  it('A. handler + POST/OPTIONS 메서드 분기 존재', () => {
    expect(LOG_ENDPOINT).toMatch(/export default async function handler/);
    expect(LOG_ENDPOINT).toMatch(/req\.method === ['"]OPTIONS['"]/);
    expect(LOG_ENDPOINT).toMatch(/req\.method !== ['"]POST['"]/);
  });

  it('B. VALID_REASON_KEYS allowlist — 원본 5 chip 포함', () => {
    for (const k of ['restaurant', 'route', 'schedule', 'language', 'other']) {
      expect(LOG_ENDPOINT).toMatch(new RegExp(`['"]${k}['"]`));
    }
  });

  it('C. VALID_REASON_KEYS — W4 확장 chip 포함 (too_packed / food_not_match 등)', () => {
    for (const k of ['too_packed', 'too_loose', 'food_not_match', 'budget_off']) {
      expect(LOG_ENDPOINT).toMatch(new RegExp(`['"]${k}['"]`));
    }
  });

  it('D. _validateReasonString helper — comma-joined 처리', () => {
    expect(LOG_ENDPOINT).toMatch(/function\s+_validateReasonString/);
    expect(LOG_ENDPOINT).toMatch(/\.split\(['"],['"]\)/);
    expect(LOG_ENDPOINT).toMatch(/\.slice\(0,\s*5\)/); // 최대 5개 chip cap
  });

  it('E. Firestore arrayUnion 으로 revisionReasons 배열에 push', () => {
    expect(LOG_ENDPOINT).toMatch(/FieldValue\.arrayUnion/);
    expect(LOG_ENDPOINT).toMatch(/revisionReasons:/);
    expect(LOG_ENDPOINT).toMatch(/lastRevisionReasonAt:/);
  });

  it('F. Firestore unavailable / planId missing / plan not found 분기', () => {
    expect(LOG_ENDPOINT).toMatch(/Firestore admin unavailable/);
    expect(LOG_ENDPOINT).toMatch(/MISSING_PLAN_ID/);
    expect(LOG_ENDPOINT).toMatch(/PLAN_NOT_FOUND/);
  });

  it('G. optional Bearer Firebase token — userId 추출 (audit log)', () => {
    expect(LOG_ENDPOINT).toMatch(/Bearer/);
    expect(LOG_ENDPOINT).toMatch(/verifyIdToken/);
    expect(LOG_ENDPOINT).toMatch(/userId\s*=\s*decoded\.uid/);
  });

  it('H. freeText length cap (MAX_FREE_TEXT_LEN = 200)', () => {
    expect(LOG_ENDPOINT).toMatch(/MAX_FREE_TEXT_LEN\s*=\s*200/);
    expect(LOG_ENDPOINT).toMatch(/\.slice\(0,\s*MAX_FREE_TEXT_LEN\)/);
  });

  it('I. fire-and-forget — 로깅 실패해도 200 응답 + logged:false', () => {
    expect(LOG_ENDPOINT).toMatch(/logged:\s*false/);
  });

  it('J. CORS allowlist + content-type header', () => {
    expect(LOG_ENDPOINT).toMatch(/Access-Control-Allow-Origin/);
    expect(LOG_ENDPOINT).toMatch(/Access-Control-Allow-Methods/);
  });
});

describe('PR #282 재작성 — collect-restaurants dietary queries', () => {
  it('A. 제주 vegetarian (사찰음식/콩요리/자연식/두부 전문점) 4 query 추가', () => {
    expect(COLLECT_SCRIPT).toMatch(/제주 사찰음식/);
    expect(COLLECT_SCRIPT).toMatch(/제주 콩요리 식당/);
    expect(COLLECT_SCRIPT).toMatch(/제주 자연식 식당/);
    expect(COLLECT_SCRIPT).toMatch(/제주 두부 전문점/);
  });

  it('B. 제주 halal (할랄/무슬림/터키/아랍/인도) 5 query 추가', () => {
    expect(COLLECT_SCRIPT).toMatch(/제주 할랄 식당/);
    expect(COLLECT_SCRIPT).toMatch(/제주 무슬림 친화 식당/);
    expect(COLLECT_SCRIPT).toMatch(/제주 터키 음식/);
    expect(COLLECT_SCRIPT).toMatch(/제주 아랍 음식/);
    expect(COLLECT_SCRIPT).toMatch(/제주 인도 음식/);
  });

  it('C. 경주 dietary (vegan 3 + vegetarian 3 + halal 4) 10 query 추가', () => {
    expect(COLLECT_SCRIPT).toMatch(/경주 비건 식당/);
    expect(COLLECT_SCRIPT).toMatch(/경주 채식 식당/);
    expect(COLLECT_SCRIPT).toMatch(/경주 샐러드 식당/);
    expect(COLLECT_SCRIPT).toMatch(/경주 사찰음식/);
    expect(COLLECT_SCRIPT).toMatch(/경주 두부 전문점/);
    expect(COLLECT_SCRIPT).toMatch(/경주 콩요리/);
    expect(COLLECT_SCRIPT).toMatch(/경주 할랄 식당/);
    expect(COLLECT_SCRIPT).toMatch(/경주 무슬림 친화 식당/);
    expect(COLLECT_SCRIPT).toMatch(/경주 터키 음식/);
    expect(COLLECT_SCRIPT).toMatch(/경주 인도 음식/);
  });

  it('D. 전주 dietary (vegan 3 + vegetarian 3 + halal 4) 10 query 추가', () => {
    expect(COLLECT_SCRIPT).toMatch(/전주 비건 식당/);
    expect(COLLECT_SCRIPT).toMatch(/전주 채식 식당/);
    expect(COLLECT_SCRIPT).toMatch(/전주 비건 카페/);
    expect(COLLECT_SCRIPT).toMatch(/전주 사찰음식/);
    expect(COLLECT_SCRIPT).toMatch(/전주 두부 전문점/);
    expect(COLLECT_SCRIPT).toMatch(/전주 자연식 식당/);
    expect(COLLECT_SCRIPT).toMatch(/전주 할랄 식당/);
    expect(COLLECT_SCRIPT).toMatch(/전주 무슬림 친화 식당/);
    expect(COLLECT_SCRIPT).toMatch(/전주 터키 음식/);
    expect(COLLECT_SCRIPT).toMatch(/전주 인도 음식/);
  });

  it('E. tag/category 일관성 — vegetarian/halal tag 사용', () => {
    expect(COLLECT_SCRIPT).toMatch(/tag:\s*['"]vegetarian['"]/);
    expect(COLLECT_SCRIPT).toMatch(/tag:\s*['"]halal['"]/);
    expect(COLLECT_SCRIPT).toMatch(/category:\s*['"]vegetarian['"]/);
    expect(COLLECT_SCRIPT).toMatch(/category:\s*['"]halal['"]/);
  });
});
