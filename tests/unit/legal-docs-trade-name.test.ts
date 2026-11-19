/**
 * Legal pages name the company by its registered trade name — the same one the
 * footer shows (operator, 2026-11-20). Korean shows it alone; English, Japanese
 * and Chinese add the English name COCOTRIP after it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');
const ko = JSON.parse(read('src/i18n/locales/ko.json'));
const TRADE_NAME = String(ko.footer.company).replace(/^상호:\s*/, '');

// [file, mentions, with the English name]: 4 languages × (party clause, name line) for the
// travel terms; 4 × party clause for the terms; 4 × data controller for the privacy policy.
// Only the en/ja/zh mentions carry (COCOTRIP).
const PAGES: Array<[string, number, number]> = [
  ['src/pages/TravelTerms.tsx', 8, 6],
  ['src/pages/Terms.tsx', 4, 3],
  ['src/pages/Privacy.tsx', 4, 3],
];

describe('legal pages name the registered trade name', () => {
  it('the footer value is the registered trade name', () => {
    expect(TRADE_NAME).toBe('주식회사 코코트립');
  });

  it.each(PAGES)('%s names it in every language', (file, mentions, withEnglish) => {
    const src = read(file);
    expect(src.split(TRADE_NAME).length - 1).toBe(mentions);
    expect(src.match(new RegExp(`${TRADE_NAME} ?[(（]COCOTRIP`, 'g'))?.length).toBe(withEnglish);
    // The bare brand no longer stands in for the party, the name line or the controller.
    expect(src).not.toMatch(/COCOTRIP ?[(（](이하|hereinafter|以下)/);
    expect(src).not.toMatch(/(상호|商号|名称|Name)[:：] ?COCOTRIP/);
    expect(src).not.toMatch(/'COCOTRIP'|「COCOTRIP」|'코코트립\(COCOTRIP\)'/);
  });
});
