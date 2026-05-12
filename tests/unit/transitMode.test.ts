// B-11 fix (2026-05-12) — RouteAgent transit mode 매핑 회귀 방지.
//
// 자율 검증 시스템 (W2 sentinel) 이 prod 회귀 슈트에서 자동 감지한 이슈:
//   B-11 [ODsay source 비율 >= 50%] → 0/0 (0%) → 영구 skip
// 원인: RouteAgent 가 transit_from_prev 에 `method` 만 저장하고 `mode` 미저장.
// 회귀 슈트는 `t.mode || t.type` 으로 비율을 측정해서 항상 0 → skip 됐다.
//
// 이 테스트는 두 매핑 함수의 정확성을 검증:
//   1) odsayPathTypeToMode — ODsay raw pathType (1/2/3/0) → mode enum
//   2) methodToMode        — formatTransitSummary 출력 method → 정규화된 mode

import { describe, it, expect } from 'vitest';
// @ts-expect-error — RouteAgent.js 는 plain JS (no .d.ts) 라 export 만 named import.
import { odsayPathTypeToMode, methodToMode } from '../../api/_ai_core/agents/RouteAgent.js';

describe('odsayPathTypeToMode — ODsay pathType 매핑', () => {
  it('pathType=1 → subway (지하철 단일)', () => {
    expect(odsayPathTypeToMode(1)).toBe('subway');
  });

  it('pathType=2 → bus (버스 단일)', () => {
    expect(odsayPathTypeToMode(2)).toBe('bus');
  });

  it('pathType=3 → transit (지하철+버스 환승)', () => {
    expect(odsayPathTypeToMode(3)).toBe('transit');
  });

  it('알 수 없는 pathType (0/undefined/문자열) → walk default', () => {
    expect(odsayPathTypeToMode(0)).toBe('walk');
    expect(odsayPathTypeToMode(undefined as unknown as number)).toBe('walk');
    expect(odsayPathTypeToMode('foo' as unknown as number)).toBe('walk');
  });
});

describe('methodToMode — formatTransitSummary method 정규화', () => {
  it('subway/bus/walk 는 그대로 통과', () => {
    expect(methodToMode('subway')).toBe('subway');
    expect(methodToMode('bus')).toBe('bus');
    expect(methodToMode('walk')).toBe('walk');
  });

  it("'subway+bus' → 'transit' 정규화 (회귀 슈트 enum 매칭)", () => {
    expect(methodToMode('subway+bus')).toBe('transit');
    expect(methodToMode('bus+subway')).toBe('transit');
    expect(methodToMode('mixed')).toBe('transit');
  });

  it("'metro' (legacy) → 'subway' alias", () => {
    expect(methodToMode('metro')).toBe('subway');
  });

  it('대소문자 무시 (대문자 method 도 정상 정규화)', () => {
    expect(methodToMode('SUBWAY')).toBe('subway');
    expect(methodToMode('Subway+Bus')).toBe('transit');
  });

  it('null / undefined / 빈 문자열 → null (validator 가 skip 처리)', () => {
    expect(methodToMode(null as unknown as string)).toBe(null);
    expect(methodToMode(undefined as unknown as string)).toBe(null);
    expect(methodToMode('')).toBe(null);
  });

  it("'car' / 'unknown' 같은 fallback 값도 그대로 통과", () => {
    expect(methodToMode('car')).toBe('car');
    expect(methodToMode('unknown')).toBe('unknown');
  });
});

describe('B-11 회귀 슈트 호환성 — allowedModes set', () => {
  // validate-prod-regression.mjs B-11 에서 사용하는 allowed enum 과 매칭 검증.
  // methodToMode 출력이 회귀 슈트 enum 안에 들어가야 ODsay match 카운트됨.
  const ALLOWED_B11 = ['subway', 'bus', 'walk', 'transit', 'metro'];

  it('ODsay 정상 응답 (pathType 1/2/3) → 모두 B-11 allowed', () => {
    expect(ALLOWED_B11).toContain(odsayPathTypeToMode(1));
    expect(ALLOWED_B11).toContain(odsayPathTypeToMode(2));
    expect(ALLOWED_B11).toContain(odsayPathTypeToMode(3));
  });

  it("formatTransitSummary 출력 ('subway'|'bus'|'walk'|'subway+bus') → 모두 B-11 allowed", () => {
    expect(ALLOWED_B11).toContain(methodToMode('subway'));
    expect(ALLOWED_B11).toContain(methodToMode('bus'));
    expect(ALLOWED_B11).toContain(methodToMode('walk'));
    expect(ALLOWED_B11).toContain(methodToMode('subway+bus'));
  });
});
