/**
 * #tour-end / #arrival-realtime (2026-06-05, 운영자) — 투어 종료 시각 cap + 도착 현실 계산
 *
 * 운영자 요청:
 *   1) "정확하게 투어 시작시간이랑 종료시간 설정하게 하자" — tour_end_time 도입 (default '21:00').
 *      모든 day 의 관광(non-lodging) stop 을 tour_end_time 이후 trim → 사용자 지정 종료시간 준수.
 *   2) "공항에서 입국 출국 숙소까지 수속시간까지 계산해서 넉넉히 2~3시간걸린다치면 이거 계산해서" —
 *      옛 '+60분' 룰을 입국수속(90분) + 공항→권역 이동(공항별 추정)으로 현실화.
 *   3) "비행기 시간이 애매하면 다음 날 부터 투어 정하는거지 첫날은 호텔가서 쉬고" —
 *      도착이 너무 늦어 종료시간까지 투어 시간이 없으면 Day1 = 호텔 휴식 (lodging only).
 *
 * 검증 방식: source marker (회귀 차단) + runtime expandBlocksToItinerary 직접 호출 (동작 검증).
 *   메모리 lesson: "grep 은 키 버그 못잡음 → 동작 테스트". 산술이 아니라 실제 expand 결과를 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : -1;
};

/** 합성 블록 — 첫 stop=호텔(lodging), 나머지=culture. offset(분)으로 시각 제어. */
function makeBlocks(offsets: number[]) {
  return [
    {
      id: 'T1',
      city: 'seoul',
      zone: 'Test',
      theme: 'Test theme',
      intensity: 'standard',
      stops: offsets.map((off, i) => ({
        order: i + 1,
        name: i === 0 ? 'Test Hotel' : `Spot ${i}`,
        category: i === 0 ? 'lodging' : 'culture',
        start_time_offset_min: off,
        stay_min: 60,
      })),
    },
  ];
}
const baseSelections = {
  day_selections: [{ day: 1, block_id: 'T1', tweak_notes: '' }],
  language: 'en',
};
const baseInput = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15' };

// ────────────────────────────────────────────────────────────────────────────
// 1. SOURCE markers — 전 데이터 흐름에 tour_end_time / 현실 도착 계산 박제 (회귀 차단)
// ────────────────────────────────────────────────────────────────────────────
describe('#tour-end source markers — 흐름 전체 박제', () => {
  it('blockMode.js — DEFAULT_TOUR_END_HHMM + IMMIGRATION_BUFFER_MIN + 공항 이동 추정 helper', () => {
    const src = read('api/_ai_core/blockMode.js');
    expect(/DEFAULT_TOUR_END_HHMM\s*=\s*['"]21:00['"]/.test(src), 'DEFAULT_TOUR_END_HHMM 누락').toBe(true);
    expect(/IMMIGRATION_BUFFER_MIN\s*=\s*90/.test(src), '입국수속 버퍼(90분) 누락').toBe(true);
    expect(/function estimateAirportTransitMin\(/.test(src), '공항→권역 이동 추정 helper 누락').toBe(true);
    expect(/function arrivalReadyMinutes\(/.test(src), 'arrivalReadyMinutes 누락').toBe(true);
  });

  it('blockMode.js — 옛 +60분 룰(arrivalPlus60) 단도시·다도시 모두 제거됨', () => {
    const src = read('api/_ai_core/blockMode.js');
    // #arrival-realtime 가 max(tour_start, arrival+60) 을 입국수속+공항이동 현실 계산으로 대체.
    expect(/arrivalPlus60/.test(src), '옛 arrivalPlus60 잔존 — #arrival-realtime 회귀').toBe(false);
  });

  it('blockMode.js — 종료 cap 이 하드코딩 22:00 대신 tourEndTime 사용 (단도시·다도시)', () => {
    const src = read('api/_ai_core/blockMode.js');
    expect(/toMin\(['"]22:00['"]\)/.test(src), "하드코딩 22:00 cap 잔존 — tour_end_time 미반영").toBe(false);
    const capMatches = src.match(/const capMin = toMin\(tourEndTime\)/g) || [];
    expect(capMatches.length, 'capMin=toMin(tourEndTime) 가 단도시+다도시 둘 다 있어야 함').toBeGreaterThanOrEqual(2);
  });

  it('requestShaper.js — body.tourEndTime parse + default 21:00 + export', () => {
    const src = read('api/_ai_core/requestShaper.js');
    expect(/body\.tourEndTime/.test(src), 'tourEndTime body parse 누락').toBe(true);
    expect(/_rawTourEnd\s*\)\s*\?\s*_rawTourEnd\s*:\s*['"]21:00['"]/.test(src), "default '21:00' 폴백 누락").toBe(true);
  });

  it('handlerCore.js — tryRunBlockMode userInput 에 tour_end_time 전달', () => {
    const src = read('api/_ai_core/handlerCore.js');
    expect(/tour_end_time:\s*tourEndTime/.test(src), 'handlerCore userInput.tour_end_time 누락').toBe(true);
  });

  it('userMessageBuilder.js — Gemini userInput JSON 에 tour_end_time inject', () => {
    const src = read('api/_ai_core/userMessageBuilder.js');
    expect(/tour_end_time:\s*tourEndTime\s*\|\|\s*['"]21:00['"]/.test(src), 'Gemini JSON tour_end_time inject 누락').toBe(true);
  });

  it('buildPrompt.js — TOUR END TIME prompt 룰 존재', () => {
    const src = read('api/_ai_core/buildPrompt.js');
    expect(/TOUR END TIME/.test(src), 'TOUR END TIME 프롬프트 섹션 누락').toBe(true);
  });

  it('planPersister.js — Firestore tour_end_time persist', () => {
    const src = read('api/_ai_core/planPersister.js');
    expect(/tour_end_time:\s*body\.tourEndTime/.test(src), 'Firestore tour_end_time persist 누락').toBe(true);
  });

  it('frontend — WizardForm state + Step2 입력 + 4-lang i18n', () => {
    expect(/const \[tourEndTime, setTourEndTime\]/.test(read('src/components/WizardForm/index.tsx')), 'wizard tourEndTime state 누락').toBe(true);
    expect(/tour_end_time:\s*tourEndTime/.test(read('src/components/WizardForm/index.tsx')), 'wizard payload tour_end_time 누락').toBe(true);
    expect(/tourEndTimeLabel/.test(read('src/components/WizardForm/WizardStep2Details.tsx')), 'Step2 종료시간 입력 누락').toBe(true);
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      expect(/tourEndTimeLabel/.test(read(`src/i18n/locales/${lang}.json`)), `${lang}.json tourEndTimeLabel 누락`).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. RUNTIME — 현실 도착 계산 (입국수속 90분 + 공항별 이동)
// ────────────────────────────────────────────────────────────────────────────
describe('#arrival-realtime runtime — 입국수속 + 공항 이동 현실 반영', () => {
  it('ICN 14:00 도착 → Day1 시작 17:00 (14:00 + 90 입국 + 90 인천이동), 옛 룰 15:00 아님', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 120, 240]), {
      ...baseInput, arrival_time: '14:00', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '23:59',
    });
    expect(itin.days[0].stops[0].start_time).toBe('17:00');
    expect(itin.days[0].stops[0].start_time).not.toBe('15:00'); // 옛 +60분 룰
  });

  it('GMP 14:00 도착 → Day1 시작 16:15 (90 입국 + 45 김포이동) — 공항별 이동 차등', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 120, 240]), {
      ...baseInput, arrival_time: '14:00', arrival_airport: 'GMP', tour_start_time: '09:00', tour_end_time: '23:59',
    });
    expect(itin.days[0].stops[0].start_time).toBe('16:15');
  });

  it('공항 미입력 14:00 도착 → 90 입국 + 70 기본이동 = 16:40 (안전 보수값)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 120, 240]), {
      ...baseInput, arrival_time: '14:00', arrival_airport: '', tour_start_time: '09:00', tour_end_time: '23:59',
    });
    expect(itin.days[0].stops[0].start_time).toBe('16:40');
  });

  it('이른 도착(ICN 06:00)은 tour_start_time(09:00)이 우선 — 너무 이른 stops 방지', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    // ready = 06:00 + 90 + 90 = 09:00 → max(09:00, 09:00) = 09:00
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 120, 240]), {
      ...baseInput, arrival_time: '06:00', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '23:59',
    });
    expect(itin.days[0].stops[0].start_time).toBe('09:00');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. RUNTIME — tour_end_time cap (매일 관광 종료 시각 준수)
// ────────────────────────────────────────────────────────────────────────────
describe('#tour-end runtime — 종료 시각 이후 관광 stop trim', () => {
  it('tour_end_time=21:00 → 22:00 관광 stop trim, 21:00 이후 관광 stop 0건', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    // dayStart=09:00(도착 없음), offsets → 09:00 / 15:00 / 19:00 / 21:00 / 22:00
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 360, 600, 720, 780]), {
      ...baseInput, arrival_time: '', tour_start_time: '09:00', tour_end_time: '21:00',
    });
    const stops = itin.days[0].stops;
    const sightseeing = stops.filter((s) => s.category !== 'lodging' && s.category !== 'airport' && s.category !== 'travel');
    expect(sightseeing.every((s) => toMin(s.start_time) <= toMin('21:00')), '관광 stop 이 21:00 초과').toBe(true);
    expect(stops.some((s) => s.start_time === '22:00'), '22:00 stop 이 trim 안 됨').toBe(false);
  });

  it('tour_end_time=18:00 → 19:00·21:00·22:00 모두 trim (사용자가 일찍 종료)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 360, 600, 720, 780]), {
      ...baseInput, arrival_time: '', tour_start_time: '09:00', tour_end_time: '18:00',
    });
    const sightseeing = itin.days[0].stops.filter((s) => s.category === 'culture');
    expect(sightseeing.every((s) => toMin(s.start_time) <= toMin('18:00')), '관광 stop 이 18:00 초과').toBe(true);
  });

  it('tour_end_time 미입력 → default 21:00 cap 적용 (22:00 trim)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 360, 600, 720, 780]), {
      ...baseInput, arrival_time: '', tour_start_time: '09:00', // tour_end_time 생략
    });
    expect(itin.days[0].stops.some((s) => s.start_time === '22:00'), 'default 21:00 cap 미적용').toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. RUNTIME — 너무 늦은 도착 → Day1 = 호텔 휴식 (운영자: "첫날은 호텔가서 쉬고")
// ────────────────────────────────────────────────────────────────────────────
describe('#arrival-realtime runtime — 야간 도착 시 Day1 호텔 휴식', () => {
  it('ICN 21:00 도착 + 종료 21:00 → Day1 = 호텔(lodging) 1 stop only', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    // ready = 21:00 + 90 + 90 = 24:00 ≥ cap 21:00 → dayStart=21:00 → 모든 관광 stop trim
    const itin = expandBlocksToItinerary(baseSelections, makeBlocks([0, 120, 240, 360]), {
      ...baseInput, arrival_time: '21:00', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00',
    });
    const stops = itin.days[0].stops;
    expect(stops.length, 'Day1 은 호텔만 남아야 함 (휴식)').toBe(1);
    expect(stops[0].category).toBe('lodging');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. RUNTIME — prod 9f9f37a1/f80d7219 검증에서 노출된 Day1 엣지 케이스 (2026-06-05 후속 fix)
// ────────────────────────────────────────────────────────────────────────────
describe('#tour-end runtime — 엣지: trailing lodging 보호 + 휴식일 정확-cap', () => {
  // 종료 초과 관광 뒤에 호텔복귀(lodging) stop 이 있는 블록 (prod 9f9f37a1 Day1 = 20:15 인사동 + 호텔복귀).
  const trailingLodgingBlocks = [{
    id: 'T1', city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard',
    stops: [
      { order: 1, name: 'Hotel checkin', category: 'lodging', start_time_offset_min: 0, stay_min: 30 },
      { order: 2, name: 'Sight A', category: 'culture', start_time_offset_min: 240, stay_min: 90 }, // 13:00
      { order: 3, name: 'Sight B', category: 'culture', start_time_offset_min: 600, stay_min: 90 }, // 19:00
      { order: 4, name: 'Insadong', category: 'culture', start_time_offset_min: 720, stay_min: 60 }, // 21:00 (cap 20:00 초과)
      { order: 5, name: 'Hotel return', category: 'lodging', start_time_offset_min: 800, stay_min: 0 }, // 22:20
    ],
  }];

  it('종료 초과 관광이 trailing lodging 에 보호되지 않고 trim됨 (tail-pop→filter)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const itin = expandBlocksToItinerary(baseSelections, trailingLodgingBlocks, {
      ...baseInput, arrival_time: '', tour_start_time: '09:00', tour_end_time: '20:00',
    });
    const stops = itin.days[0].stops;
    const sights = stops.filter((s) => s.category === 'culture');
    // 21:00 인사동(초과)은 제거, 13:00/19:00 은 보존.
    expect(sights.every((s) => toMin(s.start_time) <= toMin('20:00')), '초과 관광이 안 잘림 (trailing lodging 보호 버그)').toBe(true);
    expect(stops.some((s) => s.name === 'Insadong'), '21:00 인사동이 trim 안 됨').toBe(false);
    // 호텔복귀(trailing lodging)는 보존 (bookend).
    expect(stops.some((s) => s.name === 'Hotel return'), '호텔복귀 lodging 이 잘못 trim됨').toBe(true);
    expect(stops[stops.length - 1].category, '마지막은 호텔복귀(lodging)').toBe('lodging');
  });

  it('휴식일: dayStart=종료시각과 정확히 같은 관광 stop 도 제거 (prod f80d7219 20:00 잔존 버그)', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const restBlocks = [{
      id: 'T1', city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard',
      stops: [
        { order: 1, name: 'Hotel', category: 'lodging', start_time_offset_min: 0, stay_min: 30 },
        { order: 2, name: 'Sight at cap', category: 'culture', start_time_offset_min: 0, stay_min: 60 }, // dayStart(=20:00)와 동일
        { order: 3, name: 'Sight later', category: 'culture', start_time_offset_min: 120, stay_min: 60 },
      ],
    }];
    // ICN 22:00 도착 + 종료 20:00 → ready 25:00 ≥ cap → 휴식일 → dayStart=20:00, 관광 전부 제거.
    const itin = expandBlocksToItinerary(baseSelections, restBlocks, {
      ...baseInput, arrival_time: '22:00', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '20:00',
    });
    const stops = itin.days[0].stops;
    expect(stops.filter((s) => s.category === 'culture').length, '휴식일에 관광 stop 잔존 (정확-cap 누락)').toBe(0);
    expect(stops.every((s) => s.category === 'lodging' || s.category === 'airport' || s.category === 'travel'), 'Day1 은 보호 stop 만').toBe(true);
  });
});
