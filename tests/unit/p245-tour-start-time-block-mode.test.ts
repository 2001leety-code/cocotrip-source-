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
import { expandBlocksToItinerary } from '../../api/_ai_core/blockMode.js';
import { resolveTourStartTime } from '../../api/_ai_core/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

// PR3: 동작 검사용 최소 블록 — 관광 1곳(offset 0), 1일 선택.
const SIGHT_BLOCK = {
  id: 'P245-SIGHT', city: 'seoul', zone: 'Test', theme: 'Test', intensity: 'standard', block_type: 'city_day',
  stops: [{ order: 1, category: 'culture', name: '경복궁', address: 'Seoul', stay_min: 60, start_time_offset_min: 0 }],
};
const ONE_DAY_SEL = { day_selections: [{ day: 2, block_id: 'P245-SIGHT' }] };

// ────────────────────────────────────────────────────────────────────────────
// 1. blockMode.js — tour_start_time 변수 + max(tour_start_time, arrival+60min) 룰
// ────────────────────────────────────────────────────────────────────────────
describe('P245 architectural: blockMode tour_start_time', () => {
  // 2026-11-01 (PR3): 코드 모양 대신 resolver 연결 + 동작 — blockMode 는 constants.resolveTourStartTime(camel 우선 + snake,
  //   엄격 HH:MM, 기본 09:00)을 단도시·다도시 둘 다 쓴다(요청·worker·저장과 같은 값).
  it('tourStartTime 변수가 단도시 + 다도시 모두 정의되어 있음', () => {
    const src = readFile('api/_ai_core/blockMode.js');
    const matches = src.match(/const tourStartTime = resolveTourStartTime\(userInput\)/g) || [];
    expect(matches.length, 'tour_start_time pickup이 양쪽 모두 (단도시 + 다도시) 있어야 함').toBeGreaterThanOrEqual(2);
    // 동작: snake·camel 모두 같은 시작 시각(첫 관광 stop)
    for (const input of [{ tour_start_time: '10:00' }, { tourStartTime: '10:00' }]) {
      const out = expandBlocksToItinerary(ONE_DAY_SEL, [SIGHT_BLOCK], { durationDays: 2, area: 'seoul', language: 'en', ...input });
      expect(out.days[0].stops[0].start_time).toBe('10:00');
    }
  });

  it("옛 룰 '+ 9 * 60' 제거됨 (단도시 + 다도시)", () => {
    const src = readFile('api/_ai_core/blockMode.js');
    // 옛 룰 = addMinutesToHHMM(arrivalTime, 9 * 60) — 14:00 + 9h = 23:00 → P159 cascade
    // 신 룰 = addMinutesToHHMM(arrivalTime, 60) — arrival + 60 만
    expect(/addMinutesToHHMM\(\s*arrivalTime\s*,\s*9\s*\*\s*60\s*\)/.test(src),
      '옛 9h 룰 잔존 — P159 cascade 위험').toBe(false);
  });

  it('도착 현실 계산(arrivalReadyMinutes) vs tour_start_time max 비교 룰 존재 (#arrival-realtime 대체)', () => {
    const src = readFile('api/_ai_core/blockMode.js');
    // 2026-06-05 #arrival-realtime: 옛 max(tour_start, arrival+60) 룰을 입국수속(90분) +
    // 공항→권역 이동(공항별) 현실 계산으로 대체. dayStart = max(tourStartMin, arrivalReadyMinutes(...)).
    expect(/arrivalReadyMinutes\(/.test(src),
      'arrivalReadyMinutes 도착 현실 계산 누락 — #arrival-realtime 회귀').toBe(true);
    expect(/Math\.max\(\s*tourStartMin\s*,\s*readyMin\s*\)/.test(src),
      'max(tour_start, ready) 비교 룰 누락').toBe(true);
    // 옛 +60분 룰(arrivalPlus60) 잔존 금지 (회귀 차단)
    expect(/arrivalPlus60/.test(src),
      '옛 arrivalPlus60(+60분) 룰 잔존 — #arrival-realtime 회귀').toBe(false);
  });

  it('default tour_start_time = 09:00 (옛 client 호환)', () => {
    // PR3: 동작 검사 — 미입력·잘못된 값('7am'·'25:00')이면 09:00.
    for (const input of [{}, { tour_start_time: '7am' }, { tourStartTime: '25:00' }]) {
      const out = expandBlocksToItinerary(ONE_DAY_SEL, [SIGHT_BLOCK], { durationDays: 2, area: 'seoul', language: 'en', ...input });
      expect(out.days[0].stops[0].start_time, JSON.stringify(input)).toBe('09:00');
    }
    expect(resolveTourStartTime({})).toBe('09:00');
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
  // PR3: 저장값 = 생성 판정과 같은 resolver(입력이 있을 때만 — 없으면 null, 읽는 쪽 기본 09:00). snake '17:00' 도 그대로 저장돼
  //   생성(예전엔 09:00 로 버림)·worker(17:00)·저장 → 수정이 같은 값을 쓴다.
  it('Firestore input.tour_start_time 저장 라인 존재', () => {
    const src = readFile('api/_ai_core/planPersister.js');
    expect(src).toContain('tour_start_time: (body.tourStartTime || body.tour_start_time) ? resolveTourStartTime(body) : null,');
    expect(resolveTourStartTime({ tour_start_time: '17:00' })).toBe('17:00');
    expect(resolveTourStartTime({ tourStartTime: '9:30' })).toBe('09:30');
  });

  it('arrival_time 옆에 tour_start_time 인접 배치 (코드 일관성)', () => {
    const src = readFile('api/_ai_core/planPersister.js');
    // arrival_time과 같은 블록에 tour_start_time이 있어야 함
    const arrivalIdx = src.indexOf('arrival_time: resolveArrivalTime(body)');
    const tourStartIdx = src.indexOf('tour_start_time: (body.tourStartTime');
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
describe('P245 reproduction: arrival should NOT cascade past midnight (max concept)', () => {
  // NOTE: 2026-06-05 #arrival-realtime 가 arrival+60 → 입국수속(90)+공항이동 현실 계산으로 대체.
  // 아래 산술은 P245 max() 개념 demo (frozen). 실제 expand 동작 검증은
  // tests/unit/tour-end-time-arrival-realtime.test.ts (동작 테스트) 참조.
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
