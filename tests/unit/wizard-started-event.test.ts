/**
 * wizard_started PostHog 이벤트 — 깔때기 상단(시작) 지표 (2026-06-12).
 *
 * 배경: 시작→생성→결제 전환율을 보려면 시작 분모가 필요한데, 위저드 진입 이벤트가
 *   없어 깔때기 상단이 비어 있었음. WizardForm 첫 마운트 시 1회 발화.
 *
 * 가드(소스 와이어링 — analytics-paid-conversion.test.ts 패턴, 순수 문자열 검사):
 *   ① posthog.ts 이벤트 유니온에 wizard_started 존재(타입 누락 회귀 방지)
 *   ② WizardForm 이 posthog track 을 import
 *   ③ WizardForm 이 mount 1회 ref 가드 + posthogTrack(wizard_started) 발화
 *      (StrictMode 이중 마운트 중복 방지 가드 포함)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const posthogSrc = readFileSync(join(root, 'src', 'lib', 'posthog.ts'), 'utf8');
const wizardSrc = readFileSync(
  join(root, 'src', 'components', 'WizardForm', 'index.tsx'),
  'utf8',
);

describe('wizard_started 이벤트 — posthog 이벤트 유니온', () => {
  it('PostHogEventName 에 wizard_started 가 등록됨', () => {
    expect(posthogSrc).toContain("| 'wizard_started'");
  });
});

describe('wizard_started 이벤트 — WizardForm 배선(dead-code 회귀 방지)', () => {
  it('posthog track 을 posthogTrack 으로 import', () => {
    expect(wizardSrc).toContain("import { track as posthogTrack } from '@/lib/posthog'");
  });

  it('mount 시 posthogTrack(wizard_started) 를 발화', () => {
    expect(wizardSrc).toContain("void posthogTrack('wizard_started', {");
  });

  it('발화 페이로드에 language 포함', () => {
    // 깔때기 코호트(언어별 전환)용 최소 속성.
    const i = wizardSrc.indexOf("posthogTrack('wizard_started'");
    expect(i).toBeGreaterThan(-1);
    expect(wizardSrc.slice(i, i + 160)).toContain("language");
  });

  it('StrictMode 이중 발화 방지용 ref early-return 가드', () => {
    expect(wizardSrc).toContain("const wizardStartedRef = useRef(false);");
    expect(wizardSrc).toContain("if (wizardStartedRef.current) return;");
    expect(wizardSrc).toContain("wizardStartedRef.current = true;");
  });
});
