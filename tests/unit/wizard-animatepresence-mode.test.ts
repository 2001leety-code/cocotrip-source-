/**
 * 위저드 step 전환 깜빡임 회귀 가드 (2026-06-02, A3 딥서치 — "이어서 하기" 새로고침/깜빡임).
 *
 * WizardForm step 전환 AnimatePresence 는 mode="wait" 여야 함. 없으면(sync 기본) 나가는 step 과
 * 들어오는 step 이 동시 렌더돼 깜빡임/밀림. App.tsx 라우트 전환부(이미 mode="wait")와 일관.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('WizardForm AnimatePresence — mode="wait" (깜빡임 방지)', () => {
  it('step 전환 AnimatePresence 에 mode="wait" 존재', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/WizardForm/index.tsx'), 'utf-8');
    expect(src).toMatch(/<AnimatePresence\s+mode="wait"/);
  });
  it('mode 없는 raw <AnimatePresence initial 패턴 부재 (회귀)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/WizardForm/index.tsx'), 'utf-8');
    // mode="wait" 가 빠진 채 initial 만 있는 AnimatePresence 가 없어야 함
    expect(src).not.toMatch(/<AnimatePresence\s+initial=\{false\}>/);
  });

  it('step preload — STEP_IMPORTS + idle preload 존재 (깜빡임 완성, A3 후보2)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/WizardForm/index.tsx'), 'utf-8');
    expect(src).toMatch(/STEP_IMPORTS/);
    expect(src).toMatch(/requestIdleCallback/);
  });

  it('#resume-instant — "이어서" 점프 시 애니 억제(noStepAnim) 제자리 즉시 복원 (강제 새로고침 느낌 제거)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/WizardForm/index.tsx'), 'utf-8');
    // 점프 시 transition duration 0 + initial false 로 exit/enter 빈틈 없이 즉시.
    expect(src).toMatch(/duration:\s*noStepAnim\s*\?\s*0\s*:/);
    expect(src).toMatch(/initial=\{noStepAnim\s*\?\s*false\s*:/);
    // applyResumeSnapshot 이 직접 setStep 하지 않고 jumpToStep 으로 1틱 지연 (현재 step 먼저 instant 재렌더).
    expect(src).toMatch(/setJumpToStep\(pendingStep\)/);
    // mode="wait" 는 유지(다른 깜빡임 회귀 가드) — 점프만 0ms 로.
    expect(src).toMatch(/<AnimatePresence\s+mode="wait"/);
  });
});
