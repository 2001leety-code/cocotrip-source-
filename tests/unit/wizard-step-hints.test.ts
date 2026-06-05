/**
 * #wizard-step-hints (2026-06-05, 운영자 #3): 위저드 스텝별 친절 설명 회귀 가드.
 *
 * 운영자: "각 ai플랜 스텝마다 설명글 팝업 — 지금 한번에 띄우는데 다른 사이트보니 친절하게".
 * → AIIntroModal(전체 3단계 한번에) 외에, 각 스텝(예약→도시→음식→상세→생성)에 비차단 배너.
 *
 * 회귀 방지: 4언어 파리티(누락 시 영문 노출) + WizardForm 통합 + 카피 길이(타사 ≤180자).
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — 형제 모듈 (vitest 경로)
import { WIZARD_STEP_HINTS, normalizeHintLang } from '../../src/components/WizardForm/stepHints';
import { readFileSync } from 'fs';
import { join } from 'path';

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

describe('#wizard-step-hints — 스텝별 친절 설명', () => {
  it('5개 스텝(0~4) 전부 존재', () => {
    for (let s = 0; s <= 4; s++) expect(WIZARD_STEP_HINTS[s], `step ${s}`).toBeDefined();
  });

  it('모든 스텝 × 4언어 title/body 비어있지 않음 (4-lang 파리티)', () => {
    for (let s = 0; s <= 4; s++) {
      const h = WIZARD_STEP_HINTS[s];
      for (const lang of LANGS) {
        expect(h.title[lang]?.trim().length, `step${s} title ${lang}`).toBeGreaterThan(0);
        expect(h.body[lang]?.trim().length, `step${s} body ${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it('body 카피는 ≤180자 (타사 UX 가이드 — 1~2문장, 부담 없게)', () => {
    for (let s = 0; s <= 4; s++) {
      for (const lang of LANGS) {
        expect(WIZARD_STEP_HINTS[s].body[lang].length, `step${s} ${lang}`).toBeLessThanOrEqual(180);
      }
    }
  });

  it('normalizeHintLang — 미지원 언어/undefined 는 en 폴백', () => {
    expect(normalizeHintLang('ko')).toBe('ko');
    expect(normalizeHintLang('ja')).toBe('ja');
    expect(normalizeHintLang('zh')).toBe('zh');
    expect(normalizeHintLang('en')).toBe('en');
    expect(normalizeHintLang('fr')).toBe('en');
    expect(normalizeHintLang(undefined)).toBe('en');
  });

  it('WizardForm 이 WizardStepHint 를 현재 step 으로 렌더 (통합 회귀)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/WizardForm/index.tsx'), 'utf-8');
    expect(src).toMatch(/import \{ WizardStepHint \}/);
    expect(src).toMatch(/<WizardStepHint step=\{step\}/);
  });
});
