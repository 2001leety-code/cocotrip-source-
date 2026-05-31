/**
 * P-launch (2026-05-31): 다도시 출국 공항 도출 (부산 → 김해/PUS).
 *
 * 운영자: "부산은 김해공항으로 안내해야지". 증상 = 서울→부산 5일 plan 출국이
 * "부산→인천(ICN) 143분" 으로 잘못 안내(비행기 놓침 risk). root cause = 위저드가
 * 미선택 시 *입국 공항*을 출국에 강제(`departureTerminal || arrivalTerminal`) →
 * backend inferDepartureAirport(부산→PUS) 가 죽은 코드.
 *
 * FIX: 위저드는 사용자 명시값(미선택 시 '')만 전달 → backend 가 마지막 도시 기준 도출.
 * 안전 규칙(deep-search Agent B): "가장 가까운 공항"이 아니라 "국제선 있는 공항"만 자동
 * 배정 — 경주(KPO)/속초·강릉(YNY)/울산/여수 = 국내선 전용 → 입국 공항 폴백. 명시 선택은 존중.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — airportInference.js 는 JS
import { inferDepartureAirport, CITY_DEFAULT_AIRPORT } from '../../api/_ai_core/airportInference.js';
// @ts-expect-error — constants.js 는 JS
import { AIRPORT_NAMES, AIRPORT_COORDS, AIRPORT_STATION_COORDS } from '../../api/_ai_core/constants.js';

const ROOT = resolve(__dirname, '../..');
const wizardSrc = readFileSync(resolve(ROOT, 'src/components/WizardForm/index.tsx'), 'utf8');
const shaperSrc = readFileSync(resolve(ROOT, 'api/_ai_core/requestShaper.js'), 'utf8');

describe('P-launch 출국공항 도출 — inferDepartureAirport (마지막 도시 기준)', () => {
  it('다도시 서울→부산 → PUS (한글/영문 regions 모두)', () => {
    expect(inferDepartureAirport('ICN', ['서울', '부산'])).toBe('PUS');
    expect(inferDepartureAirport('ICN', ['seoul', 'busan'])).toBe('PUS');
    expect(inferDepartureAirport('ICN_T2', ['서울', '부산'])).toBe('PUS');
  });
  it('다도시 서울→제주 → CJU / 서울→대구 → TAE', () => {
    expect(inferDepartureAirport('ICN', ['서울', '제주'])).toBe('CJU');
    expect(inferDepartureAirport('ICN', ['서울', '대구'])).toBe('TAE');
  });
  it('단도시 → 입국 공항 그대로 (왕복)', () => {
    expect(inferDepartureAirport('ICN', ['서울'])).toBe('ICN');
    expect(inferDepartureAirport('GMP', ['부산'])).toBe('GMP'); // 단도시는 추론 안 함
  });
  it('🔴 안전 규칙 — 국내선 전용 마지막 도시(경주/강릉/속초)는 자동 배정 금지 → 입국 공항 폴백', () => {
    // 경주(KPO)·강릉/속초(YNY 사실상 국내) = 국제선 없음 → 외국인 출국 불가 공항.
    // CITY_DEFAULT_AIRPORT 에 의도적으로 미포함 → 입국 공항(ICN)으로 폴백해야 안전.
    expect(inferDepartureAirport('ICN', ['서울', '경주'])).toBe('ICN');
    expect(inferDepartureAirport('ICN', ['서울', '강릉'])).toBe('ICN');
    expect(inferDepartureAirport('ICN', ['서울', '속초'])).toBe('ICN');
  });
  it('CITY_DEFAULT_AIRPORT 는 국제공항만 (ICN/PUS/CJU/TAE) — 국내선 공항 미포함', () => {
    const airports = new Set(Object.values(CITY_DEFAULT_AIRPORT));
    expect(airports).toEqual(new Set(['ICN', 'PUS', 'CJU', 'TAE']));
    // 국내선 전용/폐쇄/명목상 = 절대 자동 배정 금지
    for (const bad of ['KPO', 'YNY', 'MWX', 'KWJ', 'USN', 'RSU', 'CJJ']) {
      expect(airports.has(bad)).toBe(false);
    }
  });
});

describe('P-launch 출국공항 도출 — PUS(김해) 모델링 완비', () => {
  it('AIRPORT_NAMES.PUS = 김해(Gimhae) 표기', () => {
    expect(AIRPORT_NAMES.PUS).toMatch(/Gimhae|김해/);
  });
  it('PUS 좌표 + 지하철역(김해경전철) 둘 다 존재 → ODsay 라우팅 가능', () => {
    expect(AIRPORT_COORDS.PUS?.lat).toBeGreaterThan(35);
    expect(AIRPORT_STATION_COORDS.PUS?.station_name).toBeTruthy();
  });
});

describe('P-launch 출국공항 도출 — wiring (source-grep 회귀방지)', () => {
  it('위저드: departureAirport = departureTerminal (입국 공항 강제 폴백 제거)', () => {
    expect(wizardSrc).toMatch(/const\s+departureAirport\s*=\s*departureTerminal\s*;/);
    // ⚠️ 재발 방지: `departureTerminal || arrivalTerminal` 폴백 금지
    expect(wizardSrc).not.toMatch(/departureAirport\s*=\s*departureTerminal\s*\|\|\s*arrivalTerminal/);
  });
  it('requestShaper: 명시값 우선 → 없으면 inferDepartureAirport → 입국 공항 순서', () => {
    expect(shaperSrc).toMatch(
      /body\.departure_airport[\s\S]{0,20}\|\|\s*inferDepartureAirport[\s\S]{0,90}\|\|\s*arrival_airport/
    );
  });
});
