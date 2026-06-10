import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — ESM .js in api/, no type decls
import { expandBlocksToItineraryMultiCity } from '../../api/_ai_core/blockMode.js';

/**
 * 플랜 로컬 시뮬레이션 — Gemini/Firestore/배포 없이, 실 foodIndex + 실 블록으로 block_mode
 * 다도시 plan 을 "조립"해 동선·식당근접·중복·식이 SAFETY 를 결정적으로 검증한다.
 *
 * 2026-06-10: 운영자 "꼭 머지하고 돈 드는 dispatch 로만 확인해야 하나? 코딩+테스트 구동 확인 후
 * 머지하는 시스템 못 만드나?" → 만들었다. 플래너에서 비용은 Gemini 호출뿐이고, 깨졌던 버그
 * (동선 zigzag·식당 동선밖·중복·식이)는 전부 Gemini 이후 결정적 로직 → 그 응답(블록 선택)을
 * 고정하면 나머지는 로컬 CI 에서 $0 재현. 이 테스트가 있었으면 #866(다도시 식당 앵커 누락)을
 * 머지 전에 잡았다(food 가 동선 밖 → day path 폭증 → assertion fail).
 *
 * 한계: Gemini 의 "어느 블록을 고르나"(selectBlocksWithGemini) 와 legacy 자유생성 품질은
 * 비결정이라 여기서 mock(고정)한다. 그 창의성 자체는 가끔 dispatch 로 sampling — 매 머지마다 X.
 */

const ZONE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/data/zone_courses');
const loadBlock = (f: string) => JSON.parse(readFileSync(join(ZONE_DIR, `${f}.json`), 'utf8'));

// 실 foodIndex (1.2MB) — 식당 매칭 실데이터.
const FI_RAW = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../api/_food_index.json'), 'utf8'));
const FOOD_INDEX: any[] = Array.isArray(FI_RAW) ? FI_RAW : (FI_RAW.restaurants || FI_RAW.data || []);

const haversineKm = (a: any, b: any) => {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
// 식당 이름 → 좌표 (resolved name 은 foodIndex 에서 왔으므로 exact 매칭).
const foodCoord = (name: string) => {
  const r = FOOD_INDEX.find((x) => String(x.name || '').split('|')[0].trim() === String(name).trim());
  return r && r.lat ? { lat: r.lat, lng: r.lng } : null;
};

// 좌표 있는 stop 만으로 day 전체 경로 km (명소 블록좌표 + 식당 foodIndex 좌표).
const dayFullPathKm = (stops: any[]) => {
  const coords: any[] = [];
  for (const s of stops) {
    if (typeof s.lat === 'number' && s.lat > 30) { coords.push({ lat: s.lat, lng: s.lng }); continue; }
    if (s.category === 'food' && s.name) { const c = foodCoord(s.name); if (c) coords.push(c); }
  }
  let km = 0;
  for (let i = 1; i < coords.length; i++) { const d = haversineKm(coords[i - 1], coords[i]); if (d != null) km += d; }
  return Math.round(km * 10) / 10;
};

// 다도시(서울+부산) block_mode plan 을 Gemini 없이 조립. 블록 선택은 고정(mock).
const simulate = (dietPrefs: string[] = []) => {
  const seoulBlock = loadBlock('seoul_temple_culture_standard'); // 창덕궁 (재시드 반영본)
  const busanBlock = loadBlock('busan_choryang_local_standard');
  const cityBlocksList = [
    { city: 'seoul', blocks: [seoulBlock] },
    { city: 'busan', blocks: [busanBlock] },
  ];
  const blockSelections = {
    day_selections: [
      { day: 1, block_id: seoulBlock.id, city: 'seoul' },
      { day: 2, block_id: busanBlock.id, city: 'busan' },
    ],
    language: 'ko',
  };
  const userInput = {
    durationDays: 2, dietPrefs, language: 'ko', foodIndex: FOOD_INDEX,
    regions: ['seoul', 'busan'], startDate: '2026-07-10',
    hotelByCity: { seoul: '명동 신라스테이', busan: '서면 롯데호텔' },
    arrival_airport: 'ICN', arrival_time: '13:00',
  };
  return expandBlocksToItineraryMultiCity(blockSelections, cityBlocksList, userInput);
};

describe('플랜 로컬 시뮬레이션 (block_mode 다도시, Gemini 없이)', () => {
  const itin = simulate();
  const days = itin.days || [];

  it('plan 이 2 day 로 조립됨', () => {
    expect(days.length).toBe(2);
  });

  it('각 day 동선이 tight — 식당 포함 전체 경로 < 9km (식당 동선밖/zigzag 회귀 차단)', () => {
    // 회귀 예: 식당 앵커 누락 시 식당이 도시 전체 1등(먼 곳)으로 채워져 day path 가 19km+ 로 폭증.
    for (const d of days) {
      const km = dayFullPathKm(d.stops || []);
      expect(km, `Day${d.day} (${d.city}) 동선 ${km}km — 식당이 동선 밖일 가능성`).toBeLessThan(9);
    }
  });

  it('각 식당이 직전 명소 5km 이내에서 선택됨 (근접 앵커 작동)', () => {
    for (const d of days) {
      const stops = d.stops || [];
      let prevLandmark: any = null;
      for (const s of stops) {
        if (typeof s.lat === 'number' && s.lat > 30) { prevLandmark = { lat: s.lat, lng: s.lng }; continue; }
        if (s.category === 'food' && s.name && prevLandmark) {
          const fc = foodCoord(s.name);
          if (fc) {
            const dist = haversineKm(prevLandmark, fc);
            // 4km — 앵커 작동 시 도심 식당은 <2km. 앵커 누락(회귀) 시 도시 1등(이태리국시 4.9km)
            // 으로 채워져 이 선을 넘는다. 도심 블록(종로/초량) 기준 안전.
            expect(dist, `Day${d.day} 식당 "${s.name}" 가 직전 명소서 ${dist?.toFixed(1)}km — 앵커 누락 의심`).toBeLessThan(4);
          }
        }
      }
    }
  });

  it('plan 전체에서 같은 식당 중복 배정 없음', () => {
    const names = days.flatMap((d: any) => (d.stops || []).filter((s: any) => s.category === 'food' && s.name).map((s: any) => s.name));
    const dups = names.filter((n: string, i: number) => names.indexOf(n) !== i);
    expect(dups, `중복 식당: ${dups.join(', ')}`).toEqual([]);
  });

  it('SAFETY: 할랄 손님 — 비할랄 실식당 silent 배정 0 (throw 또는 할랄만)', () => {
    // 정답 동작: block_mode 가 할랄 식당을 못 찾으면 BLOCK_MODE_DIETARY_UNSATISFIED throw →
    // caller 가 legacy 로 폴백. 절대 비할랄 실식당을 silent 배정하지 않음. throw 든 정상반환이든
    // "비할랄 실식당 0" 만 보장되면 SAFETY 통과.
    let halalItin: any;
    try {
      halalItin = simulate(['halal']);
    } catch (e: any) {
      // throw = 안전(매칭 불가 → legacy 폴백). dietary 관련 throw 인지만 확인.
      expect(String(e?.code || e?.message || '')).toMatch(/DIETARY|dietary|halal/i);
      return;
    }
    // throw 안 했으면(할랄 매칭 성공) — 모든 resolved food 가 할랄 또는 placeholder 여야.
    const foodStops = (halalItin.days || []).flatMap((d: any) => (d.stops || []).filter((s: any) => s.category === 'food'));
    for (const s of foodStops) {
      if (!s.name) continue;
      const isPlaceholderText = String(s.name).startsWith('[추천');
      const r = FOOD_INDEX.find((x) => String(x.name || '').split('|')[0].trim() === String(s.name).trim());
      const tags = r && Array.isArray(r.dietary_tags) ? r.dietary_tags.map((t: string) => String(t).toLowerCase()) : [];
      expect(isPlaceholderText || tags.includes('halal') || !r, `할랄 손님에 비할랄 식당 "${s.name}" 배정`).toBe(true);
    }
  });
});
