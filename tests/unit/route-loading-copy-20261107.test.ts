import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expected = {
  ko: '이동 경로 계산 중...',
  en: 'Calculating routes...',
  ja: '移動ルート計算中...',
  zh: '正在计算路线...',
};

describe('pending route calculation copy', () => {
  it.each(Object.entries(expected))('%s does not attribute an unobserved routing provider', (lang, label) => {
    const planner = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8')).planner;
    expect(planner.loading_step3).toBe(label);
    expect(planner.loading_step3).not.toMatch(/Naver|ODsay|TMAP/i);
  });
});
