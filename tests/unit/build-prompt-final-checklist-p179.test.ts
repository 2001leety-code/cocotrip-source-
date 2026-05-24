/**
 * P179 (2026-05-24): buildPrompt 끝에 FINAL SELF-CHECK 섹션 추가 — Gemini 가
 * 출력 직전 모든 day 의 lunch/dinner 빠짐 self-check.
 *
 * 회귀 발견: telegram alert 2026-05-24 10:42 (Day 2/3 저녁 누락) + 11:26 (Day 3
 * 점심 누락). 기존 prompt strict 룰 (line 740-779) 만으로 부족 — Gemini 비결정성.
 * Final reminder 가 마지막 self-check 강제.
 *
 * 회귀 시: section 빠지면 Gemini 가 lunch/dinner 누락 빈도 증가 → validator
 * reject + retry latency 또는 일반 user throw 500.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P179 buildPrompt FINAL SELF-CHECK section', () => {
  const promptPath = resolve(__dirname, '../../api/_ai_core/buildPrompt.js');
  const src = readFileSync(promptPath, 'utf8');

  it('FINAL SELF-CHECK section header 존재 + P179 reference', () => {
    expect(src).toMatch(/FINAL SELF-CHECK BEFORE RESPONDING/);
    expect(src).toMatch(/P179/);
  });

  it('full day lunch + dinner 필수 명시', () => {
    expect(src).toMatch(/full day[\s\S]{0,200}lunch/i);
    expect(src).toMatch(/dinner slot.*17:00.*21:59/);
    expect(src).toMatch(/lunch slot.*11:00.*14:59/);
  });

  it('BAD examples (Day 2 저녁 + Day 3 점심) 명시', () => {
    expect(src).toMatch(/Day 2\s*저녁\s*누락/);
    expect(src).toMatch(/Day 3\s*점심\s*누락/);
    expect(src).toMatch(/P179[\s\S]{0,100}측정 발견/);
  });

  it('GOOD criteria — MINIMUM 2 food stops per full day', () => {
    expect(src).toMatch(/MINIMUM\s*2\s*food stops/i);
  });

  it('도착일 + 출국일 B-MEAL 룰 (P137) reference', () => {
    expect(src).toMatch(/Day 1[\s\S]{0,200}breakfast.*lunch.*snack.*dinner/);
    expect(src).toMatch(/P137|departure_time/);
  });
});
