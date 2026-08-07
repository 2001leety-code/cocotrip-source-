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
import { SMOKE_STEP_NAME, MAX_AGE_DAYS, newestSmokeAttempt } from '../../scripts/check-plan-smoke-freshness.mjs';

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

/**
 * 월요일 플랜 스모크가 조용히 0회가 되지 못하게 잠근다 (2026-08-07, #1216 후속).
 *
 * 잠근 사고: 월(1)/수·금(3,5) cron 분리 머지(8/3 01:24Z)가 월요일 00:00Z 틱의 지연
 *   처리와 겹치며 8/3 월요일 실행이 통째로 유실됐다. 수·금 실행은 스모크 스텝을
 *   skip(초록)으로 지나가 "가장 비싼 무인 감시가 0회" 를 아무도 몰랐다. 게다가 게이트가
 *   `github.event.schedule == '0 0 * * 1'` 문자열 비교라 schedule 목록과 묶이지 않은
 *   사본이었다 — cron 만 바뀌면 게이트가 조용히 영원-false 가 되는 잠복 병.
 */
describe('daily-health — 월요일 플랜 스모크가 조용히 유실되지 않는다', () => {
  it('cron 은 검증된 단일 리터럴 하나뿐이다', () => {
    const crons = [...yml.matchAll(/- cron:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(crons, '분리 cron 이 되살아났다 — 8/3 유실 사고 회귀').toEqual(['0 0 * * 1,3,5']);
  });

  it('어떤 스텝도 github.event.schedule 문자열 비교로 게이트하지 않는다', () => {
    // schedule 리터럴의 두 번째 사본은 원본과 묶이지 않는다 — cron 이 바뀌면 조용히 죽는다.
    expect(yml.includes('github.event.schedule'), 'cron 문자열 사본 게이트 부활').toBe(false);
  });

  it('월요일 판정은 실행 시각(weekday 스텝)으로 하고 스모크 게이트가 그 출력을 쓴다', () => {
    const weekday = steps().find((s) => /Resolve weekday/i.test(s.name));
    expect(weekday, 'weekday 판정 스텝을 못 찾음').toBeTruthy();
    expect(weekday!.body).toMatch(/date -u \+%u/);
    const smoke = steps().find((s) => s.name.startsWith('E2E PROD smoke'));
    expect(smoke, '플랜 스모크 스텝을 못 찾음').toBeTruthy();
    expect(smoke!.body).toMatch(/steps\.weekday\.outputs\.dow == '1'/);
    // 수동 실행은 계속 항상 돈다 — 사람이 일부러 누른 것이므로.
    expect(smoke!.body).toMatch(/github\.event_name == 'workflow_dispatch'/);
  });

  it('신선도 감시견 스텝이 스케줄 실행마다 돈다', () => {
    const watchdog = steps().find((s) => /freshness watchdog/i.test(s.name));
    expect(watchdog, '감시견 스텝을 못 찾음').toBeTruthy();
    expect(watchdog!.body).toMatch(/check-plan-smoke-freshness\.mjs/);
    expect(watchdog!.body).toMatch(/github\.event_name == 'schedule'/);
    // 이름에 smoke 가 들어가므로 위 continue-on-error 금지 검사에도 자동 포함된다.
    expect(/smoke/i.test(watchdog!.name)).toBe(true);
  });
});

describe('플랜 스모크 신선도 감시견 — 판정 로직', () => {
  const DAY = 86_400_000;
  const NOW = Date.parse('2026-08-07T02:30:00Z');
  const run = (agoDays: number, conclusion: string | null) => ({
    created_at: new Date(NOW - agoDays * DAY).toISOString(),
    steps: [{ name: SMOKE_STEP_NAME, conclusion }],
  });

  it('스텝 이름이 워크플로와 글자까지 같다 (파리티) — 이름이 갈리면 감시견이 장님이 된다', () => {
    const smoke = steps().find((s) => s.name.startsWith('E2E PROD smoke'));
    expect(smoke!.name).toBe(SMOKE_STEP_NAME);
  });

  it('오늘 시도(자기 자신 포함)가 있으면 신선하다', () => {
    const hit = newestSmokeAttempt([run(0.1, 'success'), run(2, 'skipped')], NOW);
    expect(hit).not.toBeNull();
    expect(hit!.ageDays).toBeLessThan(MAX_AGE_DAYS);
  });

  it('skip 만 이어지면 시도로 치지 않는다 — 8/3 사고의 모양', () => {
    // 수·금 실행은 스텝이 skipped 로 초록이었다. 마지막 실제 시도는 11일 전(7/27).
    const hit = newestSmokeAttempt([run(0.1, 'skipped'), run(2, 'skipped'), run(11, 'success')], NOW);
    expect(hit).not.toBeNull();
    expect(hit!.ageDays, '8/3 유실 사고 모양을 빨갛게 판정해야 한다').toBeGreaterThan(MAX_AGE_DAYS);
  });

  it('시도가 아예 없으면 null — 호출부가 fail 로 처리한다', () => {
    expect(newestSmokeAttempt([run(1, 'skipped'), { created_at: new Date(NOW).toISOString(), steps: [] }], NOW)).toBeNull();
  });

  it('실패한 시도도 시도다 — 성공만 세면 "실패 중" 과 "안 돎" 을 구분 못 한다', () => {
    const hit = newestSmokeAttempt([run(1, 'failure')], NOW);
    expect(hit).not.toBeNull();
    expect(hit!.conclusion).toBe('failure');
    expect(hit!.ageDays).toBeLessThan(MAX_AGE_DAYS);
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
