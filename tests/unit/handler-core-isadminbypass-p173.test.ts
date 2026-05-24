/**
 * P173 (2026-05-24 hotfix): handlerCore.js:400 의 triggerPass3BackgroundIfPending 호출
 * 에서 `isAdminBypass` 가 shorthand 로 들어가 ReferenceError 발생 → prod 의 모든 plan
 * request 500. (handler scope 에는 `gate.isAdminBypass` 만 정의 — 231/337 줄 참고.)
 *
 * R-P171 lint rule 은 단순 substring 매칭 (`/\bisAdminBypass\b/`) 만 검사하여 shorthand
 * (`{ isAdminBypass }`) 과 explicit assignment (`{ isAdminBypass: ... }`) 구분 못함 →
 * lint pass 했으나 runtime ReferenceError. 본 source-level test 는 shorthand 패턴 직접
 * 차단.
 *
 * 메타 lesson: source-level regex lint 는 변수 scope 검사 불가 — ESLint no-undef 또는
 * 실행 기반 integration test 가 정답. 본 test 는 narrow scope fix — line 400 회귀만 차단.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P173 handlerCore.js triggerPass3BackgroundIfPending isAdminBypass scope', () => {
  const handlerCorePath = resolve(__dirname, '../../api/_ai_core/handlerCore.js');
  const source = readFileSync(handlerCorePath, 'utf8');

  it('triggerPass3BackgroundIfPending 호출 존재', () => {
    expect(/triggerPass3BackgroundIfPending\s*\(/.test(source)).toBe(true);
  });

  it('호출 인자가 explicit `isAdminBypass: <expr>` (shorthand 금지)', () => {
    // 호출 인자 추출 (단일 라인 호출 가정 — P170 backgroundPipelines 추출 후 형식)
    const callMatch = source.match(/triggerPass3BackgroundIfPending\s*\(\s*\{([^}]+)\}/);
    expect(callMatch).not.toBeNull();
    const args = callMatch![1];

    // explicit `isAdminBypass:` 필수 (shorthand 면 runtime ReferenceError — handler
    // scope 에 isAdminBypass 변수 없음, gate.isAdminBypass 만).
    expect(args).toMatch(/\bisAdminBypass\s*:/);

    // shorthand 패턴 차단 — `gate.isAdminBypass,` 같은 expression value 는 제외 (lookbehind).
    // 매칭 대상: 시작이 `,` 또는 `{` 또는 space 인 isAdminBypass 가 직후 `,` 또는 `}` 인 경우.
    expect(args).not.toMatch(/(?<![.\w])isAdminBypass\s*[,}]/);
  });

  it('source 변수 = gate.isAdminBypass (scope 안의 정의)', () => {
    // gate.isAdminBypass 가 호출 인자 안에 들어가는지 (231/337 줄과 동일 패턴)
    const callMatch = source.match(/triggerPass3BackgroundIfPending\s*\(\s*\{([^}]+)\}/);
    expect(callMatch).not.toBeNull();
    expect(callMatch![1]).toMatch(/isAdminBypass\s*:\s*!?!?gate\.isAdminBypass/);
  });
});
