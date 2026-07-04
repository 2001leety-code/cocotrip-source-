/**
 * B-15 출국일 공항 메타 주입 회귀 슬롯 (2026-07-03 Daily Sentinel fix).
 *
 * block_mode 는 Gemini 파이프라인(공항 보장 3중 장치)을 스킵하므로 출국일 공항 흔적이
 * 구조적으로 0 → Sentinel B-15 연속 fail + 저장된 block_mode plan 수정 요청 전부
 * 422 PATTERN_VIOLATION. markReturnToAirport 가 마지막 day 에 return_to_airport 메타를
 * 주입해 해소한다. 이 로직이 잘못 바뀌면(주입 누락·엉뚱한 day·already 오판) 터진다.
 */
import { describe, it, expect } from 'vitest';

import { markReturnToAirport } from '../../api/_ai_core/blockMode.js';

const itin = (n: number) => ({ days: Array.from({ length: n }, (_, i) => ({ day: i + 1, stops: [] })) });

describe('markReturnToAirport — B-15 출국일 공항 메타 주입', () => {
  it('departure_airport 있으면 마지막 day 에만 주입 + true 반환', () => {
    const it5 = itin(5);
    expect(markReturnToAirport(it5, { departure_airport: 'ICN_T1' })).toBe(true);
    expect(it5.days[4].return_to_airport).toBe(true);
    expect((it5.days[0] as Record<string, unknown>).return_to_airport).toBeUndefined(); // 다른 day 오염 없음
  });

  it('departure 없고 arrival 만 있어도 주입 (왕복 동일 공항 폴백)', () => {
    const it3 = itin(3);
    expect(markReturnToAirport(it3, { arrival_airport: 'GMP' })).toBe(true);
    expect(it3.days[2].return_to_airport).toBe(true);
  });

  it('already_in_korea(한국 거주 = 출국편 없음)는 주입 안 함', () => {
    const it3 = itin(3);
    expect(markReturnToAirport(it3, { departure_airport: 'already_in_korea' })).toBe(false);
    expect(it3.days[2].return_to_airport).toBeUndefined();
    expect(markReturnToAirport(itin(2), { departure_airport: 'ALREADY' })).toBe(false);
  });

  it('공항 미지정/빈 문자열은 주입 안 함', () => {
    expect(markReturnToAirport(itin(2), {})).toBe(false);
    expect(markReturnToAirport(itin(2), { departure_airport: '  ' })).toBe(false);
  });

  it('days 없음/빈 배열은 안전하게 false', () => {
    expect(markReturnToAirport({ days: [] }, { departure_airport: 'ICN_T1' })).toBe(false);
    expect(markReturnToAirport(null as unknown as object, { departure_airport: 'ICN_T1' })).toBe(false);
    expect(markReturnToAirport({}, { departure_airport: 'ICN_T1' })).toBe(false);
  });

  it('멱등 — 두 번 불러도 동일 결과 (modify backfill 재호출 안전)', () => {
    const it2 = itin(2);
    markReturnToAirport(it2, { departure_airport: 'ICN_T1' });
    markReturnToAirport(it2, { departure_airport: 'ICN_T1' });
    expect(it2.days[1].return_to_airport).toBe(true);
  });
});

describe('배선 소스 불변식 — 주입 호출이 빠지면 터짐', () => {
  it('blockMode 성공 반환 2곳(단도시·다도시)에서 markReturnToAirport 호출', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/_ai_core/blockMode.js'), 'utf8');
    const calls = src.match(/markReturnToAirport\(blockOut\.itinerary, userInput\)/g) || [];
    expect(calls.length).toBe(2); // 단도시 + 다도시
  });

  it('ai-planner-modify 는 block_mode plan 에 검증 전 backfill 호출', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../api/ai-planner-modify.js'), 'utf8');
    expect(src).toMatch(/planner_pipeline === 'block_mode'/);
    expect(src).toMatch(/markReturnToAirport\(itinerary, planData\.input \|\| \{\}\)/);
  });
});
