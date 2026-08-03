/**
 * daily-health "가짜 초록" 회귀 잠금 (2026-08-02).
 *
 * 잠근 사고: 플랜→번역→PDF 스모크가 `TEST-` 접두사를 계속 보내서 매 실행 403 으로 죽었는데
 *   (그 접두사는 2026-07-20 에 `api/_ai_core/paymentGate.js` 에서 폐지 — 항상 403),
 *   그 스텝에 `continue-on-error: true` 가 붙어 있어 GitHub 이 스텝을 **success** 로 보고했다.
 *   → 잡 결과도 초록, 스텝 결과도 초록. 로그를 열어야만 보였다. 7회 넘게 아무도 몰랐다.
 *
 * 두 가지를 못박는다.
 *   1) 감시 스모크 스텝에 continue-on-error 를 다시 붙이지 못한다.
 *   2) e2e 스펙이 폐지된 결제우회 접두사를 쓰지 못한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = resolve(ROOT, '.github/workflows/daily-health.yml');
const yml = readFileSync(WORKFLOW, 'utf8');

/** 워크플로를 `- name:` 단위로 쪼개 스텝별 본문을 돌려준다. */
function steps(): Array<{ name: string; body: string }> {
  const parts = yml.split(/\n\s*- name: /).slice(1);
  return parts.map((p) => ({ name: p.split('\n')[0].trim(), body: p }));
}

/** 고장을 알려야 하는 감시 스텝 — 이름에 smoke 가 들어간 것들. */
function smokeSteps() {
  return steps().filter((s) => /smoke/i.test(s.name));
}

describe('daily-health — 실패가 초록으로 덮이지 않는다', () => {
  it('감시 스모크 스텝을 실제로 찾는다', () => {
    expect(smokeSteps().length).toBeGreaterThanOrEqual(3);
  });

  it('감시 스모크 스텝에 continue-on-error 가 없다', () => {
    const hidden = smokeSteps().filter((s) => /continue-on-error:\s*true/.test(s.body)).map((s) => s.name);
    expect(hidden, `실패를 숨기는 스텝: ${hidden.join(' / ')}`).toEqual([]);
  });

  it('후속 단계가 if: always() 라 스모크가 실패해도 health-log 는 커밋된다', () => {
    // continue-on-error 를 뗀 근거 — 이게 깨지면 스모크 실패 시 로그 커밋이 건너뛰어진다.
    const commitStep = steps().find((s) => /health.?log|Upload health/i.test(s.name));
    expect(commitStep, 'health-log 관련 스텝을 못 찾음').toBeTruthy();
    expect(commitStep!.body).toMatch(/if:\s*always\(\)/);
  });
});

describe('e2e 스펙 — 폐지된 결제우회 접두사 금지', () => {
  const E2E_DIR = resolve(ROOT, 'tests/e2e');

  /** 주석을 지운 소스 — 경고 주석에 적힌 `TEST-` 를 위반으로 세지 않기 위해. */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  it('`TEST-` 접두사 orderId 를 만드는 스펙이 없다', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(E2E_DIR)) {
      if (!f.endsWith('.spec.ts') && !f.endsWith('.spec.tsx')) continue;
      const src = stripComments(readFileSync(resolve(E2E_DIR, f), 'utf8'));
      // 실제 코드의 문자열 리터럴에서 `TEST-` 로 시작하는 주문번호를 만드는 경우만 본다.
      for (const m of src.matchAll(/[`'"]TEST-[^`'"]*[`'"]/g)) {
        offenders.push(`${f}: ${m[0].slice(0, 40)}`);
      }
    }
    expect(
      offenders,
      `폐지된 접두사 사용(항상 403). ADMIN-BYPASS- 를 쓸 것: ${offenders.join(' / ')}`,
    ).toEqual([]);
  });

  it('paymentGate 가 여전히 TEST- 를 거부하고 ADMIN-BYPASS- 를 허용한다', () => {
    // 스펙만 고치고 서버가 반대로 바뀌면 또 어긋난다 — 양쪽을 같이 본다.
    const gate = readFileSync(resolve(ROOT, 'api/_ai_core/paymentGate.js'), 'utf8');
    expect(gate).toMatch(/orderId\.startsWith\('TEST-'\)/);
    expect(gate).toMatch(/orderId\.startsWith\('ADMIN-BYPASS-'\)/);
  });
});
