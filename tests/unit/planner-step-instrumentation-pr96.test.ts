/**
 * P96 (2026-05-19) — ai-planner-full.js step-level instrumentation 회귀 차단.
 *
 * Pre-fix: api/ai-planner-full.js 가 START + TOTAL 두 로그만 출력. handler 가
 * 5분 Vercel cap 까지 hang 한 prod 인시던트에서 어느 step (Gemini Pass1/2/3,
 * RouteAgent, persistPlan) 에서 멈췄는지 prod logs 도 묵묵부답. 운영자가
 * Telegram 알림으로도 last-step 정보 없이 "ai-planner-unhandled" 만 봄.
 *
 * Post-fix:
 *   1) withStep(label, fn) helper — ENTER + DONE/FAILED elapsed 로그.
 *   2) 핵심 step (verifyAuth / paymentGate / avoidClause / gemini /
 *      routeEnrich / persistPlan) 모두 withStep 으로 wrap.
 *   3) currentStep / currentStepStart / lastUid / lastEmail handler-scoped 변수.
 *   4) HANG_WARN_MS = 270_000 setTimeout — 4분30초 도달 시 admin Telegram
 *      alert (last step + step elapsed + total elapsed + mode + uid/email).
 *      throttledTelegramAlert key 'ai-planner-hang' — 5분 window dedup (P67).
 *   5) finally clearTimeout — 정상 완료 + error path 모두에서 해제.
 *
 * Refactor 가 instrumentation 을 제거하면 다음 prod hang 인시던트도 같은
 * 진단 사각지대로 빠짐 — 본 assertion 들이 회귀를 머지 전 차단.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/ai-planner-full.js'),
  'utf8',
);

describe('P96 — ai-planner-full step-level instrumentation', () => {
  it('defines withStep helper with ENTER + DONE/FAILED elapsed logs', () => {
    expect(src).toMatch(/async function withStep\s*\(\s*label\s*,\s*fn\s*\)/);
    expect(src).toMatch(/step=\$\{label\}\s*ENTER/);
    expect(src).toMatch(/step=\$\{label\}\s*DONE\s*\$\{elapsed\}ms/);
    expect(src).toMatch(/step=\$\{label\}\s*FAILED\s*\$\{elapsed\}ms/);
  });

  it('declares handler-scoped trace vars for hangWarn alert context', () => {
    // currentStep + currentStepStart 는 hangWarn 콜백이 read.
    expect(src).toMatch(/let\s+currentStep\s*=\s*['"]init['"]/);
    expect(src).toMatch(/let\s+currentStepStart\s*=\s*handlerStart/);
    // lastUid / lastEmail 도 hangWarn message context.
    expect(src).toMatch(/let\s+lastUid\s*=\s*null/);
    expect(src).toMatch(/let\s+lastEmail\s*=\s*null/);
  });

  it('wraps the four critical await steps with withStep', () => {
    // 5분 hang 의 후보 step 들 — 각각 withStep 으로 감싸야 last-step 진단 가능.
    expect(src).toMatch(/await\s+withStep\(\s*['"]paymentGate['"]/);
    expect(src).toMatch(/await\s+withStep\(\s*['"]gemini['"]/);
    expect(src).toMatch(/await\s+withStep\(\s*['"]routeEnrich['"]/);
    expect(src).toMatch(/await\s+withStep\(\s*['"]persistPlan['"]/);
  });

  it('sets hangWarn timer at 4m30s with throttled admin alert', () => {
    // 270_000ms = 4분30초. Vercel maxDuration=300s cap 의 30초 전.
    expect(src).toMatch(/HANG_WARN_MS\s*=\s*270_000/);
    expect(src).toMatch(/setTimeout\(\s*\(?\s*\)?\s*=>[\s\S]{0,200}throttledTelegramAlert\(/);
    // dedup key 'ai-planner-hang' — 같은 hang 패턴 5분 window 내 1회.
    expect(src).toMatch(/key:\s*['"]ai-planner-hang['"]/);
    expect(src).toMatch(/channel:\s*['"]admin['"]/);
    expect(src).toMatch(/severity:\s*['"]high['"]/);
  });

  it('includes last-step + elapsed + mode + uid/email in hang alert payload', () => {
    // Telegram message 본문 + context 둘 다 last-step 노출 필요.
    expect(src).toMatch(/last step:[\s\S]{0,40}\$\{currentStep\}/);
    expect(src).toMatch(/step elapsed:[\s\S]{0,80}currentStepStart/);
    expect(src).toMatch(/total elapsed:[\s\S]{0,80}handlerStart/);
    // context 객체에도 동일 정보 (admin dashboard 분석용).
    expect(src).toMatch(/lastStep:\s*currentStep/);
    expect(src).toMatch(/elapsedTotal:\s*Date\.now\(\)\s*-\s*handlerStart/);
  });

  it('unrefs the hang timer so it does not block the event loop', () => {
    // Vercel function 이 정상 응답 후에도 timer 가 살아있으면 finalizer 까지
    // process 가 안 끝남. unref() 로 background timer 화.
    expect(src).toMatch(/hangWarnTimer\.unref/);
  });

  it('clears hangWarn timer in finally — both happy path and error path', () => {
    // finally 가 try-catch 마지막에 있어야 catch block throw 시에도 timer 해제.
    expect(src).toMatch(/\}\s*finally\s*\{[\s\S]{0,200}clearTimeout\(\s*hangWarnTimer\s*\)/);
  });

  it('keeps the original START + TOTAL summary logs (backward-compat)', () => {
    // 기존 운영자 dashboard / grep 패턴이 두 로그에 의존. instrumentation
    // 추가가 기존 로그를 제거하면 grep 안 됨.
    expect(src).toMatch(/\[planner\] === START ===/);
    expect(src).toMatch(/\[planner\] === TOTAL:/);
  });
});
