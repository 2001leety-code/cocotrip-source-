// @vitest-environment jsdom
//
// budget[].day 누락/형식 상이 회귀 (2026-08-09).
//
// 근본원인: BudgetTable / pdfGenerator / planToMarkdown 세 표면이 `row.day`가
// 없거나(undefined/null) 숫자 아닌 값(malformed string)일 때 서로 다른 폴백을 썼다.
//   - BudgetTable.tsx: `formatBudgetDay(row.day, ui.budgetDayN)` — 폴백 없음.
//     day 가 undefined 면 `String(undefined)` 이 그대로 새어나가 "Day undefined" 노출.
//   - pdfGenerator.ts: `row.day || i + 1` — day 가 malformed 문자열("oops")이면
//     truthy 라 그대로 통과 → "Day oops" 노출 (garbage passthrough).
//   - planToMarkdown.ts: `dayCell` 이 없으면 리터럴 "?" — 위 두 표면과 다른 폴백.
//
// Post-fix: `formatBudgetDay(day, template, fallbackIndex)` 가 day 를 정규화하고
// (숫자 변환 실패/0 이하/누락 시) `fallbackIndex`(= 배열 index + 1)로 통일 폴백한다.
// 세 표면 모두 같은 함수·같은 fallbackIndex 규칙을 쓴다.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';
import { formatBudgetDay } from '../../src/pages/PlanDetailPage/lib/budgetDayLabel';
import { BudgetTable } from '../../src/pages/PlanDetailPage/components/BudgetTable';
import { planToMarkdown } from '../../src/pages/PlanDetailPage/lib/planToMarkdown';

void React;

const state = vi.hoisted(() => ({ lang: 'en', dict: {} as Record<string, unknown> }));

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: state.lang, t: state.dict, changeLanguage: () => {} }),
}));

const DICTS = { en, ko, ja, zh } as Record<string, Record<string, unknown>>;

function ui(lang: string): Record<string, string> {
  const pd = DICTS[lang].planDetail as Record<string, unknown>;
  return pd.ui as Record<string, string>;
}

function renderBudget(lang: string, budget: unknown[]) {
  state.lang = lang;
  state.dict = DICTS[lang];
  return render(<BudgetTable budget={budget as never} tMoney={0} />);
}

describe('formatBudgetDay — day 누락/malformed 시 fallbackIndex 로 통일', () => {
  it('day undefined → fallbackIndex 사용 (String(undefined) 노출 금지)', () => {
    const label = formatBudgetDay(undefined, ui('en').budgetDayN, 2);
    expect(label).toBe('Day 2');
    expect(label).not.toContain('undefined');
  });

  it('day null → fallbackIndex 사용', () => {
    expect(formatBudgetDay(null, ui('en').budgetDayN, 3)).toBe('Day 3');
  });

  it('day 가 숫자 아닌 문자열("oops") → fallbackIndex 로 폴백 (garbage passthrough 금지)', () => {
    const label = formatBudgetDay('oops', ui('en').budgetDayN, 2);
    expect(label).toBe('Day 2');
    expect(label).not.toContain('oops');
  });

  it('day 가 0 이하 → fallbackIndex 로 폴백 (0/음수는 유효한 일차가 아님)', () => {
    expect(formatBudgetDay(0, ui('en').budgetDayN, 1)).toBe('Day 1');
    expect(formatBudgetDay(-1, ui('en').budgetDayN, 4)).toBe('Day 4');
  });

  it('day 가 숫자형 문자열("2") → 정규화되어 fallbackIndex 무시', () => {
    expect(formatBudgetDay('2', ui('en').budgetDayN, 9)).toBe('Day 2');
  });

  it('ko/ja/zh 에서도 같은 규칙 (fallbackIndex, "{n}"/undefined 노출 금지)', () => {
    expect(formatBudgetDay(undefined, ui('ko').budgetDayN, 2)).toBe('2일차');
    expect(formatBudgetDay(undefined, ui('ja').budgetDayN, 2)).toBe('2日目');
    const zhLabel = formatBudgetDay(undefined, ui('zh').budgetDayN, 2);
    expect(zhLabel).toBe('第2天');
    expect(zhLabel).not.toContain('{n}');
  });
});

describe('BudgetTable 화면 렌더 — day 누락 행', () => {
  it('day 없는 두 번째 행 → "Day 2" (index+1), "Day undefined" 아님', () => {
    const budget = [
      { day: 1, transport_krw: 1000, entry_fees_krw: 0, meals_krw: 0, total_krw: 1000 },
      { transport_krw: 2000, entry_fees_krw: 0, meals_krw: 0, total_krw: 2000 },
    ];
    const { container } = renderBudget('en', budget);
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByText('Day 2')).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });

  it('day 가 malformed 문자열인 행 → index+1 로 폴백, 원본 문자열 노출 안 함', () => {
    const budget = [{ day: 'oops', transport_krw: 0, entry_fees_krw: 0, meals_krw: 0, total_krw: 0 }];
    const { container } = renderBudget('en', budget);
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(container.textContent).not.toContain('oops');
  });
});

describe('planToMarkdown — 예산표 day 누락 행', () => {
  it('day 없는 두 번째 예산 행 → "Day 2" (fallbackIndex), "?" 아님', () => {
    const plan = {
      itinerary: {
        tour_title: 'Test Trip',
        days: [],
        daily_budget_summary: [
          { day: 1, meals_krw: 1000, transport_krw: 0, entry_fees_krw: 0, total_krw: 1000 },
          { meals_krw: 2000, transport_krw: 0, entry_fees_krw: 0, total_krw: 2000 },
        ],
      },
      input: {},
    };
    const md = planToMarkdown(plan as never, { language: 'en' });
    expect(md).toContain('Day 1');
    expect(md).toContain('Day 2');
    expect(md).not.toMatch(/\|\s*\?\s*\|/);
  });
});

describe('pdfGenerator — BudgetTable/planToMarkdown 과 같은 fallbackIndex 규칙 공유', () => {
  const pdfSrc = readFileSync(
    resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
    'utf8',
  );

  it('row.day 를 "||" 로 직접 합성하지 않고 formatBudgetDay 의 fallbackIndex 인자로 넘긴다', () => {
    // Pre-fix: `formatBudgetDay(row.day || i + 1, L.dayN)` — malformed 문자열이
    // truthy 면 그대로 통과해 BudgetTable/planToMarkdown 과 다른 결과를 낸다.
    expect(pdfSrc).not.toContain('formatBudgetDay(row.day || i + 1');
    expect(pdfSrc).toMatch(/formatBudgetDay\(row\.day,\s*L\.dayN,\s*i \+ 1\)/);
  });
});
