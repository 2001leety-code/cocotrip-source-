import { describe, expect, it } from 'vitest';
import type { Language } from '@/i18n';
import { adminAiOpsCopy } from '@/lib/adminAiOpsCopy';

const languages: Language[] = ['ko', 'en', 'ja', 'zh'];
const samples: Record<string, Array<string | number | boolean>> = {
  updatedAt: ['2026-09-07 17:00'],
  ageHours: [5],
  ageDays: [3],
  urgentCount: [11],
  upcomingCount: [31],
  inquiryCounts: [5, 3],
  count: [31],
  moreWork: [11],
  shown: [10, 31],
  moreReservations: [31],
  sourceFailures: [3],
  sourceCount: [180, true],
  sourceDetail: [180, 3],
  staleDetail: ['2026-09-07 17:00'],
};

describe('AI operations center copy', () => {
  it('provides exactly the four supported screen languages', () => {
    expect(Object.keys(adminAiOpsCopy).sort()).toEqual([...languages].sort());
  });

  it.each(languages)('%s has the same keys, value types and nested status labels', (language) => {
    const reference = adminAiOpsCopy.ko;
    const copy = adminAiOpsCopy[language];
    expect(Object.keys(copy).sort()).toEqual(Object.keys(reference).sort());
    for (const key of Object.keys(reference) as Array<keyof typeof reference>) {
      const value = copy[key];
      expect(typeof value, key).toBe(typeof reference[key]);
      if (typeof value === 'string') {
        // English summary cards show a bare count; count() handles singular/plural elsewhere.
        if (key !== 'countUnit' || language !== 'en') expect(value.trim(), key).not.toBe('');
      } else if (typeof value === 'object') {
        expect(Object.keys(value).sort(), key).toEqual(Object.keys(reference[key]).sort());
        for (const label of Object.values(value)) expect(label.trim(), key).not.toBe('');
      }
    }
    expect(Object.keys(copy.priorityLabels)).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(Object.keys(copy.automationLabels)).toEqual(['ok', 'attention', 'retrying', 'off', 'unknown', 'unlinked']);
    expect(Object.keys(copy.reservationLabels)).toEqual([
      'confirmed', 'completed', 'awaiting_verification', 'pending', 'refunded', 'canceled', 'cancelled',
    ]);
  });

  it.each(languages)('%s renders every dynamic copy function with the supplied counts or timestamp', (language) => {
    const entries = Object.entries(adminAiOpsCopy[language]).filter(([, value]) => typeof value === 'function');
    expect(entries.map(([key]) => key).sort()).toEqual(Object.keys(samples).sort());
    for (const [key, value] of entries) {
      const render = value as (...args: Array<string | number | boolean>) => string;
      const args = samples[key];
      const output = render(...args);
      expect(typeof output, key).toBe('string');
      expect(output.trim(), key).not.toBe('');
      for (const argument of args) {
        if (typeof argument !== 'boolean') expect(output, key).toContain(String(argument));
      }
      expect(output, key).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
  });

  it.each(languages)('%s distinguishes loading, completed, failed and not-yet-refreshed states', (language) => {
    const copy = adminAiOpsCopy[language];
    expect(new Set([copy.refreshing, copy.refreshComplete, copy.refreshFailed, copy.refreshPending]).size).toBe(4);
    expect(copy.staleTitle).not.toBe(copy.loadErrorTitle);
    expect(copy.staleDetail('17:00')).toContain('17:00');
    expect(copy.partialErrorTitle).not.toBe(copy.workEmpty);
    expect(copy.workEmptyDetail).not.toBe('');
  });

  it.each(languages)('%s keeps zero counts, source truncation and full-list progress explicit', (language) => {
    const copy = adminAiOpsCopy[language];
    expect(copy.count(0)).toContain('0');
    expect(copy.sourceCount(180, true)).toContain('180+');
    expect(copy.sourceCount(180, false)).not.toContain('+');
    expect(copy.shown(10, 11)).toContain('10');
    expect(copy.shown(10, 11)).toContain('11');
    expect(copy.moreWork(1)).toContain('1');
    expect(copy.moreReservations(1)).toContain('1');
    expect(copy.allShown).not.toBe(copy.moreWork(0));
  });

  it('retains the clarified Korean period and stale-data warning', () => {
    const copy = adminAiOpsCopy.ko;
    expect(copy.week).toBe('오늘 + 7일');
    expect(copy.weekDescription).toBe('오늘과 이후 7일을 포함합니다.');
    expect(copy.upcomingCount(11)).toBe('오늘 + 7일 11건');
    expect(copy.staleTitle).toBe('갱신 실패 — 이전 자료를 표시합니다');
    expect(copy.staleDetail('17:00')).toContain('최신 상태가 아닐 수 있습니다');
    expect(copy.moreWork(1)).toBe('1건 더 보기');
    expect(copy.allShown).toBe('전체 표시 중');
  });

  it('provides a localized screen-language label and valid locale in every language', () => {
    expect(languages.map((language) => adminAiOpsCopy[language].language)).toEqual([
      '화면 언어', 'Screen language', '表示言語', '界面语言',
    ]);
    for (const language of languages) {
      expect(() => new Intl.DateTimeFormat(adminAiOpsCopy[language].locale)).not.toThrow();
    }
  });

  it('uses singular and plural English item labels without appending a fixed plural unit', () => {
    expect(adminAiOpsCopy.en.count(1)).toBe('1 item');
    expect(adminAiOpsCopy.en.count(2)).toBe('2 items');
    expect(adminAiOpsCopy.en.sourceCount(1, false)).toBe('1 item');
    expect(adminAiOpsCopy.en.sourceCount(1, true)).toBe('1+ items');
    expect(adminAiOpsCopy.en.countUnit).toBe('');
  });
});
