// @vitest-environment jsdom
//
// 예산표(Daily Budget Summary) 날짜 라벨 4-lang 회귀 슬롯 (2026-08-09).
//
// Pre-fix: BudgetTable.tsx / pdfGenerator.ts 가 `{ui.budgetDay} {row.day}` 로
// 라벨과 숫자를 그대로 이어붙였다. 사전값이 언어별로 형태가 달라 결과가 깨졌다.
//   - zh: budgetDay = "第{n}天"  → 열 제목에 "第{n}天" 자리표시자 그대로 노출,
//         행 값은 "第{n}天 1" 로 자리표시자 + 숫자가 중복 노출.
//   - ja: budgetDay = "日目"     → "日目 1" (일본어 어순은 "1日目").
//   - ko/en 만 우연히 자연스러웠다.
//
// Post-fix: 순수 포맷터 `formatBudgetDay(day, template)` 가 언어별 문법을
// 사전 템플릿(`planDetail.ui.budgetDayN`, "{n}" 포함)에서 읽어 조립한다.
// 열 제목은 숫자가 없는 명사 키(`planDetail.ui.budgetDay`)를 쓰고
// 자리표시자를 포함하지 않는다. 웹 표와 PDF 가 같은 포맷터를 공유한다.
//
// 이 파일이 깨지면: 중국어 사용자에게 "{n}" 이 다시 노출되거나, 일본어 어순이
// 다시 뒤집혔거나, 웹/PDF 라벨이 갈라진 것이다.
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

void React;

const state = vi.hoisted(() => ({ lang: 'en', dict: {} as Record<string, unknown> }));

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: state.lang, t: state.dict, changeLanguage: () => {} }),
}));

const DICTS = { en, ko, ja, zh } as Record<string, Record<string, unknown>>;

/** planDetail.ui 사전 (언어별). */
function ui(lang: string): Record<string, string> {
  const pd = DICTS[lang].planDetail as Record<string, unknown>;
  return pd.ui as Record<string, string>;
}

const BUDGET = [
  { day: 1, transport_krw: 12000, entry_fees_krw: 5000, meals_krw: 30000, total_krw: 47000 },
  { day: 2, transport_krw: 8000, entry_fees_krw: 3000, meals_krw: 25000, total_krw: 36000 },
];

function renderBudget(lang: string) {
  state.lang = lang;
  state.dict = DICTS[lang];
  return render(<BudgetTable budget={BUDGET} tMoney={20000} />);
}

describe('formatBudgetDay — 언어별 문법으로 조립', () => {
  it('en → "Day 1" (라벨 먼저)', () => {
    expect(formatBudgetDay(1, ui('en').budgetDayN)).toBe('Day 1');
  });

  it('ko → "1일차" (숫자 먼저)', () => {
    expect(formatBudgetDay(1, ui('ko').budgetDayN)).toBe('1일차');
  });

  it('ja → "1日目" — "日目 1" 어순 역전 금지', () => {
    const label = formatBudgetDay(1, ui('ja').budgetDayN);
    expect(label).toBe('1日目');
    expect(label).not.toBe('日目 1');
  });

  it('zh → "第1天" — "{n}" 자리표시자가 결과에 남지 않는다', () => {
    const label = formatBudgetDay(1, ui('zh').budgetDayN);
    expect(label).toBe('第1天');
    expect(label).not.toContain('{n}');
    expect(label).not.toContain('{');
  });

  it('여러 날짜에도 숫자만 바뀐다 (zh 3일차)', () => {
    expect(formatBudgetDay(3, ui('zh').budgetDayN)).toBe('第3天');
    expect(formatBudgetDay(3, ui('ja').budgetDayN)).toBe('3日目');
  });

  it('템플릿 없음 → 영어 폴백 "Day 3" (undefined 문자열 노출 금지)', () => {
    expect(formatBudgetDay(3)).toBe('Day 3');
    expect(formatBudgetDay(3, '')).toBe('Day 3');
  });

  it('"{n}" 없는 legacy 사전값을 받아도 이어붙이지 않는다', () => {
    // 구 사전(명사만)을 넘겨도 "日目 2" / "일차 2" 같은 깨진 어순을 만들지 않는다.
    expect(formatBudgetDay(2, '日目')).not.toContain('日目 2');
    expect(formatBudgetDay(2, '일차')).not.toContain('일차 2');
  });
});

describe('4개 언어 사전 — 자리표시자 계약', () => {
  for (const lang of ['en', 'ko', 'ja', 'zh']) {
    it(`${lang}: budgetDay(열 제목)에는 자리표시자가 없다`, () => {
      expect(ui(lang).budgetDay).toBeTruthy();
      expect(ui(lang).budgetDay).not.toContain('{');
    });

    it(`${lang}: budgetDayN(행 값 템플릿)에는 {n} 이 정확히 있다`, () => {
      expect(ui(lang).budgetDayN).toContain('{n}');
    });
  }
});

describe('BudgetTable 화면 렌더 — 4개 언어', () => {
  it('zh — 열 제목 "天", 행 "第1天"/"第2天", 화면 어디에도 "{n}" 없음', () => {
    const { container } = renderBudget('zh');
    expect(screen.getByText('天')).toBeInTheDocument();
    expect(screen.getByText('第1天')).toBeInTheDocument();
    expect(screen.getByText('第2天')).toBeInTheDocument();
    expect(container.textContent).not.toContain('{n}');
  });

  it('ja — 행이 "1日目" (어순 역전 "日目 1" 아님)', () => {
    const { container } = renderBudget('ja');
    expect(screen.getByText('1日目')).toBeInTheDocument();
    expect(screen.getByText('2日目')).toBeInTheDocument();
    expect(container.textContent).not.toContain('日目 1');
  });

  it('ko — 행이 "1일차"', () => {
    renderBudget('ko');
    expect(screen.getByText('1일차')).toBeInTheDocument();
    expect(screen.getByText('2일차')).toBeInTheDocument();
  });

  it('en — 행이 "Day 1"', () => {
    renderBudget('en');
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByText('Day 2')).toBeInTheDocument();
  });
});

describe('PDF — 화면과 같은 포맷터를 쓴다', () => {
  const pdfSrc = readFileSync(
    resolve(process.cwd(), 'src/pages/PlanDetailPage/pdfGenerator.ts'),
    'utf8',
  );

  it('pdfGenerator 가 formatBudgetDay 를 import 해서 쓴다', () => {
    expect(pdfSrc).toContain('formatBudgetDay');
    expect(pdfSrc).toContain("from './lib/budgetDayLabel'");
  });

  it('pdfGenerator 에 라벨+숫자 이어붙이기가 남아있지 않다', () => {
    expect(pdfSrc).not.toContain('${L.day} ${row.day}');
  });

  it('BudgetTable 에도 이어붙이기가 남아있지 않다', () => {
    const tableSrc = readFileSync(
      resolve(process.cwd(), 'src/pages/PlanDetailPage/components/BudgetTable.tsx'),
      'utf8',
    );
    expect(tableSrc).toContain('formatBudgetDay');
    expect(tableSrc).not.toContain('{ui.budgetDay || \'Day\'} {row.day}');
  });
});
