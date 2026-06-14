/**
 * 버그헌트 #5 (halal) — SAFETY-CRITICAL (CLAUDE.md J). 회귀 차단.
 *
 * 배경: P10 이후 WizardForm 은 Halal/Vegan 을 ALLERGY_KEYS(=allergies 배열)에 둔다(data.tsx).
 *   userMessageBuilder 는 Gemini userMessage 의 `diet_preferences` 키엔 dietPrefs(Seafood/Meat/
 *   Street 등)만, `food_allergies` 키엔 allergies(Halal/Vegan/Nuts/...)를 넣었다.
 *   그런데 buildSystemPrompt 의 가장 구체적 식이 지시(buildPrompt.js `### Diet preferences:` —
 *   Halal → ONLY halal-certified / NEVER pork, Vegan → ONLY plant-based / NEVER fish sauce·anchovy)
 *   는 `If diet_preferences includes "Halal"/"Vegan"` 으로 `diet_preferences` 키에 게이트된다.
 *   → Halal/Vegan 이 food_allergies 로만 전달되면 이 강한 지시가 첫 Gemini 호출서 미발화 →
 *     첫 응답에 돼지/주류·동물성 혼입 위험 (HIGH 안전).
 *
 * Fix: userMessageBuilder 가 allergies 안의 Halal/Vegan(/Vegetarian) 을 diet_preferences 에도
 *   합쳐 노출 → `### Diet preferences:` 게이트가 첫 응답서 발화. food_allergies 는 원본 유지
 *   (알레르기 비스크리닝 notice + SAFETY 백스톱 무손상).
 *
 * 회귀 시: diet_preferences 가 dietPrefs 만 담아 Halal/Vegan 미발화 → 첫 응답 식이 위반 위험 복귀.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUserMessage } from '../../api/_ai_core/userMessageBuilder.js';

function makeShaped(overrides: any = {}) {
  return {
    guestName: 'Sarah',
    pax: 2,
    startDate: '2026-06-15',
    durationDays: 3,
    styles: ['Food', 'Photo'],
    area: 'seoul_city',
    regions: ['서울'],
    duration: '3-day',
    vehicle: 'staria_8',
    arrival_airport: 'ICN_T1',
    departure_airport: 'ICN_T1',
    arrivalAddress: '',
    departureAddress: '',
    arrivalTime: '14:30',
    departureTime: '18:00',
    tourStartTime: '09:00',
    tourEndTime: '21:00',
    hotel_address: '',
    hotelByCity: {},
    arrivalCity: '',
    departureCity: '',
    recommendedZone: '명동',
    recommendedZones: { seoul: '명동' },
    mobility: 'walking',
    luggage: 'medium',
    specialRequest: '',
    dietPrefs: [],
    allergies: [],
    spiceLevel: 'medium',
    bucketDishes: [],
    priceRange: 'Any',
    pace: 'standard',
    wantAccom: false,
    accomBudget: '',
    language: 'en',
    ...overrides,
  };
}

const CTX = {
  spotContext: '\n\n[SPOT_CTX]static',
  foodContext: '\n\n[FOOD_CTX]static',
  attractionsContext: '',
  mountainContext: '',
  runningContext: '',
};

/** message 안의 userInput JSON 파싱 (DYNAMIC SUFFIX 구간). */
function extractUserInput(msg: string): any {
  // userInputJson 은 '{"guest_name":' 로 시작하는 JSON 객체. variationTail 이 그 뒤에 붙는다.
  const start = msg.indexOf('{"guest_name"');
  expect(start).toBeGreaterThan(-1);
  // 균형 잡힌 중괄호로 JSON 끝 찾기 (RANDOM TAIL 제거).
  let depth = 0;
  let end = -1;
  for (let i = start; i < msg.length; i++) {
    const c = msg[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  expect(end).toBeGreaterThan(start);
  return JSON.parse(msg.slice(start, end));
}

describe('버그헌트 #5 (halal) — Halal/Vegan diet_preferences 발화', () => {
  it('Halal 이 allergies 로만 와도 diet_preferences 에 포함된다 (게이트 발화)', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ dietPrefs: [], allergies: ['Halal'] }),
      body: {},
      ...CTX,
    });
    const ui = extractUserInput(msg);
    expect(ui.diet_preferences).toBeDefined();
    expect(ui.diet_preferences).toContain('Halal');
    // food_allergies 도 원본 유지 (알레르기 백스톱 무손상)
    expect(ui.food_allergies).toContain('Halal');
  });

  it('Vegan 이 allergies 로만 와도 diet_preferences 에 포함된다', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ dietPrefs: [], allergies: ['Vegan'] }),
      body: {},
      ...CTX,
    });
    const ui = extractUserInput(msg);
    expect(ui.diet_preferences).toContain('Vegan');
    expect(ui.food_allergies).toContain('Vegan');
  });

  it('Halal + Nuts 혼합: Halal 은 diet_preferences, Nuts 는 diet_preferences 에 누출 안 됨', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ dietPrefs: [], allergies: ['Halal', 'Nuts'] }),
      body: {},
      ...CTX,
    });
    const ui = extractUserInput(msg);
    // Halal 만 diet 게이트로 올라감
    expect(ui.diet_preferences).toContain('Halal');
    expect(ui.diet_preferences).not.toContain('Nuts');
    // 알레르기 백스톱: Nuts + Halal 모두 food_allergies 에 그대로
    expect(ui.food_allergies).toEqual(expect.arrayContaining(['Halal', 'Nuts']));
  });

  it('dietPrefs + allergies(Halal) 공존: 둘 다 diet_preferences, 중복 없음', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ dietPrefs: ['Seafood', 'Halal'], allergies: ['Halal'] }),
      body: {},
      ...CTX,
    });
    const ui = extractUserInput(msg);
    expect(ui.diet_preferences).toEqual(expect.arrayContaining(['Seafood', 'Halal']));
    // Halal 중복 제거 (Set 정규화)
    const halalCount = ui.diet_preferences.filter((d: string) => d === 'Halal').length;
    expect(halalCount).toBe(1);
  });

  it('식이 무선택(allergies=Nuts 만): diet_preferences 미정의, food_allergies 만', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ dietPrefs: [], allergies: ['Nuts'] }),
      body: {},
      ...CTX,
    });
    const ui = extractUserInput(msg);
    // Halal/Vegan 없으면 diet_preferences 비어 undefined 유지 (불필요 발화 방지)
    expect(ui.diet_preferences).toBeUndefined();
    expect(ui.food_allergies).toContain('Nuts');
  });

  it('완전 무선택: diet_preferences / food_allergies 둘 다 undefined', () => {
    const msg = buildUserMessage({
      shaped: makeShaped({ dietPrefs: [], allergies: [] }),
      body: {},
      ...CTX,
    });
    const ui = extractUserInput(msg);
    expect(ui.diet_preferences).toBeUndefined();
    expect(ui.food_allergies).toBeUndefined();
  });

  it('source — buildPrompt 의 diet_preferences 게이트가 Halal/Vegan 강한 지시 보유 (백스톱 동반)', () => {
    const bp = readFileSync(
      resolve(__dirname, '../../api/_ai_core/buildPrompt.js'),
      'utf8',
    );
    // 게이트 문구 존재 — 본 수정이 발화시키려는 대상
    expect(bp).toMatch(/If diet_preferences includes "Halal"/);
    expect(bp).toMatch(/If diet_preferences includes "Vegan"/);
    // food_allergies SAFETY 백스톱도 그대로 (약화 금지)
    expect(bp).toMatch(/Halal\s*→\s*ONLY verified halal/i);
    expect(bp).toMatch(/Vegan\s*→\s*ZERO animal products/i);
  });
});
