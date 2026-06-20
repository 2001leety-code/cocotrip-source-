#!/usr/bin/env node
/**
 * record.mjs — 1회성: 실 Firestore + 실 Gemini 로 fixtures 를 만든다 (비싼/외부 부분만).
 *
 *   npm run plan:record -- <scenario>
 *   node scripts/plan-local/record.mjs <scenario>
 *
 * 필요 env (로컬 .env / .env.admin.local / .env.local 에서 자동 로드):
 *   GEMINI_API_KEY                                            — block 선택 Gemini 호출
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — zone_courses 읽기
 *
 * 동작:
 *   1. fixtures/userinput-<scenario>.json 의 입력 spec 을 로드 (없으면 내장 기본 시나리오).
 *   2. 실 fetchAvailableBlocks(MultiCity) — 해당 도시 published zone_courses (transit_matrix 포함).
 *   3. 실 selectBlocksWithGemini / selectBlocksMultiCity — Gemini 가 day 별 block_id 선택.
 *   4. fixtures/ 에 저장:
 *        blocks-<scenario>.json     (선택에 쓰인 도시 published 블록 전체)
 *        selection-<scenario>.json  (Gemini day_selections + language)
 *        userinput-<scenario>.json  (정규화된 userInput — 재현용)
 *
 * 이후 run.mjs <scenario> 는 이 fixtures 로 영원히 공짜·오프라인 실행.
 *
 * ⚠ record 는 mock 을 설치하지 않는다 — 실 Firestore/Gemini 가 필요 (비용 1회 발생).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FIXTURES = join(__dirname, 'fixtures');

// ── 로컬 .env 로더 (seed-zone-courses-firestore.mjs 패턴 동일) ────────────────
for (const f of ['.env', '.env.admin.local', '.env.local', '.env.test.local']) {
  const p = join(ROOT, f);
  try {
    const t = readFileSync(p, 'utf8');
    for (const m of t.matchAll(/^([A-Z0-9_]+)\s*=\s*(.*)$/gm)) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).replace(/\\n/g, '\n');
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* 파일 없음 = skip */ }
}

// ── 내장 기본 시나리오 (operator 가 userinput-<scenario>.json 없이 빠르게 record 하게) ──
const BUILTIN_SCENARIOS = {
  'seoul-busan-5d': {
    durationDays: 5, regions: ['seoul', 'busan'], area: 'seoul', language: 'en', pax: 2,
    vehicle: 'staria_8', styles: ['Food', 'Culture'], dietPrefs: [], allergies: [],
    startDate: '2026-07-01', arrival_airport: 'ICN', departure_airport: 'PUS',
    arrival_time: '10:00', departure_time: '19:00', tour_start_time: '09:00', tour_end_time: '21:00',
    hotel_address: 'Myeongdong, Seoul', hotelByCity: { seoul: 'Myeongdong, Seoul', busan: 'Haeundae, Busan' },
    recommendedZone: 'Myeongdong', special_request: 'Foodie trip, want famous local restaurants.',
  },
  'seoul-3d': {
    durationDays: 3, regions: ['seoul'], area: 'seoul', language: 'en', pax: 2,
    vehicle: 'staria_8', styles: ['Food', 'Culture'], dietPrefs: [], allergies: [],
    startDate: '2026-07-01', arrival_airport: 'ICN', departure_airport: 'ICN',
    arrival_time: '10:00', departure_time: '19:00', tour_start_time: '09:00', tour_end_time: '21:00',
    hotel_address: 'Myeongdong, Seoul', hotelByCity: { seoul: 'Myeongdong, Seoul' },
    recommendedZone: 'Myeongdong', special_request: '',
  },
};

async function main() {
  const scenario = (process.argv[2] || '').trim();
  if (!scenario) {
    console.error('\nusage: npm run plan:record -- <scenario>');
    console.error('  내장 시나리오:', Object.keys(BUILTIN_SCENARIOS).join(', '));
    console.error('  또는 fixtures/userinput-<scenario>.json 을 먼저 작성하세요.\n');
    process.exit(1);
  }

  // env 점검
  const need = ['GEMINI_API_KEY', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ env 누락: ${missing.join(', ')}`);
    console.error('   .env / .env.admin.local / .env.local 에 설정 후 다시 실행하세요.\n');
    process.exit(1);
  }

  // userInput spec 결정 (파일 우선 → 내장 → 에러)
  const inputPath = join(FIXTURES, `userinput-${scenario}.json`);
  let userInput;
  if (existsSync(inputPath)) {
    userInput = JSON.parse(await readFile(inputPath, 'utf8'));
    console.log(`[record] userinput-${scenario}.json 사용 (operator 작성)`);
  } else if (BUILTIN_SCENARIOS[scenario]) {
    userInput = BUILTIN_SCENARIOS[scenario];
    console.log(`[record] 내장 시나리오 '${scenario}' 사용`);
  } else {
    console.error(`\n❌ 시나리오 입력 없음: ${inputPath} 도, 내장 시나리오도 없음.`);
    console.error('   내장:', Object.keys(BUILTIN_SCENARIOS).join(', '), '\n');
    process.exit(1);
  }

  // 실 모듈 import (mock 없음 — 실 Firestore/Gemini).
  const { initAdminDb } = await import('../../api/_ai_core/firestoreAdmin.js');
  const { normalizeRegionKey } = await import('../../api/_ai_core/responseValidator.js');
  const {
    fetchAvailableBlocks, selectBlocksWithGemini,
    fetchAvailableBlocksMultiCity, selectBlocksMultiCity, buildCityPerDay,
  } = await import('../../api/_ai_core/blockMode.js');

  const adminDb = initAdminDb();
  if (!adminDb) { console.error('\n❌ Firestore 초기화 실패 (FIREBASE_* env 확인).\n'); process.exit(1); }

  const dietPrefs = Array.isArray(userInput.dietPrefs) ? userInput.dietPrefs : [];
  const regionsRaw = Array.isArray(userInput.regions) && userInput.regions.length
    ? userInput.regions
    : [userInput.area];
  const cities = regionsRaw.map((r) => normalizeRegionKey(String(r || '').split('_')[0])).filter(Boolean);
  if (!cities.length) { console.error('\n❌ regions/area 에서 도시 추출 실패.\n'); process.exit(1); }

  const geminiClient = { apiKey: (process.env.GEMINI_API_KEY || '').trim() };
  let blocks, selection;

  if (cities.length === 1) {
    console.log(`[record] 단도시 ${cities[0]} — fetchAvailableBlocks (실 Firestore)...`);
    blocks = await fetchAvailableBlocks(adminDb, cities[0], { dietaryRequired: dietPrefs, mobility: userInput.mobility });
    console.log(`[record] 블록 ${blocks.length}개. selectBlocksWithGemini (실 Gemini)...`);
    selection = await selectBlocksWithGemini(blocks, userInput, geminiClient);
    // 단도시 day_selections 에도 city 부여 (run.mjs 다도시 분기 호환).
    selection.day_selections = selection.day_selections.map((d) => ({ ...d, city: cities[0] }));
  } else {
    console.log(`[record] 다도시 ${cities.join('+')} — fetchAvailableBlocksMultiCity (실 Firestore)...`);
    const cityBlocksList = await fetchAvailableBlocksMultiCity(adminDb, cities, dietPrefs, { mobility: userInput.mobility });
    blocks = cityBlocksList.flatMap((c) => c.blocks);
    const cityPerDay = buildCityPerDay(cities, Number(userInput.durationDays) || cities.length, userInput.perDayCity || null);
    console.log(`[record] 블록 ${blocks.length}개 (${cityBlocksList.map((c) => `${c.city}:${c.blocks.length}`).join(' ')}). selectBlocksMultiCity (실 Gemini)...`);
    selection = await selectBlocksMultiCity(cityBlocksList, userInput, geminiClient, cityPerDay);
  }

  if (!selection || !Array.isArray(selection.day_selections) || !selection.day_selections.length) {
    console.error('\n❌ Gemini block 선택 실패 (빈 day_selections).\n'); process.exit(1);
  }

  // 정규화된 userInput 보존 (재현용)
  const normalizedInput = { ...userInput, regions: regionsRaw, area: userInput.area || cities[0] };

  await mkdir(FIXTURES, { recursive: true });
  await writeFile(join(FIXTURES, `blocks-${scenario}.json`), JSON.stringify(blocks, null, 2), 'utf8');
  await writeFile(join(FIXTURES, `selection-${scenario}.json`), JSON.stringify(selection, null, 2), 'utf8');
  await writeFile(join(FIXTURES, `userinput-${scenario}.json`), JSON.stringify(normalizedInput, null, 2), 'utf8');

  console.log('');
  console.log(`✅ fixtures 저장 완료 (scenario=${scenario}):`);
  console.log(`   blocks-${scenario}.json     — ${blocks.length} 블록 (transit_matrix 포함)`);
  console.log(`   selection-${scenario}.json  — ${selection.day_selections.length} day 선택`);
  console.log(`   userinput-${scenario}.json  — 정규화 입력`);
  console.log('');
  console.log(`이제 오프라인·공짜로:  npm run plan:test -- ${scenario}`);
  console.log('');
}

main().catch((e) => { console.error('\n❌ record 실패:', e && e.message ? e.message : e); console.error(e?.stack || ''); process.exit(1); });
