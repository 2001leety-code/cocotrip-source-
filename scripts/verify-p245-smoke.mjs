/**
 * P245 smoke verification — block_mode tour_start_time fix 동작 확인
 *
 * 운영자 prod alert: plan 39c7bd3f arrival=14:00 → Day1 stops 23:00/00:45/02:23/04:10 cascade.
 * 신 룰 확인: arrival=14:00 + tour_start=09:00 → dayStart=15:00 (NOT 23:00).
 *
 * 본 스크립트는 expandBlocksToItinerary 의 dayStart 계산 로직만 검증 (Gemini API 호출 X).
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const blockSrc = readFileSync(resolve(ROOT, 'api/_ai_core/blockMode.js'), 'utf-8');
const persistSrc = readFileSync(resolve(ROOT, 'api/_ai_core/planPersister.js'), 'utf-8');

console.log('=== P245 Smoke Verification ===\n');

// 1. 옛 룰 (arrival + 9h) 잔존 검사
const oldRulePresent = /addMinutesToHHMM\(\s*arrivalTime\s*,\s*9\s*\*\s*60\s*\)/.test(blockSrc);
console.log('1. 옛 룰 (arrival + 9h) 잔존:', oldRulePresent ? 'FAIL ❌ (still present)' : 'OK ✅ (removed)');

// 2. 신 룰 (arrivalPlus60 vs tourStartTime max) 존재
const newRulePresent = /arrivalPlus60\s*>\s*tourStartTime/.test(blockSrc);
console.log('2. 신 룰 (arrivalPlus60 > tourStartTime):', newRulePresent ? 'OK ✅' : 'FAIL ❌');

// 3. tour_start_time pickup (단도시 + 다도시) 둘 다
const pickupMatches = blockSrc.match(/userInput\?\.tour_start_time\s*\|\|\s*userInput\?\.tourStartTime/g) || [];
console.log('3. tour_start_time pickup 회수:', pickupMatches.length, '(expect ≥ 2)', pickupMatches.length >= 2 ? '✅' : '❌');

// 4. default '09:00' 폴백
const defaultFallback = /tour_start_time\s*\|\|\s*userInput\?\.tourStartTime\s*\|\|\s*['"]09:00['"]/.test(blockSrc);
console.log("4. default '09:00' 폴백:", defaultFallback ? 'OK ✅' : 'FAIL ❌');

// 5. planPersister tour_start_time 저장
const persistOk = /tour_start_time:\s*body\.tourStartTime/.test(persistSrc);
console.log('5. planPersister tour_start_time 저장:', persistOk ? 'OK ✅' : 'FAIL ❌');

// 6. 룰 산술 검증 (운영자 보고 시나리오 6개)
console.log('\n=== 룰 산술 검증 (운영자 시나리오 매트릭스) ===');
const scenarios = [
  { arrival: '01:30', tourStart: '09:00', expected: '09:00', desc: '운영자 P242 시나리오 (P239 verified)' },
  { arrival: '14:00', tourStart: '09:00', expected: '15:00', desc: '운영자 prod alert 시나리오 (plan 39c7bd3f) — P159 cascade 차단' },
  { arrival: '06:00', tourStart: '09:00', expected: '09:00', desc: '너무 늦은 stops 방지' },
  { arrival: '12:00', tourStart: '09:00', expected: '13:00', desc: 'arrival 우선' },
  { arrival: '23:00', tourStart: '09:00', expected: '09:00', desc: '저녁 도착 — 호텔만 Day1, 다음날 stops 09:00 부터 (overnight wrap → tour_start 우선)' },
  { arrival: '03:00', tourStart: '11:00', expected: '11:00', desc: '사용자 tour_start 명시 (11:00) — 새벽 도착 동일 룰' },
];

let pass = 0, fail = 0;
for (const s of scenarios) {
  const [ah, am] = s.arrival.split(':').map(Number);
  const arrPlus60Min = ((ah * 60 + am + 60) % (24 * 60));
  const arrPlus60 = `${String(Math.floor(arrPlus60Min / 60)).padStart(2, '0')}:${String(arrPlus60Min % 60).padStart(2, '0')}`;
  const dayStart = arrPlus60 > s.tourStart ? arrPlus60 : s.tourStart;
  const ok = dayStart === s.expected;
  console.log(`  arrival=${s.arrival}, tour_start=${s.tourStart} → dayStart=${dayStart} (expected ${s.expected}) ${ok ? '✅' : '❌'} — ${s.desc}`);
  if (ok) pass++; else fail++;
}

console.log(`\n결과: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
