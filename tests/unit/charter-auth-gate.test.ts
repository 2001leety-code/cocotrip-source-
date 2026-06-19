/**
 * 차터 게스트 견적 — 비로그인도 1~6단계(견적)까지 전부 가능 (2026-06-19 운영자 B 결정).
 *
 * 광고 트래픽이 로그인 벽에 안 튕기게: 옛 5→6 하드 로그인 게이트 제거 → 비로그인도 견적 본다.
 * 강제 리드캡처 대신 6단계 "가입하면 최대 10% 할인" 소프트 유도 카드.
 * ("가입유도는 하되 게스트는 가능하게" 방침. 곱연산 실제 ~9.75% → '최대 10%' 정직 표기 #968)
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

describe('CharterWizard — 게스트 견적 허용 + 가입 유도 카드 (운영자 B)', () => {
  const src = readFileSync(r('src/components/charter/CharterWizard.tsx'), 'utf8');
  it('하드 로그인 게이트 제거 — goNext 가 5→6 전환 시 강제 로그인 안 함', () => {
    // 옛 게이트(currentStep === 5 && !user → signInWithGoogle) 가 사라졌어야 함.
    expect(src).not.toMatch(/currentStep === 5 && !user[\s\S]{0,80}signInWithGoogle/);
    // 옛 로그인 라벨 records 제거됨.
    expect(src).not.toContain('LOGIN_QUOTE_LABEL');
  });
  it('6단계 견적에 가입 유도 카드 — 비로그인(!user)일 때만 + signInWithGoogle 재사용', () => {
    expect(src).toContain('useAuth');
    expect(src).toContain('signInWithGoogle');
    expect(src).toContain('CARROT_TITLE');
    expect(src).toContain('CARROT_CTA');
    expect(src).toContain('{!user && (');
  });
  it('할인 문구 4언어 + "최대 10%" 정직 표기 (곱연산 ~9.75% → 정확히 10% 금지, #968)', () => {
    for (const lang of ['en', 'ko', 'ja', 'zh']) expect(src).toContain(`${lang}:`);
    expect(src).toContain('최대 10%');
    expect(src).toContain('up to 10%');
  });
  it('nullish 미사용 — || 폴백 (CARROT_TITLE[language] || CARROT_TITLE.en)', () => {
    expect(src).toContain('CARROT_TITLE[language] || CARROT_TITLE.en');
  });
});
