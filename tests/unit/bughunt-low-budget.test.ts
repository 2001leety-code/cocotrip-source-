/**
 * 버그헌트 — selfHealDailyBudget activities_krw / shopping_estimate_krw 누락 (LOW 표시).
 *
 * planPersister.js 의 selfHealDailyBudget() 은 daily_budget_summary 가 없을 때
 * row 를 자동 합성한다. 수정 전 row 에 activities_krw · shopping_estimate_krw 필드가
 * 없어 프론트 BudgetTable 이 undefined → 빈칸/0 을 표시했다.
 * Gemini responseSchema (geminiPipeline.js daily_budget_summary) 는 6 필드 정의.
 * 수정: return 객체에 activities_krw: 0, shopping_estimate_krw: 0 명시 추가.
 *
 * total_krw 는 meals + entry + transport + misc 합산이라 0 이 더해져도 합계 불변.
 * base_price_krw(실청구가) 무관 = 순수 표시 누락 버그.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/planPersister.js'),
  'utf8',
);

/** selfHealDailyBudget 함수 본문만 추출 (첫 occurrence ~ 다음 export/function 전까지) */
function extractSelfHealBody(source: string): string {
  const start = source.indexOf('function selfHealDailyBudget');
  if (start === -1) throw new Error('selfHealDailyBudget 함수를 찾을 수 없음');
  // return 블록 포함 위해 넉넉하게 추출 (4000자)
  return source.slice(start, start + 4000);
}

const healBody = extractSelfHealBody(src);

describe('selfHealDailyBudget — return row 필드 완전성', () => {
  it('activities_krw 필드가 명시적으로 포함된다', () => {
    expect(healBody).toMatch(/activities_krw\s*:/);
  });

  it('shopping_estimate_krw 필드가 명시적으로 포함된다', () => {
    expect(healBody).toMatch(/shopping_estimate_krw\s*:/);
  });

  it('activities_krw 값이 0 으로 초기화된다', () => {
    // "activities_krw: 0" 패턴 확인
    expect(healBody).toMatch(/activities_krw\s*:\s*0/);
  });

  it('shopping_estimate_krw 값이 0 으로 초기화된다', () => {
    expect(healBody).toMatch(/shopping_estimate_krw\s*:\s*0/);
  });

  it('기존 4개 필드(transport/entry_fees/meals/total)도 여전히 존재한다 (회귀)', () => {
    expect(healBody).toMatch(/transport_krw/);
    expect(healBody).toMatch(/entry_fees_krw/);
    expect(healBody).toMatch(/meals_krw/);
    expect(healBody).toMatch(/total_krw/);
  });

  it('_self_healed 마커가 유지된다 (admin panel 추적 회귀)', () => {
    expect(healBody).toMatch(/_self_healed\s*:\s*true/);
  });

  it('total_krw 계산에 nullish 연산자가 사용되지 않는다 (|| 규칙)', () => {
    // total_krw 계산 라인에 nullish 연산자 없음 확인
    const totalLine = healBody.split('\n').find((l) => l.includes('total_krw') && l.includes('=') && !l.includes(':'));
    if (totalLine) {
      expect(totalLine).not.toMatch(/\?\?/);
    }
  });
});

describe('selfHealDailyBudget — Gemini responseSchema 6-필드 호환성', () => {
  it('스키마 정의 필드 6개가 모두 return row 에 존재한다', () => {
    // transport_krw / entry_fees_krw / meals_krw / total_krw 는 shorthand 변수로 전달되므로
    // "필드명:" 또는 "필드명," 또는 "필드명}" 패턴으로 확인한다.
    const requiredFields = [
      'transport_krw',
      'entry_fees_krw',
      'meals_krw',
      'total_krw',
      'activities_krw',
      'shopping_estimate_krw',
    ];
    for (const field of requiredFields) {
      // shorthand("field,") 또는 명시적("field:") 둘 다 허용
      expect(healBody, `누락 필드: ${field}`).toMatch(
        new RegExp(`${field}(?:\\s*[:,}]|\\s*$)`),
      );
    }
  });
});
