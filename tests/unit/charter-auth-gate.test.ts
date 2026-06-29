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

describe('CRITICAL-2 회귀 — 차터 resume 결제 게이트 우회 차단 (2026-06-29)', () => {
  const src = readFileSync(r('src/components/charter/CharterWizard.tsx'), 'utf8');
  it('case 6(결제 진입)에 consent 게이트 — phoneSmsVerified/termsAgreed 재검증', () => {
    // case 5 에만 있던 consent 게이트가 case 6 에도 있어야 resume→Step6 직행 우회 차단.
    const case6 = src.match(/case 6:\s*\{[\s\S]*?\n {6}\}/);
    expect(case6, 'case 6 블록').toBeTruthy();
    expect(case6![0]).toMatch(/!phoneSmsVerified \|\| !termsAgreed/);
  });
  it('handleResumeContinue 가 Step6 복원 금지 — Math.min(5, ...) 로 클램프', () => {
    // consent 는 비저장이라 resume 시 false → Step6 복원하면 사용자 혼란. Step5 로 클램프.
    expect(src).toMatch(/Math\.min\(5,\s*initialSnapStep\)/);
    expect(src).not.toMatch(/Math\.min\(6,\s*initialSnapStep\)/);
  });
});

describe('CRITICAL-1 회귀 — 투어 메신저 배선 + memo (2026-06-29)', () => {
  const dialog = readFileSync(r('src/components/tours/TourBookingDialog.tsx'), 'utf8');
  const validation = readFileSync(r('src/components/tours/tourBookingValidation.ts'), 'utf8');
  it('messenger 단일 state + 세터 (read-only whatsappId/lineId 버그 재발 금지)', () => {
    expect(dialog).toMatch(/const \[messenger, setMessenger\] = useState/);
    // 구 read-only 패턴(세터 없는 useState 로 whatsappId/lineId 보유)이 부활하면 안 됨.
    expect(dialog).not.toMatch(/const \[whatsappId\] = useState/);
    expect(dialog).not.toMatch(/const \[lineId\] = useState/);
  });
  it('onFieldsChange 가 messenger 배선 (d.messengerId → setMessenger)', () => {
    expect(dialog).toMatch(/if \(d\.messengerId\) setMessenger/);
  });
  it('fullMemo 가 단일 Messenger 라인 (WhatsApp:/LINE: 2줄 누락 버그 재발 금지)', () => {
    expect(dialog).toContain('`Messenger: ${messenger}`');
    expect(dialog).not.toContain('`WhatsApp: ${whatsappId}`');
  });
  it('isTourStep2Complete 게이트가 messenger 요구 (못 채우는 whatsapp|line 제거)', () => {
    expect(validation).toMatch(/fields\.messenger\.trim\(\)\.length > 0/);
    expect(validation).not.toMatch(/fields\.whatsappId/);
  });
});
