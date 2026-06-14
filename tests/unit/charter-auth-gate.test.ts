/**
 * 차터 로그인 게이트 — 비로그인도 1~5단계 견적 입력은 가능, 6단계(견적) 진입 시 로그인 (2026-06-14).
 *
 * 광고 트래픽이 로그인 벽에 안 튕기게 라우트 게이트 제거 + 견적 보기 직전(5→6) 로그인으로 이동
 * (리드 캡처 + 봇/저관심 거름). 결제는 백엔드가 미로그인 401 로 일관 차단.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const r = (p: string) => resolve(process.cwd(), p);

describe('차터 라우트 — 비로그인 접근 허용', () => {
  const app = readFileSync(r('src/App.tsx'), 'utf8');
  it('/charter 라우트가 AuthRequired 로 감싸지지 않음', () => {
    // /charter 블록 = path="/charter" 부터 다음 라우트(/charter-new) 직전까지
    const m = app.match(/path="\/charter"([\s\S]*?)path="\/charter-new"/);
    expect(m, '/charter 라우트 블록').toBeTruthy();
    const block = m![1];
    expect(block).toContain('CharterNewPage');
    expect(block).not.toContain('AuthRequired');
  });
});

describe('CharterWizard — 6단계(견적) 진입 로그인 게이트', () => {
  const src = readFileSync(r('src/components/charter/CharterWizard.tsx'), 'utf8');
  it('5→6 전환 시 비로그인이면 Google 로그인 (goNext 게이트)', () => {
    expect(src).toContain('useAuth');
    expect(src).toContain('signInWithGoogle');
    expect(src).toMatch(/currentStep === 5 && !user[\s\S]{0,80}signInWithGoogle/);
  });
  it('5단계 [다음] 버튼이 비로그인 시 "견적 보려면 로그인" 라벨 (4언어)', () => {
    expect(src).toContain('LOGIN_QUOTE_LABEL');
    for (const lang of ['en', 'ko', 'ja', 'zh']) expect(src).toContain(`${lang}:`);
    expect(src).toMatch(/currentStep === 5 && !user \? \(LOGIN_QUOTE_LABEL/);
  });
  it('nullish 연산자 미사용(내 게이트 코드) — || 폴백', () => {
    expect(src).toContain('LOGIN_QUOTE_LABEL[language] || LOGIN_QUOTE_LABEL.en');
  });
});
