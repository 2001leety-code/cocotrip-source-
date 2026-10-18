// 고정 ESM 로드 러너 (통합 2026-10-17) — tests/unit/llm-esm-load-smoke.test.ts 가 `node <이 파일>` 로만 실행한다.
// `node -e` 없이 실제 Node ESM 로더로 핵심 서버 모듈 12개를 import 한다 (vitest/esbuild 는 중복 export 를 통과시킴).
// 인자 없음: 모듈 목록·레포 경로는 이 파일 위치에서 고정 파생. 인자가 오면 거부(64).
// 성공: stdout `LOADED 12`, exit 0. 실패: stderr `ESM_LOAD_FAILED <module> <ErrorName>: <message>`, exit 1.
const CORE = [
  'api/_shared/llm/index.js', 'api/_ai_core/geminiPipeline.js', 'api/_ai_core/blockMode.js', 'api/_ai_core/handlerCore.js',
  'api/ai-planner-full.js', 'api/ai-planner-quick.js', 'api/chat.js', 'api/translate-plan.js', 'api/course-ai.js',
  'api/mood-parse-schedule.js', 'api/_shared/translator.js', 'api/_crons/weekly-quality-report.js',
];
const ROOT = new URL('../../../', import.meta.url);

if (process.argv.length > 2) {
  console.error('esm-load-core.mjs takes no arguments');
  process.exit(64);
}

let loaded = 0;
for (const rel of CORE) {
  try {
    const ns = await import(new URL(rel, ROOT).href);
    if (!ns || Object.keys(ns).length === 0) throw new Error('module namespace has no exports');
    loaded += 1;
  } catch (e) {
    console.error(`ESM_LOAD_FAILED ${rel} ${(e && e.name) || 'Error'}: ${(e && e.message) || e}`);
    process.exitCode = 1;
    break;
  }
}
if (loaded === CORE.length) console.log(`LOADED ${loaded}`);
