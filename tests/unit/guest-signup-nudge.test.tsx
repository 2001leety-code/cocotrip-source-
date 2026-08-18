// @vitest-environment jsdom
//
// 게스트 → 회원 전환 넛지 (2026-08-19, funnel audit 후속).
//
// 계약:
//   - GuestSignupNudge: 4개 언어 렌더, ja/zh 화면에 영어 텍스트 누출 없음.
//   - email prop 이 있으면 본문에 그대로 노출(신뢰 확인용), 없으면 이메일 없이도 안 깨짐.
//   - Google 버튼 클릭 → onGoogleLogin 호출. authLoading=true 면 비활성화.
//   - authError 가 있으면 화면에 노출.
//   - PayPalBookingButton.tsx 배선(소스 잠금) — firebase getAuth() 를 끌고 오므로
//     jsdom 에서 직접 import 하지 않는다. readFileSync 로 정적 텍스트만 검사.
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuestSignupNudge } from '../../src/components/GuestSignupNudge';

void React;

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

describe('GuestSignupNudge — 4개 언어 렌더', () => {
  for (const lang of LANGS) {
    it(`${lang}: 제목/버튼 텍스트가 비어있지 않다`, () => {
      render(
        <GuestSignupNudge
          language={lang}
          email="guest@example.com"
          onGoogleLogin={() => {}}
          authLoading={false}
          authError={null}
        />,
      );
      // 각 언어 dict 의 cta 문자열이 버튼에 그대로 노출.
      const CTA: Record<string, string> = {
        ko: '구글로 계속하기',
        en: 'Continue with Google',
        ja: 'Googleで続ける',
        zh: '使用Google继续',
      };
      expect(screen.getByRole('button', { name: new RegExp(CTA[lang]) })).toBeInTheDocument();
    });
  }

  it('ja 화면에 영어 CTA("Continue with Google")가 섞여 나오지 않는다', () => {
    const { container } = render(
      <GuestSignupNudge language="ja" email={null} onGoogleLogin={() => {}} authLoading={false} authError={null} />,
    );
    expect(container.textContent).not.toContain('Continue with Google');
    expect(container.textContent).not.toContain('Sign up');
    expect(container.textContent).toContain('Google');
  });

  it('zh 화면에 영어 CTA/제목이 섞여 나오지 않는다', () => {
    const { container } = render(
      <GuestSignupNudge language="zh" email={null} onGoogleLogin={() => {}} authLoading={false} authError={null} />,
    );
    expect(container.textContent).not.toContain('Continue with Google');
    expect(container.textContent).not.toContain('Sign up');
    expect(container.textContent).toContain('优惠券');
  });

  it('언어 매칭 실패(존재하지 않는 언어) → en 폴백, 빈 문자열 노출 안 함', () => {
    // Language 타입 밖의 값이 넘어와도(캐스팅 경로 방어) 깨지지 않는다.
    render(
      <GuestSignupNudge
        language={'fr' as unknown as 'en'}
        email={null}
        onGoogleLogin={() => {}}
        authLoading={false}
        authError={null}
      />,
    );
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
  });
});

describe('GuestSignupNudge — 이메일 보간', () => {
  it('email 제공 시 본문에 그대로 노출(신뢰 확인용)', () => {
    render(
      <GuestSignupNudge
        language="en"
        email="guest@example.com"
        onGoogleLogin={() => {}}
        authLoading={false}
        authError={null}
      />,
    );
    expect(screen.getByText(/guest@example\.com/)).toBeInTheDocument();
  });

  it('email 미제공 시 렌더는 그대로 되지만 이메일 문자열은 없다', () => {
    const { container } = render(
      <GuestSignupNudge language="en" email={null} onGoogleLogin={() => {}} authLoading={false} authError={null} />,
    );
    expect(container.textContent).not.toContain('@');
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
  });
});

describe('GuestSignupNudge — Google 로그인 버튼 동작', () => {
  it('클릭 시 onGoogleLogin 호출', () => {
    const onGoogleLogin = vi.fn();
    render(
      <GuestSignupNudge language="en" email={null} onGoogleLogin={onGoogleLogin} authLoading={false} authError={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(onGoogleLogin).toHaveBeenCalledTimes(1);
  });

  it('authLoading=true → 버튼 disabled, 로딩 문구로 전환', () => {
    render(
      <GuestSignupNudge language="en" email={null} onGoogleLogin={() => {}} authLoading={true} authError={null} />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('authError 가 있으면 화면에 노출', () => {
    render(
      <GuestSignupNudge
        language="en"
        email={null}
        onGoogleLogin={() => {}}
        authLoading={false}
        authError="popup closed"
      />,
    );
    expect(screen.getByText('popup closed')).toBeInTheDocument();
  });

  it('authError 없으면 에러 문단이 렌더되지 않는다', () => {
    const { container } = render(
      <GuestSignupNudge language="en" email={null} onGoogleLogin={() => {}} authLoading={false} authError={null} />,
    );
    expect(container.querySelector('.text-red-400')).toBeNull();
  });
});

// ── PayPalBookingButton 배선 — 소스 잠금 (firebase getAuth() 를 끌고 오므로 jsdom import 금지) ──
describe('PayPalBookingButton — 게스트 넛지 배선 가드', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'PayPalBookingButton.tsx'), 'utf8');

  it('GuestSignupNudge 를 import', () => {
    expect(src).toMatch(/import\s*\{\s*GuestSignupNudge\s*\}\s*from\s*'@\/components\/GuestSignupNudge'/);
  });

  it('성공 오버레이 안에서 GuestSignupNudge 를 렌더', () => {
    expect(src).toContain('<GuestSignupNudge');
  });

  it('게스트 전용 가드(!authUser)로 감싸져 있다 — 로그인 사용자에겐 렌더 안 함', () => {
    // {!authUser && ( ... <GuestSignupNudge ... ) 패턴 — 조건과 컴포넌트 사이에 다른 JSX가
    // 끼어들 수 있어 [\s\S]*? 로 non-greedy 매치.
    expect(src).toMatch(/\{!authUser\s*&&\s*\([\s\S]*?<GuestSignupNudge/);
  });

  it('handleGuestSignup 이 signInWithGoogle 을 호출(로그인 실행부는 부모가 소유)', () => {
    expect(src).toMatch(/import\s*\{\s*signInWithGoogle\s*\}\s*from\s*'@\/lib\/firebase'/);
    expect(src).toMatch(/async function handleGuestSignup\(\)[\s\S]*?await signInWithGoogle\(\)/);
  });

  it('결제 loading/error state 를 재사용하지 않는다 — 별도 signupLoading/signupError', () => {
    expect(src).toMatch(/const \[signupLoading,\s*setSignupLoading\]\s*=\s*useState/);
    expect(src).toMatch(/const \[signupError,\s*setSignupError\]\s*=\s*useState/);
  });

  it('GuestSignupNudge 는 signupLoading/signupError 를 prop 으로 받는다(결제 loading/error 아님)', () => {
    expect(src).toMatch(/<GuestSignupNudge[\s\S]*?authLoading=\{signupLoading\}/);
    expect(src).toMatch(/<GuestSignupNudge[\s\S]*?authError=\{signupError\}/);
  });
});
