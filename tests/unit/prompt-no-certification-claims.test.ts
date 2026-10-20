/**
 * 2026-10-10: 프롬프트가 모델에게 "100% halal menu" / "halal-certified" 를 쓰라고 시키던 문구 제거.
 * DB 등급 대부분이 muslim_friendly / vegan_options(인증 아님)라 이 지시가 거짓 인증 문구를 만들었다.
 * (사후 정리는 dbMatcher sanitizer. 여기는 프롬프트 원문 잠금.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, '../../api/_ai_core', f), 'utf8');
const prompt = read('buildPrompt.js');
const pipeline = read('geminiPipeline.js');

describe('prompt: no certification claims', () => {
  it('halal 프롬프트·재시도 프롬프트에 "100% halal" / "halal-certified restaurants" 가 없다', () => {
    for (const src of [prompt, pipeline]) {
      expect(src).not.toMatch(/100%\s*halal/i);
      expect(src).not.toMatch(/halal-certified restaurants/i);
    }
  });

  it('"[HALAL] 표시일 때만" 가드 문구가 있다 (일반 프롬프트·재시도 둘 다)', () => {
    expect(prompt).toMatch(/whose line is marked \[HALAL\]/);
    expect(prompt).toMatch(/not certified/);
    expect(pipeline).toMatch(/whose line is marked \[HALAL\]/);
    expect(pipeline).toMatch(/Never write "certified", "100%", or "인증" unless the restaurant line is marked \[HALAL\]/);
  });

  it('vegan 가드 + 2026-07-10 pork 금지 규칙·halal tip 요구는 유지', () => {
    expect(prompt).toMatch(/Do not call a restaurant "100% vegan"/);
    expect(pipeline).toMatch(/NEVER claim "100% vegan"/);
    expect(pipeline).toMatch(/Do NOT write the words "pork\/돼지\/삼겹" anywhere/);
    expect(pipeline).toMatch(/mention "halal" or "할랄" in the tip/);
    expect(prompt).toMatch(/include the word "halal" in the tip text/);
  });
});
