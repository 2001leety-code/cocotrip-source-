/**
 * vitest 전역 timeout 계약 — cold import 플레이크 재발 방지 가드.
 *
 * 증상: full suite 를 돌릴 때마다 서로 다른 무관한 파일(cron-auth-pr419,
 * loyalty-remediation*, tour-end-time-arrival-realtime …)이 기능 단언이 아니라
 * `Test timed out in 5000ms` 로 빨개졌다. 파일 단독 실행은 항상 통과.
 *
 * 원인: 파일의 첫 테스트가 무거운 모듈 그래프를 cold import 하는 시간이 그
 * 테스트의 timeout 예산에 포함된다. 548개 파일 병렬 fork 실행에서는 이 비용이
 * 기본 5000ms 를 넘긴다(실측: 한산 3.6s / 경합 8.2s).
 *
 * 이 파일은 vitest.config.ts 의 값이 측정 기반 범위를 벗어나면 실패한다.
 * 값을 바꾸려면 먼저 재측정하고 아래 상수의 근거를 같이 고쳐라.
 */
import { describe, it, expect } from 'vitest';
import config from '../../vitest.config';

/** 실측 최악치 8.2s(스위트 2개 동시 실행) 위. 이 아래로 내리면 플레이크가 돌아온다. */
const MIN_MS = 12_000;
/** 진짜 멈춘 테스트를 이 시간 안에는 잡아야 한다. 실네트워크 테스트가 쓰는 인라인 30s 가 상한. */
const MAX_MS = 30_000;

describe('vitest 전역 timeout SSOT', () => {
  it('testTimeout 이 명시돼 있고 측정 기반 범위 안이다', () => {
    const testTimeout = config.test?.testTimeout;
    expect(typeof testTimeout).toBe('number');
    expect(testTimeout).toBeGreaterThanOrEqual(MIN_MS);
    expect(testTimeout).toBeLessThanOrEqual(MAX_MS);
  });

  it('hookTimeout 도 같은 범위 — beforeAll/beforeEach 에서도 cold import 가 일어난다', () => {
    const hookTimeout = config.test?.hookTimeout;
    expect(typeof hookTimeout).toBe('number');
    expect(hookTimeout).toBeGreaterThanOrEqual(MIN_MS);
    expect(hookTimeout).toBeLessThanOrEqual(MAX_MS);
  });
});
