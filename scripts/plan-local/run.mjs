#!/usr/bin/env node
/**
 * run.mjs — 오프라인·공짜 로컬 플랜 테스트 러너.
 *
 *   npm run plan:test -- <scenario>
 *   node scripts/plan-local/run.mjs <scenario>
 *
 * fixtures/{blocks,selection,userinput}-<scenario>.json 을 로드해서 POST-Gemini
 * 파이프라인(expand → RouteAgent → backfill/T-money/budget → 추천식당 → 가격)을
 * 돌리고, outputs/plan-<scenario>.json 저장 + 콘솔 요약(동선/transit/budget/T-money)을 출력한다.
 *
 * Gemini / Firestore / ODsay / Naver 호출 0 — fixtures 와 캐시 transit_matrix 만 사용.
 * record.mjs 가 실데이터로 fixtures 를 한 번 만들면, 이 스크립트는 영원히 공짜로 돈다.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { installMocks } from './_mocks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const OUTPUTS = join(__dirname, 'outputs');

// ── prod 모듈이 process.env 읽고 crash 안 나게 dummy/test env 세팅 (offline 은 live 키 불필요) ──
// 실 키가 .env 로 들어와도 mock 이 우선(searchTransit/initAdminDb 치환) → 외부 호출 0.
function setDummyEnv() {
  const dummies = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'offline-dummy-key',
    // 캐시 transit_matrix 사용 보장 (circuit breaker OFF 안 되게).
    ROUTE_TRANSIT_CACHE_ENABLED: 'true',
    // block_mode 강제 (auto 도 동작하지만 명시).
    PLANNER_BLOCK_MODE: 'auto',
    // telegram/sentry 비활성 (알림 no-op)
    TELEGRAM_BOT_TOKEN: '', SENTRY_DSN: '',
  };
  for (const [k, v] of Object.entries(dummies)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  // ⚠ NAVER 자격증명 = dummy 비-빈 값 강제. RouteAgent 의 geocoding 분기에 진입시키되
  //   실제 호출은 axios mock 이 fixture 좌표로 응답(외부 호출 0). 빈 값이면 분기 skip →
  //   stop.lat 이 null 로 덮어써져 transitCache lookup(좌표 필요)이 통째로 죽는다.
  for (const k of ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET', 'NCP_CLIENT_ID', 'NCP_CLIENT_SECRET']) {
    process.env[k] = 'offline-harness';
  }
  // ODsay/Google = 빈 값 → searchTransit mock 이 null, Google Places skip (이중 안전).
  for (const k of ['ODSAY_API_KEY', 'GOOGLE_PLACES_API_KEY']) {
    process.env[k] = '';
  }
}

async function loadJson(path) {
  const txt = await readFile(path, 'utf8');
  return JSON.parse(txt);
}

async function main() {
  const scenario = (process.argv[2] || 'sample').trim();

  const blocksPath = join(FIXTURES, `blocks-${scenario}.json`);
  const selPath = join(FIXTURES, `selection-${scenario}.json`);
  const inputPath = join(FIXTURES, `userinput-${scenario}.json`);

  // sample 시나리오는 단일 sample-*.json 도 허용 (손으로 만든 최소 fixture).
  const sampleBlocks = join(FIXTURES, `sample-blocks.json`);
  const sampleSel = join(FIXTURES, `sample-selection.json`);
  const sampleInput = join(FIXTURES, `sample-userinput.json`);

  let bPath = blocksPath, sPath = selPath, iPath = inputPath;
  if (scenario === 'sample' && !existsSync(blocksPath)) {
    bPath = sampleBlocks; sPath = sampleSel; iPath = sampleInput;
  }

  for (const [label, p] of [['blocks', bPath], ['selection', sPath], ['userinput', iPath]]) {
    if (!existsSync(p)) {
      console.error(`\n❌ fixture 누락: ${label} → ${p}`);
      console.error(`   먼저 record 로 생성하세요:  npm run plan:record -- ${scenario}`);
      console.error(`   (sample 은 fixtures/sample-*.json 가 레포에 포함되어 즉시 동작해야 합니다.)\n`);
      process.exit(1);
    }
  }

  setDummyEnv();
  installMocks(); // ⚠ prod 모듈 import 전에 호출 — 이후 동적 import 로 _pipeline 로드.

  const [blocks, selection, userInput] = await Promise.all([
    loadJson(bPath), loadJson(sPath), loadJson(iPath),
  ]);

  console.log(`\n[plan:test] scenario=${scenario}  blocks=${blocks.length}  days=${(selection.day_selections || []).length}  (offline, 외부호출 0)`);

  // installMocks 이후 동적 import — _pipeline 이 끌어오는 prod 모듈이 mock 치환된 상태로 로드됨.
  const { runOfflinePlan, printPlanSummary } = await import('./_pipeline.mjs');

  let result;
  try {
    result = await runOfflinePlan({ blocks, selection, userInput });
  } catch (err) {
    console.error('\n❌ 파이프라인 실패:', err && err.message ? err.message : err);
    console.error(err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : '');
    process.exit(1);
  }

  const { itinerary, pricing, blocksUsed } = result;

  await mkdir(OUTPUTS, { recursive: true });
  const outPath = join(OUTPUTS, `plan-${scenario}.json`);
  await writeFile(outPath, JSON.stringify({ scenario, pricing, blocksUsed, itinerary }, null, 2), 'utf8');

  printPlanSummary(itinerary, pricing, { scenario, blocksUsed });
  console.log(`[plan:test] saved → ${resolve(outPath)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
