/**
 * P100 (2026-05-19) — Charter multi-day pricing silent bug 회귀 차단.
 *
 * Pre-fix: `api/createPaypalOrder.js` 의 `resolveKrwAmount(productType, passengers)`
 * 가 durationDays 인자 자체를 받지 않음. CHARTER_MAP 매칭 시 1-day daily price 만
 * 반환. Frontend WizardForm 이 multi_day service 로 5-day charter 결제 시도하면
 * backend 가 1-day 가격 PayPal order 생성 → 사용자 PayPal 에서 1-day 가격 결제 →
 * 운영자 4-day 무료 서비스 (Seoul 5-day = 1,320,000 KRW 손해/건).
 *
 * 발견 경로: 2026-05-19 상용화 직전 prod admin bypass 점검
 * (`scripts/measure-3-product-scenarios.mjs`) — Charter 5일 / 1일 둘 다 동일
 * KRW 330,000 응답. 코드 분석 후 resolveKrwAmount 시그너처 누락 확인.
 *
 * Post-fix:
 *   1) `resolveKrwAmount(productType, passengers, durationDays)` 시그너처 추가
 *   2) CHARTER_MAP 매칭 시 `dailyPrice * days` (days = clamp(1, 30))
 *   3) handler 가 `body.durationDays` 전달
 *   4) ai_planner_full / kpop_shuttle / combo / airport_transfer 는 그대로
 *      (1-call price — durationDays 무관)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/createPaypalOrder.js'),
  'utf8',
);

describe('P100 — Charter multi-day pricing', () => {
  it('resolveKrwAmount 시그너처에 durationDays 인자 포함 (+ 2026-06-30 vehicle 4번째 인자)', () => {
    expect(src).toMatch(/function\s+resolveKrwAmount\s*\(\s*productType\s*,\s*passengers\s*,\s*durationDays\s*,\s*vehicle\s*\)/);
  });

  it('handler 가 body.durationDays + body.vehicle 를 resolveKrwAmount 로 전달', () => {
    // 2026-06-30: 캡틴프리미엄(7인승 +33,000) 가산 위해 vehicle 4번째 인자 추가.
    expect(src).toMatch(/resolveKrwAmount\(\s*productType\s*,\s*passengers\s*,\s*durationDays\s*,/);
    expect(src).toMatch(/body\.vehicle/);
  });

  it('CHARTER_MAP 매칭 시 daily price × days 곱셈', () => {
    // dailyPrice * days 패턴 — return statement.
    expect(src).toMatch(/dailyPrice\s*\*\s*days/);
  });

  it('durationDays clamp: 1~30 + Math.floor + NaN 대응', () => {
    // sanity: 음수/0/거대 값/undefined 차단 → fallback 1-day.
    expect(src).toMatch(/Number\.isFinite\(\s*durationDays\s*\)/);
    expect(src).toMatch(/Math\.min\(\s*30\s*,\s*Math\.floor\(\s*durationDays\s*\)\s*\)/);
  });

  it('ai_planner_full 은 durationDays 무관 fixed AI_PLANNER_FULL_KRW', () => {
    // 디지털 상품 — multi-day 곱셈 적용 X.
    expect(src).toMatch(/normalized\s*===\s*['"]ai_planner_full['"][\s\S]{0,80}AI_PLANNER_FULL_KRW/);
  });

  it('kpop_shuttle 은 passengers 곱셈만 (durationDays X)', () => {
    // 2026-06-13: passengers 정규화(Math.floor(Number(passengers)…)) 추가 — 여전히
    // passengers 곱셈(durationDays 무관)이고 소수/음수 과소청구만 차단.
    expect(src).toMatch(/kpop_shuttle_oneway[\s\S]{0,260}Math\.floor\(Number\(passengers\)[\s\S]{0,160}price_one_way/);
  });

  it('회귀 방지: durationDays 누락 시그너처 부재 + vehicle 4번째 인자 포함', () => {
    // 단순 `resolveKrwAmount(productType, passengers)` 만 있는 호출은 회귀.
    // 2026-06-30: 캡틴프리미엄 위해 4번째 vehicle 인자 추가 → 호출 인자 4개(productType, passengers, durationDays, vehicle…).
    // `= resolveKrwAmount(...)`(단순) 또는 `: resolveKrwAmount(...)`(삼항 else). 정의 라인(function …)은 제외.
    const handlerCallMatch = src.match(/[=:]\s*resolveKrwAmount\(([^)]+)\)/);
    expect(handlerCallMatch).not.toBeNull();
    const args = (handlerCallMatch![1] || '').split(',').map(s => s.trim());
    expect(args.length).toBe(4); // productType, passengers, durationDays, vehicle
    expect(args[2]).toBe('durationDays');
    expect(args[3]).toMatch(/vehicle/i); // 4번째 = bodyVehicle (body.vehicle trim 변수)
  });
});
