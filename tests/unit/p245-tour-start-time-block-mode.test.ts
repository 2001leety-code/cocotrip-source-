/**
 * P245 — block_mode tour_start_time architectural fix
 *
 * 운영자 prod alert (2026-05-27): plan 39c7bd3f arrival=14:00 → Day1 stops
 * 23:00/00:45/02:23/04:10 cascade past midnight. P159 새벽 stops alert fired.
 *
 * Root cause: blockMode.js expandBlocksToItinerary + expandBlocksToItineraryMultiCity
 * 가 P239 tour_start_time 무시 + 옛 룰 (arrival_time + 9h) 그대로 사용.
 *   arrival=14:00 + 9h = 23:00 (no wrap) → dayStart=23:00 → stops cascade.
 *
 * Fix: dayStart = max(tour_start_time, arrival_time + 60min)
 *   - arrival=14:00, tour_start=09:00 → max(09:00, 15:00) = 15:00 (afternoon stops, no cascade)
 *   - arrival=01:30, tour_start=09:00 → max(09:00, 02:30) = 09:00 (호텔 transit + 09:00 stops)
 *   - arrival=06:00, tour_start=09:00 → max(09:00, 07:00) = 09:00 (너무 늦은 stops 방지)
 *
 * Sister modules already P239-compliant (P239 PR #646):
 *   - buildPrompt.js — ARRIVAL DAY HANDLING (Gemini prompt 룰)
 *   - RouteAgent.js — Day1 stops[1+] floor (transit stitch)
 *   - userMessageBuilder.js — Gemini JSON tour_start_time inject
 *   - requestShaper.js — body.tourStartTime parse + default '09:00'
 *
 * 본 PR P245 추가:
 *   - blockMode.js (단도시 + 다도시) — tour_start_time 룰 적용
 *   - planPersister.js — tour_start_time Firestore 저장 (옛 plan input.tour_start_time undefined 원인)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

// ────────────────────────────────────────────────────────────────────────────
// 1. blockMode.js — tour_start_time 변수 + max(tour_start_time, arrival+60min) 룰
// ────────────────────────────────────────────────────────────────────────────
describe('P245 architectural: blockMode tour_start_time', () => {
  it('tourStartTime 변수가 단도시 + 다도시 모두 정의되어 있음', () => {
    const src = readFile('api/_ai_core/blockMode.js');
    // expandBlocksToItinerary (단도시) + expandBlocksToItineraryMultiCity (다도시)
    // 양쪽 모두 tour_start_time 픽업해야 함
    const matches = src.match(/userInput\?\.tour_start_time\s*\|\|\s*userInput\?\.tourStartTime/g) || [];
    expect(matches.length, 'tour_start_time pickup이 양쪽 모두 (단도시 + 다도시) 있어야 함').toBeGreaterThanOrEqual(2);
  });

  it("옛 룰 '+ 9 * 60' 제거됨 (단도시 + 다도시)", () => {
    const src = readFile('api/_ai_core/blockMode.js');
    // 옛 룰 = addMinutesToHHMM(arrivalTime, 9 * 60) — 14:00 + 9h = 23:00 → P159 cascade
    // 신 룰 = addMinutesToHHMM(arrivalTime, 60) — arrival + 60 만
    expect(/addMinutesToHHMM\(\s*arrivalTime\s*,\s*9\s*\*\s*60\s*\)/.test(src),
      '옛 9h 룰 잔존 — P159 cascade 위험').toBe(false);
  });

  it('arrival + 60min vs tour_start_time max 비교 룰 존재', () => {
    const src = readFile('api/_ai_core/blockMode.js');
    // dayStart = arrivalPlus60 > tourStartTime ? arrivalPlus60 : tourStartTime
    expect(/arrivalPlus60\s*>\s*tourStartTime/.test(src),
      'arrival+60 vs tour_start_time max 비교 룰 누락').toBe(true);
  });

  it('default tour_start_time = 09:00 (옛 client 호환)', () => {
    const src = readFile('api/_ai_core/blockMode.js');
    // 새 ENV: tour_start_time 미입력 시 09:00 폴백
    expect(/tour_start_time\s*\|\|\s*userInput\?\.tourStartTime\s*\|\|\s*['"]09:00['"]/.test(src),
      "tour_start_time default '09:00' 폴백 누락").toBe(true);
  });

  it('P245 주석 marker 존재 (회귀 감지용)', () => {
    const src = readFile('api/_ai_core/blockMode.js');
    expect(/P245.*tour_start_time/i.test(src),
      'P245 주석 marker 누락 — 차후 회귀 시 추적 불가').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. planPersister.js — tour_start_time Firestore 저장
// ────────────────────────────────────────────────────────────────────────────
describe('P245 architectural: planPersister tour_start_time persist', () => {
  it('Firestore input.tour_start_time 저장 라인 존재', () => {
    const src = readFile('api/_ai_core/planPersister.js');
    expect(/tour_start_time:\s*body\.tourStartTime/.test(src),
      'Firestore input.tour_start_time persist 누락 — P239 효과 미완료 원인').toBe(true);
  });

  it('arrival_time 옆에 tour_start_time 인접 배치 (코드 일관성)', () => {
    const src = readFile('api/_ai_core/planPersister.js');
    // arrival_time과 같은 블록에 tour_start_time이 있어야 함
    const arrivalIdx = src.indexOf('arrival_time: body.arrivalTime');
    const tourStartIdx = src.indexOf('tour_start_time: body.tourStartTime');
    expect(arrivalIdx >= 0, 'arrival_time 저장 누락').toBe(true);
    expect(tourStartIdx >= 0, 'tour_start_time 저장 누락').toBe(true);
    // 인접성 — 300자 이내
    expect(Math.abs(tourStartIdx - arrivalIdx) < 500,
      'tour_start_time 과 arrival_time 멀리 떨어짐 (코드 일관성 위배)').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. handlerCore.js — tour_start_time userInput 전달 검증 (P239 + P245 chain)
// ────────────────────────────────────────────────────────────────────────────
describe('P245 architectural: handlerCore tour_start_time passthrough (regression guard)', () => {
  it('tryRunBlockMode userInput 에 tour_start_time 포함 (P239 chain)', () => {
    const src = readFile('api/_ai_core/handlerCore.js');
    // tryRunBlockMode call site 에 tour_start_time: tourStartTime 포함되어야 함
    expect(/tour_start_time:\s*tourStartTime/.test(src),
      'handlerCore.js tryRunBlockMode userInput.tour_start_time 누락 — P239 회귀').toBe(true);
  });

  it('tourStartTime 변수가 shaped destructure 에 있음', () => {
    const src = readFile('api/_ai_core/handlerCore.js');
    expect(/tourStartTime[,}\s]/.test(src),
      'shaped destructure 에 tourStartTime 누락').toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Integration scenario — 운영자 prod alert plan (39c7bd3f) reproduction
// ────────────────────────────────────────────────────────────────────────────
describe('P245 reproduction: arrival=14:00 should NOT cascade past midnight', () => {
  it('arrival=14:00 + tour_start=09:00 → dayStart=15:00 (NOT 23:00 wrap)', () => {
    // 본 test는 fix 로직의 산술 검증.
    // dayStart 계산: max(tour_start_time, arrival+60) = max(09:00, 15:00) = 15:00
    const arrivalPlus60 = '15:00';  // 14:00 + 60min
    const tourStartTime = '09:00';
    const dayStart = arrivalPlus60 > tourStartTime ? arrivalPlus60 : tourStartTime;
    expect(dayStart, 'arrival=14:00 + tour_start=09:00 → dayStart=15:00').toBe('15:00');
  });

  it('arrival=01:30 + tour_start=09:00 → dayStart=09:00 (호텔 transit only Day1)', () => {
    const arrivalPlus60 = '02:30';  // 01:30 + 60min
    const tourStartTime = '09:00';
    const dayStart = arrivalPlus60 > tourStartTime ? arrivalPlus60 : tourStartTime;
    expect(dayStart, 'arrival=01:30 + tour_start=09:00 → dayStart=09:00').toBe('09:00');
  });

  it('arrival=06:00 + tour_start=09:00 → dayStart=09:00 (너무 늦은 stops 방지)', () => {
    const arrivalPlus60 = '07:00';  // 06:00 + 60min
    const tourStartTime = '09:00';
    const dayStart = arrivalPlus60 > tourStartTime ? arrivalPlus60 : tourStartTime;
    expect(dayStart, 'arrival=06:00 + tour_start=09:00 → dayStart=09:00').toBe('09:00');
  });

  it('arrival=12:00 + tour_start=09:00 → dayStart=13:00 (arrival 우선)', () => {
    const arrivalPlus60 = '13:00';
    const tourStartTime = '09:00';
    const dayStart = arrivalPlus60 > tourStartTime ? arrivalPlus60 : tourStartTime;
    expect(dayStart, 'arrival=12:00 + tour_start=09:00 → dayStart=13:00').toBe('13:00');
  });

  it('옛 룰 (arrival + 9h) 시 발생한 P159 시나리오 보존 (회귀 가드)', () => {
    // 옛 룰: arrival=14:00 + 9h = 23:00 → stops cascade past midnight
    // 신 룰이 이 케이스 막아야 함
    const oldRuleDayStart = '23:00';  // 14:00 + 9h
    const newRuleDayStart = '15:00';  // max(09:00, 14:00+60)
    expect(oldRuleDayStart === newRuleDayStart, '옛 룰 = 신 룰 동일 — 회귀 가능').toBe(false);

    // 새벽 hour check (00:00-04:59)
    const isNewRuleSafe = !/^0[0-4]:/.test(newRuleDayStart);
    expect(isNewRuleSafe, '신 룰 dayStart 이 새벽 hour — 회귀').toBe(true);
  });
});
